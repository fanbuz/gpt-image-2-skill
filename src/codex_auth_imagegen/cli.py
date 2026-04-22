from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TextIO

from . import __version__

CLI_NAME = "gpt-image-2-skill"
CLI_SCRIPT_NAME = "gpt_image_2_skill.py"
DEFAULT_PROVIDER = "auto"
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
DEFAULT_CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
DEFAULT_OPENAI_API_BASE = "https://api.openai.com/v1"
OPENAI_GENERATIONS_PATH = "/images/generations"
OPENAI_EDITS_PATH = "/images/edits"
DEFAULT_CODEX_MODEL = "gpt-5.4"
DEFAULT_OPENAI_MODEL = "gpt-image-2"
DEFAULT_INSTRUCTIONS = "You are a concise assistant."
DEFAULT_BACKGROUND = "auto"
DEFAULT_RETRY_COUNT = 3
DEFAULT_RETRY_DELAY_SECONDS = 1.0
DEFAULT_REQUEST_TIMEOUT = 300
DEFAULT_REFRESH_TIMEOUT = 60
ENDPOINT_CHECK_TIMEOUT = 5
IMAGE_SIZE_MAX_EDGE = 3840
IMAGE_SIZE_MAX_TOTAL_PIXELS = 8_294_400
IMAGE_SIZE_MAX_ASPECT_RATIO = 3.0
IMAGE_SIZE_ALIASES = {
    "2k": "2048x2048",
    "4k": "3840x2160",
}
REFRESH_ENDPOINT = "https://auth.openai.com/oauth/token"
REFRESH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
DELEGATED_IMAGE_MODEL = "gpt-image-2"
KNOWN_CODEX_MODEL_PRESETS = [
    {
        "id": "gpt-5.4",
        "default": True,
        "source": "local_preset",
        "notes": "Validated default for the Codex responses image path.",
    },
    {
        "id": "gpt-5.4-mini",
        "default": False,
        "source": "local_preset",
        "notes": "Pass explicitly when the account exposes this Codex model.",
    },
    {
        "id": "gpt-5.4-pro",
        "default": False,
        "source": "local_preset",
        "notes": "Pass explicitly when the account exposes this Codex model.",
    },
]
KNOWN_OPENAI_IMAGE_MODEL_PRESETS = [
    {
        "id": "gpt-image-2",
        "default": True,
        "source": "official_default",
        "notes": "Official API-key image generation model.",
    }
]


@dataclass
class CodexAuthState:
    auth_path: Path
    auth_json: dict[str, Any]
    access_token: str
    refresh_token: str | None
    account_id: str


@dataclass
class OpenAIAuthState:
    api_key: str
    source: str


AuthState = CodexAuthState


@dataclass
class CommandOutcome:
    payload: dict[str, Any]
    exit_status: int = 0


class CommandError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        detail: Any = None,
        exit_status: int = 1,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail
        self.exit_status = exit_status


class ApiHttpError(CommandError):
    def __init__(self, status_code: int, detail: Any):
        super().__init__(
            "http_error",
            f"HTTP {status_code}",
            detail=detail,
            exit_status=1,
        )
        self.status_code = status_code


class JsonEventLogger:
    def __init__(self, enabled: bool, stream: TextIO):
        self.enabled = enabled
        self.stream = stream
        self.seq = 0

    def emit(self, *, kind: str, type_name: str, data: dict[str, Any]) -> None:
        if not self.enabled:
            return
        self.seq += 1
        record = {
            "seq": self.seq,
            "kind": kind,
            "type": type_name,
            "data": data,
        }
        print(json.dumps(record, ensure_ascii=False), file=self.stream, flush=True)


def build_user_agent() -> str:
    return f"{CLI_NAME}/{__version__} local-cli"


def resolve_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex"


def default_auth_path() -> Path:
    return resolve_codex_home() / "auth.json"


def bounded_int(min_value: int, max_value: int) -> Callable[[str], int]:
    def parse(value: str) -> int:
        try:
            parsed = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("must be an integer") from exc
        if parsed < min_value or parsed > max_value:
            raise argparse.ArgumentTypeError(f"must be between {min_value} and {max_value}")
        return parsed

    return parse


def parse_image_size(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        raise argparse.ArgumentTypeError(
            "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT."
        )
    if normalized == "auto":
        return "auto"
    if normalized in IMAGE_SIZE_ALIASES:
        return IMAGE_SIZE_ALIASES[normalized]
    if "x" not in normalized:
        raise argparse.ArgumentTypeError(
            "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT."
        )
    width_text, height_text = normalized.split("x", 1)
    try:
        width = int(width_text)
        height = int(height_text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "Image size must be auto, 2K, 4K, or WIDTHxHEIGHT."
        ) from exc
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("Image size must use positive width and height values.")
    if width % 16 != 0 or height % 16 != 0:
        raise argparse.ArgumentTypeError(
            "Image size must use width and height values that are multiples of 16."
        )
    if max(width, height) > IMAGE_SIZE_MAX_EDGE:
        raise argparse.ArgumentTypeError(
            f"Image size supports a maximum edge of {IMAGE_SIZE_MAX_EDGE}px."
        )
    if width * height > IMAGE_SIZE_MAX_TOTAL_PIXELS:
        raise argparse.ArgumentTypeError(
            f"Image size supports up to {IMAGE_SIZE_MAX_TOTAL_PIXELS} total pixels."
        )
    aspect_ratio = max(width, height) / min(width, height)
    if aspect_ratio > IMAGE_SIZE_MAX_ASPECT_RATIO:
        raise argparse.ArgumentTypeError(
            f"Image size supports a maximum aspect ratio of {IMAGE_SIZE_MAX_ASPECT_RATIO}:1."
        )
    return f"{width}x{height}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog=CLI_NAME,
        description="Agent-first CLI and skill runtime for GPT Image 2 through OpenAI or Codex auth.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON to stdout. Enabled by default.",
    )
    parser.add_argument(
        "--provider",
        choices=("auto", "openai", "codex"),
        default=DEFAULT_PROVIDER,
        help="Provider selection. auto prefers OPENAI_API_KEY, then Codex auth.json.",
    )
    parser.add_argument(
        "--api-key",
        help="Explicit OpenAI API key for one-off tests. OPENAI_API_KEY remains the normal path.",
    )
    parser.add_argument(
        "--auth-file",
        default=str(default_auth_path()),
        help="Path to Codex auth.json.",
    )
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_CODEX_ENDPOINT,
        help="Target Codex responses endpoint.",
    )
    parser.add_argument(
        "--openai-api-base",
        default=DEFAULT_OPENAI_API_BASE,
        help="Base URL for the OpenAI Images API.",
    )
    parser.add_argument(
        "--json-events",
        action="store_true",
        help="Emit structured progress events and raw Codex SSE events to stderr as JSON lines.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser(
        "doctor",
        help="Inspect auth availability, provider selection, and endpoint reachability.",
    )

    auth_parser = subparsers.add_parser("auth", help="Inspect configured auth sources.")
    auth_subparsers = auth_parser.add_subparsers(dest="auth_command", required=True)
    auth_subparsers.add_parser(
        "inspect",
        help="Return redacted metadata for OPENAI_API_KEY and Codex auth.json.",
    )

    models_parser = subparsers.add_parser("models", help="Inspect local model presets.")
    models_subparsers = models_parser.add_subparsers(dest="models_command", required=True)
    models_subparsers.add_parser(
        "list",
        help="Return model presets and provider capabilities.",
    )

    images_parser = subparsers.add_parser("images", help="Generate or edit images.")
    images_subparsers = images_parser.add_subparsers(dest="images_command", required=True)

    images_generate = images_subparsers.add_parser(
        "generate",
        help="Generate images through the selected provider.",
    )
    add_common_image_args(images_generate, require_ref_image=False)

    images_edit = images_subparsers.add_parser(
        "edit",
        help="Edit images through the selected provider.",
    )
    add_common_image_args(images_edit, require_ref_image=True)
    images_edit.add_argument(
        "--mask",
        help="OpenAI provider only. Mask image path, file URL, data URL, or remote URL.",
    )
    images_edit.add_argument(
        "--input-fidelity",
        choices=("high", "low"),
        help="OpenAI provider only. Edit fidelity for the source image set.",
    )

    request_parser = subparsers.add_parser(
        "request",
        help="Raw escape hatch for provider-specific POST requests.",
    )
    request_subparsers = request_parser.add_subparsers(dest="request_command", required=True)
    request_create = request_subparsers.add_parser(
        "create",
        help="POST a prepared request body through the selected provider.",
    )
    request_create.add_argument(
        "--body-file",
        required=True,
        help="Path to a JSON request body, or '-' to read from stdin.",
    )
    request_create.add_argument(
        "--request-operation",
        choices=("responses", "generate", "edit"),
        default="responses",
        help="codex uses responses; openai uses generate or edit.",
    )
    request_create.add_argument(
        "--out-image",
        help="Optional path to save returned image results.",
    )
    request_create.add_argument(
        "--expect-image",
        action="store_true",
        help="Require at least one returned image.",
    )

    return parser.parse_args(argv)


def add_common_image_args(parser: argparse.ArgumentParser, *, require_ref_image: bool) -> None:
    parser.add_argument("--prompt", required=True, help="Prompt for generation or editing.")
    parser.add_argument("--out", required=True, help="Output image path.")
    parser.add_argument(
        "-m",
        "--model",
        help="Provider-native model. Defaults to gpt-image-2 for openai and gpt-5.4 for codex.",
    )
    parser.add_argument(
        "--instructions",
        default=DEFAULT_INSTRUCTIONS,
        help="Codex provider only. Instructions field sent to the responses endpoint.",
    )
    parser.add_argument(
        "--background",
        choices=("auto", "transparent", "opaque"),
        default=DEFAULT_BACKGROUND,
        help="Requested background mode.",
    )
    parser.add_argument(
        "--size",
        type=parse_image_size,
        help=(
            "Requested image size. Accepts auto, 2K=2048x2048, 4K=3840x2160, "
            "or WIDTHxHEIGHT within the OpenAI image limits."
        ),
    )
    parser.add_argument(
        "--quality",
        choices=("auto", "low", "medium", "high"),
        help="Requested image quality.",
    )
    parser.add_argument(
        "--format",
        choices=("png", "jpeg", "webp"),
        help="Requested output format.",
    )
    parser.add_argument(
        "--compression",
        type=bounded_int(0, 100),
        help="Compression level for jpeg or webp output.",
    )
    parser.add_argument(
        "--n",
        type=bounded_int(1, 10),
        help="OpenAI provider only. Number of images to generate.",
    )
    parser.add_argument(
        "--moderation",
        choices=("auto", "low"),
        help="OpenAI provider only. Moderation level for GPT image models.",
    )
    if require_ref_image:
        parser.add_argument(
            "--ref-image",
            action="append",
            required=True,
            metavar="PATH_OR_URL",
            help="Reference image path, file URL, data URL, or remote URL. Repeat to add more images.",
        )


def emit_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def build_error_payload(exc: Exception) -> tuple[dict[str, Any], int]:
    if isinstance(exc, CommandError):
        payload = {
            "ok": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
            },
        }
        if exc.detail is not None:
            payload["error"]["detail"] = redact_event_payload(exc.detail)
        return payload, exc.exit_status

    return {
        "ok": False,
        "error": {
            "code": "unexpected_error",
            "message": str(exc),
        },
    }, 1


def get_token_container(auth_json: dict[str, Any]) -> dict[str, Any]:
    tokens = auth_json.get("tokens")
    if isinstance(tokens, dict):
        return tokens
    return auth_json


def read_auth_json(auth_path: Path) -> dict[str, Any]:
    try:
        raw = auth_path.read_text()
    except FileNotFoundError as exc:
        raise CommandError(
            "auth_missing",
            f"Auth file not found: {auth_path}",
            detail={"auth_file": str(auth_path)},
        ) from exc
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CommandError(
            "auth_invalid_json",
            f"Invalid JSON in auth file: {auth_path}",
            detail={"auth_file": str(auth_path), "line": exc.lineno, "column": exc.colno},
        ) from exc
    if not isinstance(parsed, dict):
        raise CommandError(
            "auth_invalid_shape",
            "auth.json must contain a JSON object.",
            detail={"auth_file": str(auth_path)},
        )
    return parsed


def decode_jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        raise CommandError("invalid_jwt", "Invalid JWT format.")
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded)
        payload = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        raise CommandError("invalid_jwt", "Unable to decode JWT payload.") from exc
    if not isinstance(payload, dict):
        raise CommandError("invalid_jwt", "Decoded JWT payload is not a JSON object.")
    return payload


def try_decode_jwt_payload(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        return decode_jwt_payload(token)
    except CommandError:
        return None


def resolve_account_id(access_token: str, account_id: str | None) -> str:
    if account_id:
        return account_id
    payload = decode_jwt_payload(access_token)
    auth_claim = payload.get("https://api.openai.com/auth", {})
    if not isinstance(auth_claim, dict):
        raise CommandError("account_id_missing", "Missing auth claims in access token.")
    claim_account_id = auth_claim.get("chatgpt_account_id")
    if not claim_account_id:
        raise CommandError("account_id_missing", "Missing chatgpt_account_id in token claims.")
    return str(claim_account_id)


def load_codex_auth_state(auth_path: Path) -> CodexAuthState:
    auth_json = read_auth_json(auth_path)
    tokens = get_token_container(auth_json)
    access_token = tokens.get("access_token")
    if not access_token:
        raise CommandError(
            "access_token_missing",
            f"Missing access_token in {auth_path}",
            detail={"auth_file": str(auth_path)},
        )
    refresh_token = tokens.get("refresh_token")
    account_id = resolve_account_id(str(access_token), tokens.get("account_id"))
    return CodexAuthState(
        auth_path=auth_path,
        auth_json=auth_json,
        access_token=str(access_token),
        refresh_token=str(refresh_token) if refresh_token else None,
        account_id=account_id,
    )


def resolve_auth_identity(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not payload:
        return {}
    profile = payload.get("https://api.openai.com/profile", {})
    auth_claim = payload.get("https://api.openai.com/auth", {})
    result: dict[str, Any] = {}
    if isinstance(profile, dict) and profile.get("email"):
        result["email"] = str(profile["email"])
    if isinstance(auth_claim, dict):
        if auth_claim.get("chatgpt_plan_type"):
            result["plan_type"] = str(auth_claim["chatgpt_plan_type"])
        if auth_claim.get("chatgpt_user_id"):
            result["chatgpt_user_id"] = str(auth_claim["chatgpt_user_id"])
    return result


def epoch_seconds_to_iso(value: int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def compute_expiry_details(exp_seconds: int | None) -> dict[str, Any]:
    if exp_seconds is None:
        return {
            "expires_at": None,
            "expired": None,
            "seconds_until_expiry": None,
        }
    now_seconds = int(time.time())
    remaining = exp_seconds - now_seconds
    return {
        "expires_at": epoch_seconds_to_iso(exp_seconds),
        "expired": remaining <= 0,
        "seconds_until_expiry": remaining,
    }


def inspect_codex_auth_file(auth_path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "auth_file": str(auth_path),
        "auth_source": "config",
        "exists": auth_path.is_file(),
        "provider": "codex",
    }
    if not auth_path.is_file():
        result.update(
            {
                "ready": False,
                "parse_ok": False,
                "auth_source": "missing",
                "message": "auth.json was not found.",
            }
        )
        return result

    try:
        auth_json = read_auth_json(auth_path)
    except CommandError as exc:
        result.update(
            {
                "ready": False,
                "parse_ok": False,
                "message": exc.message,
                "error": {
                    "code": exc.code,
                    "detail": exc.detail,
                },
            }
        )
        return result

    tokens = get_token_container(auth_json)
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    id_token = tokens.get("id_token")
    access_payload = try_decode_jwt_payload(str(access_token)) if access_token else None
    auth_mode = auth_json.get("auth_mode") or auth_json.get("type")
    exp_seconds = None
    if access_payload and isinstance(access_payload.get("exp"), int):
        exp_seconds = int(access_payload["exp"])

    identity = resolve_auth_identity(access_payload)
    account_id = tokens.get("account_id")
    if access_token:
        try:
            account_id = resolve_account_id(str(access_token), str(account_id) if account_id else None)
        except CommandError:
            account_id = account_id

    result.update(
        {
            "ready": bool(access_token),
            "parse_ok": True,
            "auth_mode": auth_mode,
            "access_token_present": bool(access_token),
            "refresh_token_present": bool(refresh_token),
            "id_token_present": bool(id_token),
            "account_id": account_id,
            **compute_expiry_details(exp_seconds),
            **identity,
            "last_refresh": auth_json.get("last_refresh"),
        }
    )
    return result


def inspect_auth_file(auth_path: Path) -> dict[str, Any]:
    return inspect_codex_auth_file(auth_path)


def resolve_openai_api_key(api_key_override: str | None) -> tuple[str | None, str]:
    if api_key_override:
        return api_key_override, "flag"
    env_value = os.environ.get(OPENAI_API_KEY_ENV, "").strip()
    if env_value:
        return env_value, "env"
    return None, "missing"


def inspect_openai_auth(api_key_override: str | None) -> dict[str, Any]:
    api_key, source = resolve_openai_api_key(api_key_override)
    return {
        "provider": "openai",
        "ready": bool(api_key),
        "auth_source": source,
        "api_key_present": bool(api_key),
        "env_var": OPENAI_API_KEY_ENV,
        "default_model": DEFAULT_OPENAI_MODEL,
    }


def load_openai_auth_state(api_key_override: str | None) -> OpenAIAuthState:
    api_key, source = resolve_openai_api_key(api_key_override)
    if not api_key:
        raise CommandError(
            "api_key_missing",
            f"Missing {OPENAI_API_KEY_ENV}.",
            detail={"provider": "openai", "env_var": OPENAI_API_KEY_ENV},
        )
    return OpenAIAuthState(api_key=api_key, source=source)


def resolve_endpoint_parts(endpoint: str) -> tuple[str, int, str]:
    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.hostname
    if not host:
        raise CommandError("invalid_endpoint", f"Invalid endpoint: {endpoint}")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return host, port, parsed.scheme


def check_endpoint_reachability(endpoint: str) -> dict[str, Any]:
    host, port, scheme = resolve_endpoint_parts(endpoint)
    result: dict[str, Any] = {
        "endpoint": endpoint,
        "host": host,
        "port": port,
        "scheme": scheme,
        "dns_resolved": False,
        "tcp_connected": False,
        "tls_ok": False if scheme == "https" else None,
        "reachable": False,
    }
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = sorted({info[4][0] for info in infos})
        result["dns_resolved"] = True
        result["addresses"] = addresses
        with socket.create_connection((host, port), timeout=ENDPOINT_CHECK_TIMEOUT) as sock:
            result["tcp_connected"] = True
            if scheme == "https":
                context = ssl.create_default_context()
                with context.wrap_socket(sock, server_hostname=host) as tls_sock:
                    result["tls_ok"] = True
                    result["tls_version"] = tls_sock.version()
        result["reachable"] = True
    except Exception as exc:
        result["error"] = str(exc)
    return result


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def save_auth_json(auth_state: CodexAuthState) -> None:
    auth_state.auth_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = auth_state.auth_path.with_suffix(auth_state.auth_path.suffix + ".tmp")
    temp_path.write_text(json.dumps(auth_state.auth_json, ensure_ascii=False, indent=2) + "\n")
    temp_path.replace(auth_state.auth_path)


def refresh_access_token(auth_state: CodexAuthState, refresh_timeout: int = DEFAULT_REFRESH_TIMEOUT) -> dict[str, Any]:
    if not auth_state.refresh_token:
        raise CommandError("refresh_token_missing", "Missing refresh_token in auth.json")

    request = urllib.request.Request(
        REFRESH_ENDPOINT,
        data=json.dumps(
            {
                "client_id": REFRESH_CLIENT_ID,
                "grant_type": "refresh_token",
                "refresh_token": auth_state.refresh_token,
            }
        ).encode("utf-8"),
        method="POST",
    )
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(request, timeout=refresh_timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise CommandError(
            "refresh_failed",
            f"Refresh HTTP {exc.code}",
            detail=detail,
        ) from exc

    access_token = payload.get("access_token")
    refresh_token = payload.get("refresh_token")
    id_token = payload.get("id_token")
    if not access_token:
        raise CommandError("refresh_failed", "Refresh response did not include access_token.")

    tokens = get_token_container(auth_state.auth_json)
    tokens["access_token"] = access_token
    auth_state.access_token = str(access_token)

    if refresh_token:
        tokens["refresh_token"] = refresh_token
        auth_state.refresh_token = str(refresh_token)

    if id_token:
        tokens["id_token"] = id_token

    tokens["account_id"] = resolve_account_id(auth_state.access_token, tokens.get("account_id"))
    auth_state.account_id = str(tokens["account_id"])
    auth_state.auth_json["last_refresh"] = utc_now_iso()
    save_auth_json(auth_state)
    return payload


def build_codex_request(
    endpoint: str,
    access_token: str,
    account_id: str,
    body: dict[str, Any],
) -> urllib.request.Request:
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
    )
    headers = {
        "Authorization": f"Bearer {access_token}",
        "ChatGPT-Account-ID": account_id,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "User-Agent": build_user_agent(),
        "originator": "codex_desktop",
    }
    for key, value in headers.items():
        request.add_header(key, value)
    return request


def build_openai_request(
    endpoint: str,
    api_key: str,
    body: dict[str, Any],
) -> urllib.request.Request:
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
    )
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", build_user_agent())
    return request


def build_openai_multipart_request(
    endpoint: str,
    api_key: str,
    body_bytes: bytes,
    boundary: str,
) -> urllib.request.Request:
    request = urllib.request.Request(
        endpoint,
        data=body_bytes,
        method="POST",
    )
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", build_user_agent())
    return request


def iter_sse_events(response: Any) -> Any:
    data_lines: list[str] = []
    for raw_line in response:
        line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
        if line == "":
            if data_lines:
                yield "".join(data_lines)
                data_lines = []
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    if data_lines:
        yield "".join(data_lines)


def estimate_base64_decoded_len(value: str) -> int:
    stripped = value.strip()
    padding = stripped.count("=")
    return max((len(stripped) * 3) // 4 - padding, 0)


def decode_base64_bytes(value: str) -> bytes:
    stripped = value.strip()
    if stripped.startswith("data:image/"):
        _, separator, encoded = stripped.partition(",")
        if not separator:
            raise CommandError("invalid_base64", "Image data URL did not contain a comma separator.")
        stripped = encoded.strip()
    padded = stripped + "=" * (-len(stripped) % 4)
    try:
        return base64.b64decode(padded)
    except Exception as exc:
        raise CommandError("invalid_base64", "Image payload was not valid base64.", detail={"length": len(stripped)}) from exc


def is_probably_base64(value: str) -> bool:
    if len(value) < 128:
        return False
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r")
    return all(ch in allowed for ch in value)


def summarize_large_string(key: str | None, value: str) -> dict[str, Any]:
    lowered = (key or "").lower()
    if value.startswith("data:image/"):
        prefix, _, encoded = value.partition(",")
        return {
            "_omitted": "data_url",
            "prefix": prefix,
            "base64_chars": len(encoded),
            "decoded_bytes_estimate": estimate_base64_decoded_len(encoded),
        }
    if lowered == "result" or "partial_image" in lowered or is_probably_base64(value):
        return {
            "_omitted": "base64",
            "base64_chars": len(value),
            "decoded_bytes_estimate": estimate_base64_decoded_len(value),
        }
    return {"_omitted": "string", "chars": len(value)}


def redact_event_payload(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for child_key, child_value in value.items():
            lowered = child_key.lower()
            if lowered in {"access_token", "refresh_token", "id_token", "authorization", "api_key"}:
                redacted[child_key] = {"_omitted": "secret"}
                continue
            redacted[child_key] = redact_event_payload(child_value, child_key)
        return redacted
    if isinstance(value, list):
        return [redact_event_payload(item) for item in value]
    if isinstance(value, str):
        lowered = (key or "").lower()
        if value.startswith("data:image/"):
            return summarize_large_string(key, value)
        if lowered in {"result", "image_url", "b64_json"} or "partial_image" in lowered:
            return summarize_large_string(key, value)
        if len(value) >= 512 and is_probably_base64(value):
            return summarize_large_string(key, value)
    return value


def emit_progress_event(
    logger: JsonEventLogger,
    *,
    provider: str,
    phase: str,
    message: str,
    status: str = "running",
    percent: int | None = None,
    **extra: Any,
) -> None:
    data: dict[str, Any] = {
        "provider": provider,
        "phase": phase,
        "status": status,
        "message": message,
    }
    if percent is not None:
        data["percent"] = percent
    for key, value in extra.items():
        if value is not None:
            data[key] = redact_event_payload(value, key)
    logger.emit(
        kind="progress",
        type_name=phase,
        data=data,
    )


def emit_sse_event(logger: JsonEventLogger, event: dict[str, Any]) -> None:
    logger.emit(
        kind="sse",
        type_name=str(event.get("type") or "unknown"),
        data=redact_event_payload(event),
    )


def merge_output_items(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for item in existing + incoming:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "")
        if item_id and item_id in by_id:
            by_id[item_id] = item
            for index, candidate in enumerate(ordered):
                if candidate.get("id") == item_id:
                    ordered[index] = item
                    break
            continue
        if item_id:
            by_id[item_id] = item
        ordered.append(item)
    return ordered


def extract_codex_image_items(output_items: Any) -> list[dict[str, Any]]:
    if not isinstance(output_items, list):
        return []
    results: list[dict[str, Any]] = []
    for item in output_items:
        if isinstance(item, dict) and item.get("type") == "image_generation_call" and item.get("result"):
            results.append(item)
    return results


def extract_image_item(output_items: Any) -> dict[str, Any] | None:
    image_items = extract_codex_image_items(output_items)
    return image_items[0] if image_items else None


def format_response_error(error: Any) -> str:
    if not isinstance(error, dict):
        return "Image generation failed without structured error details."
    code = str(error.get("code") or "").strip()
    message = str(error.get("message") or "Image generation failed").strip()
    if code:
        return f"{code}: {message}"
    return message


def should_retry_exception(exc: Exception) -> bool:
    if isinstance(exc, ApiHttpError):
        return exc.status_code == 429 or exc.status_code >= 500
    if isinstance(
        exc,
        (
            urllib.error.URLError,
            TimeoutError,
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            ssl.SSLError,
            socket.timeout,
        ),
    ):
        return True
    if isinstance(exc, RuntimeError):
        text = str(exc).lower()
        return "server_error" in text or "did not receive an image_generation_call result" in text
    return False


def compute_retry_delay_seconds(retry_number: int) -> float:
    return DEFAULT_RETRY_DELAY_SECONDS * (2 ** max(retry_number - 1, 0))


def execute_with_retry(
    *,
    run_once: Callable[[], dict[str, Any]],
    logger: JsonEventLogger,
    provider: str,
    refresh_once: Callable[[], dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], bool, int]:
    auth_refreshed = False
    retry_count = 0

    while True:
        try:
            outcome = run_once()
            return outcome, auth_refreshed, retry_count
        except ApiHttpError as exc:
            if exc.status_code == 401 and refresh_once and not auth_refreshed:
                logger.emit(
                    kind="local",
                    type_name="auth.refresh.started",
                    data={"endpoint": REFRESH_ENDPOINT},
                )
                emit_progress_event(
                    logger,
                    provider=provider,
                    phase="auth_refresh_started",
                    status="running",
                    percent=2,
                    message="Refreshing Codex access token.",
                    endpoint=REFRESH_ENDPOINT,
                )
                refresh_payload = refresh_once()
                logger.emit(
                    kind="local",
                    type_name="auth.refresh.completed",
                    data=redact_event_payload(refresh_payload),
                )
                emit_progress_event(
                    logger,
                    provider=provider,
                    phase="auth_refresh_completed",
                    status="running",
                    percent=4,
                    message="Codex access token refreshed.",
                )
                auth_refreshed = True
                continue
            if retry_count >= DEFAULT_RETRY_COUNT or not should_retry_exception(exc):
                raise
            retry_count += 1
            delay_seconds = compute_retry_delay_seconds(retry_count)
            logger.emit(
                kind="local",
                type_name="request.retry.scheduled",
                data={
                    "retry_number": retry_count,
                    "max_retries": DEFAULT_RETRY_COUNT,
                    "delay_seconds": delay_seconds,
                    "reason": exc.message,
                    "status_code": exc.status_code,
                },
            )
            emit_progress_event(
                logger,
                provider=provider,
                phase="retry_scheduled",
                status="running",
                message="Retry scheduled after HTTP failure.",
                retry_number=retry_count,
                max_retries=DEFAULT_RETRY_COUNT,
                delay_seconds=delay_seconds,
                status_code=exc.status_code,
                reason=exc.message,
            )
            time.sleep(delay_seconds)
        except Exception as exc:
            if retry_count >= DEFAULT_RETRY_COUNT or not should_retry_exception(exc):
                raise
            retry_count += 1
            delay_seconds = compute_retry_delay_seconds(retry_count)
            logger.emit(
                kind="local",
                type_name="request.retry.scheduled",
                data={
                    "retry_number": retry_count,
                    "max_retries": DEFAULT_RETRY_COUNT,
                    "delay_seconds": delay_seconds,
                    "reason": str(exc),
                },
            )
            emit_progress_event(
                logger,
                provider=provider,
                phase="retry_scheduled",
                status="running",
                message="Retry scheduled after transient failure.",
                retry_number=retry_count,
                max_retries=DEFAULT_RETRY_COUNT,
                delay_seconds=delay_seconds,
                reason=str(exc),
            )
            time.sleep(delay_seconds)


def request_responses_with_retry(
    *,
    endpoint: str,
    auth_state: CodexAuthState,
    body: dict[str, Any],
    logger: JsonEventLogger,
) -> tuple[dict[str, Any], bool, int]:
    return execute_with_retry(
        run_once=lambda: request_responses_once(
            endpoint=endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        ),
        logger=logger,
        provider="codex",
        refresh_once=lambda: refresh_access_token(auth_state),
    )


def request_codex_responses_once(
    *,
    endpoint: str,
    auth_state: CodexAuthState,
    body: dict[str, Any],
    logger: JsonEventLogger,
    request_timeout: int = DEFAULT_REQUEST_TIMEOUT,
) -> dict[str, Any]:
    logger.emit(
        kind="local",
        type_name="request.started",
        data={"provider": "codex", "endpoint": endpoint},
    )
    emit_progress_event(
        logger,
        provider="codex",
        phase="request_started",
        status="running",
        percent=0,
        message="Codex image request sent.",
        endpoint=endpoint,
    )
    request = build_codex_request(
        endpoint=endpoint,
        access_token=auth_state.access_token,
        account_id=auth_state.account_id,
        body=body,
    )

    try:
        response = urllib.request.urlopen(request, timeout=request_timeout)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise ApiHttpError(exc.code, detail) from exc

    response_meta: dict[str, Any] = {}
    output_items: list[dict[str, Any]] = []
    response_error: Any = None

    with response:
        for data in iter_sse_events(response):
            if data == "[DONE]":
                logger.emit(kind="sse", type_name="done", data={"raw": "[DONE]"})
                break
            event = json.loads(data)
            emit_sse_event(logger, event)
            event_type = event.get("type")

            if event_type == "response.created":
                created = event.get("response")
                if isinstance(created, dict):
                    response_meta = created
                    emit_progress_event(
                        logger,
                        provider="codex",
                        phase="response_created",
                        status="running",
                        percent=15,
                        message="Codex accepted the image request.",
                        response_id=created.get("id"),
                        model=created.get("model"),
                    )
                continue

            if event_type == "response.output_item.done":
                item = event.get("item", {})
                if isinstance(item, dict):
                    output_items = merge_output_items(output_items, [item])
                    emit_progress_event(
                        logger,
                        provider="codex",
                        phase="output_item_done",
                        status="running",
                        percent=85,
                        message="Codex finished one output item.",
                        item_id=item.get("id"),
                        item_type=item.get("type"),
                        item_status=item.get("status"),
                        image_count=len(extract_codex_image_items(output_items)),
                    )
                continue

            if event_type == "error":
                response_error = event.get("error")
                emit_progress_event(
                    logger,
                    provider="codex",
                    phase="request_failed",
                    status="failed",
                    message="Codex reported an image generation error.",
                    error=response_error,
                )
                continue

            if event_type == "response.failed":
                failed_response = event.get("response", {})
                if isinstance(failed_response, dict):
                    response_meta = failed_response
                    failed_output = failed_response.get("output")
                    if isinstance(failed_output, list):
                        output_items = merge_output_items(output_items, failed_output)
                    response_error = failed_response.get("error") or response_error
                    emit_progress_event(
                        logger,
                        provider="codex",
                        phase="request_failed",
                        status="failed",
                        message="Codex marked the image request as failed.",
                        response_id=failed_response.get("id"),
                        error=response_error,
                    )
                break

            if event_type == "response.completed":
                completed = event.get("response")
                if isinstance(completed, dict):
                    response_meta = completed
                    emit_progress_event(
                        logger,
                        provider="codex",
                        phase="response_completed",
                        status="running",
                        percent=95,
                        message="Codex completed the server-side image response.",
                        response_id=completed.get("id"),
                        image_count=len(extract_codex_image_items(output_items)),
                    )
                break

    image_items = extract_codex_image_items(output_items)
    if response_error and not image_items:
        raise RuntimeError(format_response_error(response_error))

    logger.emit(
        kind="local",
        type_name="request.completed",
        data={
            "provider": "codex",
            "response_id": response_meta.get("id"),
            "image_count": len(image_items),
        },
    )
    emit_progress_event(
        logger,
        provider="codex",
        phase="request_completed",
        status="running",
        percent=97,
        message="Codex response payload received.",
        response_id=response_meta.get("id"),
        image_count=len(image_items),
    )
    return {
        "response": response_meta,
        "output_items": output_items,
        "image_items": image_items,
    }


def request_responses_once(
    *,
    endpoint: str,
    auth_state: CodexAuthState,
    body: dict[str, Any],
    logger: JsonEventLogger,
    request_timeout: int = DEFAULT_REQUEST_TIMEOUT,
) -> dict[str, Any]:
    return request_codex_responses_once(
        endpoint=endpoint,
        auth_state=auth_state,
        body=body,
        logger=logger,
        request_timeout=request_timeout,
    )


def request_openai_images_once(
    *,
    endpoint: str,
    auth_state: OpenAIAuthState,
    body: dict[str, Any],
    logger: JsonEventLogger,
    request_timeout: int = DEFAULT_REQUEST_TIMEOUT,
) -> dict[str, Any]:
    logger.emit(
        kind="local",
        type_name="request.started",
        data={"provider": "openai", "endpoint": endpoint},
    )
    emit_progress_event(
        logger,
        provider="openai",
        phase="request_started",
        status="running",
        percent=0,
        message="OpenAI image request sent.",
        endpoint=endpoint,
    )
    request = build_openai_request(endpoint=endpoint, api_key=auth_state.api_key, body=body)
    try:
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise ApiHttpError(exc.code, detail) from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CommandError("invalid_json_response", "OpenAI Images API returned invalid JSON.", detail=raw) from exc
    if not isinstance(payload, dict):
        raise CommandError("invalid_json_response", "OpenAI Images API returned a non-object JSON payload.")
    logger.emit(
        kind="local",
        type_name="request.completed",
        data={
            "provider": "openai",
            "created": payload.get("created"),
            "image_count": len(payload.get("data") or []),
        },
    )
    emit_progress_event(
        logger,
        provider="openai",
        phase="request_completed",
        status="running",
        percent=95,
        message="OpenAI image response received.",
        created=payload.get("created"),
        image_count=len(payload.get("data") or []),
    )
    return payload


def request_openai_edit_once(
    *,
    endpoint: str,
    auth_state: OpenAIAuthState,
    body: dict[str, Any],
    logger: JsonEventLogger,
    request_timeout: int = DEFAULT_REQUEST_TIMEOUT,
) -> dict[str, Any]:
    logger.emit(
        kind="local",
        type_name="request.started",
        data={"provider": "openai", "endpoint": endpoint, "transport": "multipart"},
    )
    emit_progress_event(
        logger,
        provider="openai",
        phase="request_started",
        status="running",
        percent=0,
        message="OpenAI multipart image edit request started.",
        endpoint=endpoint,
        transport="multipart",
    )
    boundary, multipart_body = build_openai_edit_multipart_payload(body)
    emit_progress_event(
        logger,
        provider="openai",
        phase="multipart_prepared",
        status="running",
        percent=10,
        message="OpenAI multipart image payload prepared.",
        byte_count=len(multipart_body),
    )
    request = build_openai_multipart_request(
        endpoint=endpoint,
        api_key=auth_state.api_key,
        body_bytes=multipart_body,
        boundary=boundary,
    )
    try:
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise ApiHttpError(exc.code, detail) from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CommandError("invalid_json_response", "OpenAI Images API returned invalid JSON.", detail=raw) from exc
    if not isinstance(payload, dict):
        raise CommandError("invalid_json_response", "OpenAI Images API returned a non-object JSON payload.")
    logger.emit(
        kind="local",
        type_name="request.completed",
        data={
            "provider": "openai",
            "created": payload.get("created"),
            "image_count": len(payload.get("data") or []),
            "transport": "multipart",
        },
    )
    emit_progress_event(
        logger,
        provider="openai",
        phase="request_completed",
        status="running",
        percent=95,
        message="OpenAI multipart image response received.",
        created=payload.get("created"),
        image_count=len(payload.get("data") or []),
        transport="multipart",
    )
    return payload


def resolve_ref_images(ref_images: list[str]) -> list[str]:
    return [resolve_ref_image(value) for value in ref_images]


def resolve_ref_image(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme in {"http", "https", "data"}:
        return value
    if parsed.scheme == "file":
        return local_path_to_data_url(Path(urllib.request.url2pathname(parsed.path)))
    return local_path_to_data_url(Path(value).expanduser())


def local_path_to_data_url(path: Path) -> str:
    if not path.is_file():
        raise CommandError("ref_image_missing", f"Reference image not found: {path}")
    image_bytes = path.read_bytes()
    mime_type = detect_mime_type(path, image_bytes)
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def detect_mime_type(path: Path, image_bytes: bytes) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type and mime_type.startswith("image/"):
        return mime_type
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if image_bytes.startswith(b"BM"):
        return "image/bmp"
    raise CommandError("ref_image_invalid", f"Unsupported image format for reference image: {path}")


def detect_extension(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return ".webp"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if image_bytes.startswith(b"BM"):
        return ".bmp"
    return ".bin"


def save_image(output_path: Path, image_bytes: bytes) -> Path:
    final_path = output_path
    if not output_path.suffix:
        final_path = output_path.with_suffix(detect_extension(image_bytes))
    final_path.parent.mkdir(parents=True, exist_ok=True)
    final_path.write_bytes(image_bytes)
    return final_path


def save_images(output_path: Path, image_bytes_list: list[bytes]) -> list[dict[str, Any]]:
    if not image_bytes_list:
        raise CommandError("missing_image_result", "No image bytes were available to save.")
    if len(image_bytes_list) == 1:
        final_path = save_image(output_path, image_bytes_list[0])
        return [{"index": 0, "path": str(final_path), "bytes": len(image_bytes_list[0])}]

    saved: list[dict[str, Any]] = []
    output_path.parent.mkdir(parents=True, exist_ok=True)
    base_name = output_path.stem if output_path.suffix else output_path.name
    for index, image_bytes in enumerate(image_bytes_list, start=1):
        suffix = output_path.suffix or detect_extension(image_bytes)
        final_path = output_path.parent / f"{base_name}-{index}{suffix}"
        final_path.write_bytes(image_bytes)
        saved.append({"index": index - 1, "path": str(final_path), "bytes": len(image_bytes)})
    return saved


def maybe_add_image_option(target: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        target[key] = value


def filename_extension_for_mime_type(mime_type: str) -> str:
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
    }
    return mapping.get(mime_type, ".bin")


def sanitize_multipart_filename(file_name: str) -> str:
    clean = "".join(ch for ch in file_name if ch.isalnum() or ch in {"-", "_", "."})
    return clean or "image.bin"


def parse_data_url_image(value: str) -> tuple[str, bytes]:
    prefix, separator, encoded = value.partition(",")
    if not separator or ";base64" not in prefix:
        raise CommandError("invalid_data_url", "Image data URL must contain a base64 payload.")
    mime_type = prefix[5:].split(";", 1)[0].strip() or "application/octet-stream"
    return mime_type, decode_base64_bytes(encoded)


def load_image_source_bytes(source: str, *, fallback_name: str) -> tuple[str, bytes, str]:
    parsed = urllib.parse.urlparse(source)
    if source.startswith("data:image/"):
        mime_type, image_bytes = parse_data_url_image(source)
        return mime_type, image_bytes, sanitize_multipart_filename(fallback_name + filename_extension_for_mime_type(mime_type))
    if parsed.scheme in {"http", "https"}:
        image_bytes = download_bytes(source)
        guessed_name = Path(parsed.path).name or fallback_name
        mime_type = detect_mime_type(Path(guessed_name), image_bytes)
        final_name = sanitize_multipart_filename(Path(guessed_name).stem or fallback_name)
        return mime_type, image_bytes, final_name + filename_extension_for_mime_type(mime_type)
    if parsed.scheme == "file":
        local_path = Path(urllib.request.url2pathname(parsed.path))
        image_bytes = local_path.read_bytes()
        mime_type = detect_mime_type(local_path, image_bytes)
        final_name = sanitize_multipart_filename(local_path.name)
        return mime_type, image_bytes, final_name
    local_path = Path(source).expanduser()
    if local_path.is_file():
        image_bytes = local_path.read_bytes()
        mime_type = detect_mime_type(local_path, image_bytes)
        final_name = sanitize_multipart_filename(local_path.name)
        return mime_type, image_bytes, final_name
    raise CommandError("ref_image_invalid", f"Unsupported image source for multipart edit: {source}")


def extract_openai_edit_image_sources(body: dict[str, Any]) -> list[str]:
    candidates = body.get("images")
    if not isinstance(candidates, list):
        singular = body.get("image")
        if singular is not None:
            candidates = [singular]
        else:
            candidates = []
    sources: list[str] = []
    for entry in candidates:
        if isinstance(entry, str):
            sources.append(entry)
            continue
        if isinstance(entry, dict) and isinstance(entry.get("image_url"), str):
            sources.append(entry["image_url"])
            continue
    return sources


def extract_openai_mask_source(body: dict[str, Any]) -> str | None:
    mask = body.get("mask")
    if isinstance(mask, str):
        return mask
    if isinstance(mask, dict) and isinstance(mask.get("image_url"), str):
        return str(mask["image_url"])
    return None


def coerce_multipart_scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return str(value)
    return None


def append_multipart_text_part(parts: list[bytes], boundary: str, name: str, value: str) -> None:
    parts.append(f"--{boundary}\r\n".encode("utf-8"))
    parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
    parts.append(value.encode("utf-8"))
    parts.append(b"\r\n")


def append_multipart_file_part(
    parts: list[bytes],
    boundary: str,
    name: str,
    file_name: str,
    mime_type: str,
    data: bytes,
) -> None:
    parts.append(f"--{boundary}\r\n".encode("utf-8"))
    parts.append(
        f'Content-Disposition: form-data; name="{name}"; filename="{sanitize_multipart_filename(file_name)}"\r\n'.encode(
            "utf-8"
        )
    )
    parts.append(f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"))
    parts.append(data)
    parts.append(b"\r\n")


def build_openai_edit_multipart_payload(body: dict[str, Any]) -> tuple[str, bytes]:
    image_sources = extract_openai_edit_image_sources(body)
    if not image_sources:
        raise CommandError("missing_image_result", "OpenAI edit requests require at least one input image.")
    boundary = f"----{CLI_NAME}-{int(time.time() * 1000)}"
    parts: list[bytes] = []
    for key in ("model", "prompt", "size", "quality", "background", "output_format", "output_compression", "n", "moderation"):
        value = coerce_multipart_scalar(body.get(key))
        if value is not None:
            append_multipart_text_part(parts, boundary, key, value)
    for index, source in enumerate(image_sources, start=1):
        mime_type, image_bytes, file_name = load_image_source_bytes(source, fallback_name=f"image-{index}")
        append_multipart_file_part(parts, boundary, "image[]", file_name, mime_type, image_bytes)
    mask_source = extract_openai_mask_source(body)
    if mask_source:
        mime_type, image_bytes, file_name = load_image_source_bytes(mask_source, fallback_name="mask")
        append_multipart_file_part(parts, boundary, "mask", file_name, mime_type, image_bytes)
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(parts)


def build_codex_image_body(
    *,
    prompt: str,
    model: str,
    instructions: str,
    ref_images: list[str],
    background: str,
    size: str | None,
    quality: str | None,
    output_format: str | None,
    output_compression: int | None,
    action: str,
) -> dict[str, Any]:
    content: list[dict[str, str]] = []
    for image_url in ref_images:
        content.append({"type": "input_image", "image_url": image_url})
    content.append({"type": "input_text", "text": prompt})
    tool: dict[str, Any] = {
        "type": "image_generation",
        "background": background,
        "action": action,
    }
    maybe_add_image_option(tool, "size", size)
    maybe_add_image_option(tool, "quality", quality)
    maybe_add_image_option(tool, "output_format", output_format)
    maybe_add_image_option(tool, "output_compression", output_compression)
    return {
        "model": model,
        "instructions": instructions,
        "store": False,
        "stream": True,
        "input": [{"role": "user", "content": content}],
        "tools": [tool],
    }


def build_openai_image_body(
    *,
    operation: str,
    prompt: str,
    model: str,
    ref_images: list[str],
    mask: str | None,
    input_fidelity: str | None,
    background: str,
    size: str | None,
    quality: str | None,
    output_format: str | None,
    output_compression: int | None,
    n: int | None,
    moderation: str | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "background": background,
    }
    maybe_add_image_option(body, "size", size)
    maybe_add_image_option(body, "quality", quality)
    maybe_add_image_option(body, "output_format", output_format)
    maybe_add_image_option(body, "output_compression", output_compression)
    maybe_add_image_option(body, "n", n)
    maybe_add_image_option(body, "moderation", moderation)
    if operation == "edit":
        body["images"] = [{"image_url": image_url} for image_url in ref_images]
        if mask:
            body["mask"] = {"image_url": mask}
        maybe_add_image_option(body, "input_fidelity", input_fidelity)
    return body


def summarize_output_item(item: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "id": item.get("id"),
        "type": item.get("type"),
        "status": item.get("status"),
    }
    for key in ("action", "background", "output_format", "quality", "size", "revised_prompt"):
        if key in item:
            summary[key] = item.get(key)
    if item.get("result"):
        summary["result"] = summarize_large_string("result", str(item["result"]))
    return summary


def read_body_json(body_file: str) -> dict[str, Any]:
    if body_file == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(body_file).expanduser().read_text()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CommandError(
            "invalid_body_json",
            "Request body must be valid JSON.",
            detail={"line": exc.lineno, "column": exc.colno},
        ) from exc
    if not isinstance(parsed, dict):
        raise CommandError("invalid_body_json", "Request body must be a JSON object.")
    return parsed


def default_model_for_provider(provider: str) -> str:
    if provider == "openai":
        return DEFAULT_OPENAI_MODEL
    if provider == "codex":
        return DEFAULT_CODEX_MODEL
    raise CommandError("invalid_provider", f"Unsupported provider: {provider}")


def select_image_provider(args: argparse.Namespace) -> tuple[str, str]:
    openai_ready = inspect_openai_auth(args.api_key)["ready"]
    codex_ready = inspect_codex_auth_file(Path(args.auth_file).expanduser())["ready"]
    if args.provider == "openai":
        if not openai_ready:
            raise CommandError("api_key_missing", f"Missing {OPENAI_API_KEY_ENV}.")
        return "openai", "explicit"
    if args.provider == "codex":
        if not codex_ready:
            raise CommandError("access_token_missing", f"Missing access_token in {Path(args.auth_file).expanduser()}")
        return "codex", "explicit"
    if openai_ready:
        return "openai", "auto_openai_api_key"
    if codex_ready:
        return "codex", "auto_codex_auth"
    raise CommandError(
        "provider_unavailable",
        "No usable provider auth was found.",
        detail={
            "openai": inspect_openai_auth(args.api_key),
            "codex": inspect_codex_auth_file(Path(args.auth_file).expanduser()),
        },
    )


def select_request_provider(args: argparse.Namespace) -> tuple[str, str]:
    if args.provider != "auto":
        provider, reason = select_image_provider(args)
        return provider, reason
    if args.request_operation == "responses":
        codex_info = inspect_codex_auth_file(Path(args.auth_file).expanduser())
        if codex_info["ready"]:
            return "codex", "auto_request_responses"
    if args.request_operation in {"generate", "edit"}:
        openai_info = inspect_openai_auth(args.api_key)
        if openai_info["ready"]:
            return "openai", "auto_request_images"
    return select_image_provider(args)


def validate_provider_specific_image_args(args: argparse.Namespace, provider: str) -> None:
    if provider == "codex":
        if args.n not in (None, 1):
            raise CommandError("unsupported_option", "--n is supported by the openai provider.")
        if args.moderation is not None:
            raise CommandError("unsupported_option", "--moderation is supported by the openai provider.")
        if getattr(args, "mask", None) is not None:
            raise CommandError("unsupported_option", "--mask is supported by the openai provider.")
        if getattr(args, "input_fidelity", None) is not None:
            raise CommandError("unsupported_option", "--input-fidelity is supported by the openai provider.")
        return
    if provider == "openai":
        if args.instructions != DEFAULT_INSTRUCTIONS:
            raise CommandError("unsupported_option", "--instructions is supported by the codex provider.")
        return
    raise CommandError("invalid_provider", f"Unsupported provider: {provider}")


def normalize_saved_output(saved_files: list[dict[str, Any]]) -> dict[str, Any]:
    if len(saved_files) == 1:
        return {
            "path": saved_files[0]["path"],
            "bytes": saved_files[0]["bytes"],
            "files": saved_files,
        }
    total_bytes = sum(int(item["bytes"]) for item in saved_files)
    return {
        "path": None,
        "bytes": total_bytes,
        "files": saved_files,
    }


def decode_openai_images(payload: dict[str, Any]) -> tuple[list[bytes], list[str | None]]:
    data = payload.get("data")
    if not isinstance(data, list):
        return [], []
    image_bytes_list: list[bytes] = []
    revised_prompts: list[str | None] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        b64_json = item.get("b64_json")
        image_url = item.get("url")
        revised_prompts.append(str(item.get("revised_prompt")) if item.get("revised_prompt") else None)
        if isinstance(b64_json, str) and b64_json:
            image_bytes_list.append(decode_base64_bytes(b64_json))
            continue
        if isinstance(image_url, str) and image_url:
            image_bytes_list.append(download_bytes(image_url))
    return image_bytes_list, revised_prompts


def download_bytes(url: str, request_timeout: int = DEFAULT_REQUEST_TIMEOUT) -> bytes:
    request = urllib.request.Request(url, method="GET")
    request.add_header("User-Agent", build_user_agent())
    try:
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise ApiHttpError(exc.code, detail) from exc


def summarize_image_request_options(args: argparse.Namespace, provider: str, operation: str, resolved_model: str) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "operation": operation,
        "provider": provider,
        "model": resolved_model,
        "background": args.background,
        "ref_image_count": len(getattr(args, "ref_image", []) or []),
    }
    for key in ("size", "quality", "format", "compression", "n", "moderation"):
        value = getattr(args, key, None)
        if value is not None:
            summary[key] = value
    if provider == "codex":
        summary["delegated_image_model"] = DELEGATED_IMAGE_MODEL
    if getattr(args, "mask", None):
        summary["mask_present"] = True
    if getattr(args, "input_fidelity", None):
        summary["input_fidelity"] = args.input_fidelity
    return summary


def run_codex_image_command(args: argparse.Namespace, *, operation: str, selection_reason: str) -> CommandOutcome:
    auth_path = Path(args.auth_file).expanduser()
    output_path = Path(args.out).expanduser()
    auth_state = load_codex_auth_state(auth_path)
    ref_images = resolve_ref_images(getattr(args, "ref_image", []) or [])
    resolved_model = args.model or DEFAULT_CODEX_MODEL
    body = build_codex_image_body(
        prompt=args.prompt,
        model=resolved_model,
        instructions=args.instructions,
        ref_images=ref_images,
        background=args.background,
        size=args.size,
        quality=args.quality,
        output_format=args.format,
        output_compression=args.compression,
        action=operation,
    )
    logger = JsonEventLogger(enabled=args.json_events, stream=sys.stderr)
    outcome, auth_refreshed, retry_count = execute_with_retry(
        run_once=lambda: request_codex_responses_once(
            endpoint=args.endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        ),
        logger=logger,
        provider="codex",
        refresh_once=lambda: refresh_access_token(auth_state),
    )
    image_items = extract_codex_image_items(outcome["output_items"])
    if not image_items:
        raise CommandError("missing_image_result", "The response did not include an image_generation_call result.")
    image_bytes_list = [decode_base64_bytes(str(item["result"])) for item in image_items]
    saved_files = save_images(output_path, image_bytes_list)
    emit_progress_event(
        logger,
        provider="codex",
        phase="output_saved",
        status="completed",
        percent=100,
        message="Generated image files saved.",
        file_count=len(saved_files),
        output=normalize_saved_output(saved_files),
    )
    response_meta = outcome["response"]
    revised_prompts = [item.get("revised_prompt") for item in image_items if item.get("revised_prompt")]
    return CommandOutcome(
        {
            "ok": True,
            "command": f"images {operation}",
            "provider": "codex",
            "provider_selection": {
                "requested": args.provider,
                "resolved": "codex",
                "reason": selection_reason,
            },
            "auth": {
                "source": "auth.json",
                "auth_file": str(auth_path),
                "account_id": auth_state.account_id,
                "refreshed": auth_refreshed,
            },
            "request": summarize_image_request_options(args, "codex", operation, resolved_model),
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "image_count": len(image_items),
                "item_ids": [item.get("id") for item in image_items],
                "revised_prompts": revised_prompts,
            },
            "output": normalize_saved_output(saved_files),
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            },
        }
    )


def build_openai_operation_endpoint(api_base: str, operation: str) -> str:
    base = api_base.rstrip("/")
    if operation == "generate":
        return f"{base}{OPENAI_GENERATIONS_PATH}"
    if operation == "edit":
        return f"{base}{OPENAI_EDITS_PATH}"
    raise CommandError("invalid_operation", f"Unsupported OpenAI image operation: {operation}")


def run_openai_image_command(args: argparse.Namespace, *, operation: str, selection_reason: str) -> CommandOutcome:
    output_path = Path(args.out).expanduser()
    auth_state = load_openai_auth_state(args.api_key)
    ref_images = resolve_ref_images(getattr(args, "ref_image", []) or [])
    mask = resolve_ref_image(args.mask) if getattr(args, "mask", None) else None
    resolved_model = args.model or DEFAULT_OPENAI_MODEL
    body = build_openai_image_body(
        operation=operation,
        prompt=args.prompt,
        model=resolved_model,
        ref_images=ref_images,
        mask=mask,
        input_fidelity=getattr(args, "input_fidelity", None),
        background=args.background,
        size=args.size,
        quality=args.quality,
        output_format=args.format,
        output_compression=args.compression,
        n=args.n,
        moderation=args.moderation,
    )
    logger = JsonEventLogger(enabled=args.json_events, stream=sys.stderr)
    endpoint = build_openai_operation_endpoint(args.openai_api_base, operation)
    if operation == "edit":
        run_once = lambda: request_openai_edit_once(
            endpoint=endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        )
    else:
        run_once = lambda: request_openai_images_once(
            endpoint=endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        )
    payload, _, retry_count = execute_with_retry(
        run_once=run_once,
        logger=logger,
        provider="openai",
    )
    image_bytes_list, revised_prompts = decode_openai_images(payload)
    if not image_bytes_list:
        raise CommandError("missing_image_result", "The response did not include a generated image.")
    saved_files = save_images(output_path, image_bytes_list)
    emit_progress_event(
        logger,
        provider="openai",
        phase="output_saved",
        status="completed",
        percent=100,
        message="Generated image files saved.",
        file_count=len(saved_files),
        output=normalize_saved_output(saved_files),
    )
    return CommandOutcome(
        {
            "ok": True,
            "command": f"images {operation}",
            "provider": "openai",
            "provider_selection": {
                "requested": args.provider,
                "resolved": "openai",
                "reason": selection_reason,
            },
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": False,
            },
            "request": summarize_image_request_options(args, "openai", operation, resolved_model),
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": redact_event_payload(payload.get("usage")),
                "image_count": len(image_bytes_list),
                "revised_prompts": [value for value in revised_prompts if value],
            },
            "output": normalize_saved_output(saved_files),
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "events": {
                "count": logger.seq,
            },
        }
    )


def run_doctor(args: argparse.Namespace) -> CommandOutcome:
    auth_path = Path(args.auth_file).expanduser()
    codex_auth = inspect_codex_auth_file(auth_path)
    openai_auth = inspect_openai_auth(args.api_key)
    codex_endpoint = check_endpoint_reachability(args.endpoint)
    openai_endpoint = check_endpoint_reachability(args.openai_api_base)

    selected_provider = None
    selection_reason = None
    selection_error = None
    try:
        selected_provider, selection_reason = select_image_provider(args)
    except CommandError as exc:
        selection_error = {
            "code": exc.code,
            "message": exc.message,
            "detail": redact_event_payload(exc.detail),
        }

    if args.provider == "openai":
        ready = bool(openai_auth["ready"]) and bool(openai_endpoint["reachable"])
    elif args.provider == "codex":
        ready = bool(codex_auth["ready"]) and bool(codex_endpoint["reachable"])
    else:
        ready = (
            (bool(openai_auth["ready"]) and bool(openai_endpoint["reachable"]))
            or (bool(codex_auth["ready"]) and bool(codex_endpoint["reachable"]))
        )

    return CommandOutcome(
        {
            "ok": ready,
            "command": "doctor",
            "version": __version__,
            "provider_selection": {
                "requested": args.provider,
                "resolved": selected_provider,
                "reason": selection_reason,
                "error": selection_error,
            },
            "providers": {
                "openai": {
                    "auth": openai_auth,
                    "endpoint": openai_endpoint,
                },
                "codex": {
                    "auth": codex_auth,
                    "endpoint": codex_endpoint,
                },
            },
            "defaults": {
                "provider": DEFAULT_PROVIDER,
                "openai_model": DEFAULT_OPENAI_MODEL,
                "codex_model": DEFAULT_CODEX_MODEL,
                "codex_endpoint": args.endpoint,
                "openai_api_base": args.openai_api_base,
            },
            "retry_policy": {
                "max_retries": DEFAULT_RETRY_COUNT,
                "base_delay_seconds": DEFAULT_RETRY_DELAY_SECONDS,
            },
        },
        exit_status=0,
    )


def run_auth_inspect(args: argparse.Namespace) -> CommandOutcome:
    auth_path = Path(args.auth_file).expanduser()
    providers = {
        "openai": inspect_openai_auth(args.api_key),
        "codex": inspect_codex_auth_file(auth_path),
    }
    if args.provider == "openai" and not providers["openai"]["ready"]:
        raise CommandError("api_key_missing", f"Missing {OPENAI_API_KEY_ENV}.")
    if args.provider == "codex" and not providers["codex"]["ready"]:
        raise CommandError("access_token_missing", "auth.json did not contain a usable access_token.")
    return CommandOutcome(
        {
            "ok": True,
            "command": "auth inspect",
            "requested_provider": args.provider,
            "providers": providers,
        }
    )


def run_models_list(_: argparse.Namespace) -> CommandOutcome:
    return CommandOutcome(
        {
            "ok": True,
            "command": "models list",
            "providers": {
                "openai": {
                    "default_model": DEFAULT_OPENAI_MODEL,
                    "model_presets": KNOWN_OPENAI_IMAGE_MODEL_PRESETS,
                    "operations": [
                        {"id": "generate", "command": "images generate", "requires_ref_image": False},
                        {"id": "edit", "command": "images edit", "requires_ref_image": True},
                    ],
                    "supports": [
                        "background",
                        "size",
                        "quality",
                        "format",
                        "compression",
                        "n",
                        "moderation",
                        "mask",
                        "input_fidelity",
                    ],
                },
                "codex": {
                    "default_model": DEFAULT_CODEX_MODEL,
                    "model_presets": KNOWN_CODEX_MODEL_PRESETS,
                    "image_generation_tool": {
                        "type": "image_generation",
                        "delegated_model": DELEGATED_IMAGE_MODEL,
                        "operations": [
                            {"id": "generate", "command": "images generate", "requires_ref_image": False},
                            {"id": "edit", "command": "images edit", "requires_ref_image": True},
                        ],
                        "supports": [
                            "background",
                            "size",
                            "quality",
                            "format",
                            "compression",
                            "action",
                            "json_events",
                            "auth_refresh",
                        ],
                    },
                },
            },
        }
    )


def run_images_command(args: argparse.Namespace, *, operation: str) -> CommandOutcome:
    provider, selection_reason = select_image_provider(args)
    validate_provider_specific_image_args(args, provider)
    if provider == "openai":
        return run_openai_image_command(args, operation=operation, selection_reason=selection_reason)
    return run_codex_image_command(args, operation=operation, selection_reason=selection_reason)


def run_images_generate(args: argparse.Namespace) -> CommandOutcome:
    return run_images_command(args, operation="generate")


def run_images_edit(args: argparse.Namespace) -> CommandOutcome:
    return run_images_command(args, operation="edit")


def run_request_create_codex(args: argparse.Namespace, *, selection_reason: str) -> CommandOutcome:
    if args.request_operation != "responses":
        raise CommandError("unsupported_option", "Codex request create uses --request-operation responses.")
    auth_path = Path(args.auth_file).expanduser()
    auth_state = load_codex_auth_state(auth_path)
    body = read_body_json(args.body_file)
    logger = JsonEventLogger(enabled=args.json_events, stream=sys.stderr)
    outcome, auth_refreshed, retry_count = execute_with_retry(
        run_once=lambda: request_codex_responses_once(
            endpoint=args.endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        ),
        logger=logger,
        provider="codex",
        refresh_once=lambda: refresh_access_token(auth_state),
    )
    response_meta = outcome["response"]
    output_items = outcome["output_items"]
    image_items = extract_codex_image_items(output_items)
    image_output: dict[str, Any] | None = None
    if image_items:
        image_bytes_list = [decode_base64_bytes(str(item["result"])) for item in image_items]
        if args.out_image:
            saved_files = save_images(Path(args.out_image).expanduser(), image_bytes_list)
            image_output = normalize_saved_output(saved_files)
            emit_progress_event(
                logger,
                provider="codex",
                phase="output_saved",
                status="completed",
                percent=100,
                message="Generated image files saved.",
                file_count=len(saved_files),
                output=image_output,
            )
        else:
            image_output = {
                "available": True,
                "count": len(image_bytes_list),
                "suggested_extension": detect_extension(image_bytes_list[0]),
            }
            emit_progress_event(
                logger,
                provider="codex",
                phase="image_available",
                status="completed",
                percent=100,
                message="Generated image bytes are available in the response.",
                image_output=image_output,
            )
    if args.expect_image and image_output is None:
        raise CommandError("missing_image_result", "The response did not include a generated image.")

    return CommandOutcome(
        {
            "ok": True,
            "command": "request create",
            "provider": "codex",
            "provider_selection": {
                "requested": args.provider,
                "resolved": "codex",
                "reason": selection_reason,
            },
            "request": {
                "operation": "responses",
                "body_file": args.body_file,
            },
            "response": {
                "response_id": response_meta.get("id"),
                "model": response_meta.get("model"),
                "service_tier": response_meta.get("service_tier"),
                "status": response_meta.get("status"),
                "error": redact_event_payload(response_meta.get("error")),
            },
            "output_items": [summarize_output_item(item) for item in output_items],
            "image_output": image_output,
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": "auth.json",
                "auth_file": str(auth_path),
                "refreshed": auth_refreshed,
            },
            "events": {
                "count": logger.seq,
            },
        }
    )


def run_request_create_openai(args: argparse.Namespace, *, selection_reason: str) -> CommandOutcome:
    if args.request_operation not in {"generate", "edit"}:
        raise CommandError("unsupported_option", "OpenAI request create uses --request-operation generate or edit.")
    auth_state = load_openai_auth_state(args.api_key)
    body = read_body_json(args.body_file)
    endpoint = build_openai_operation_endpoint(args.openai_api_base, args.request_operation)
    logger = JsonEventLogger(enabled=args.json_events, stream=sys.stderr)
    if args.request_operation == "edit":
        run_once = lambda: request_openai_edit_once(
            endpoint=endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        )
    else:
        run_once = lambda: request_openai_images_once(
            endpoint=endpoint,
            auth_state=auth_state,
            body=body,
            logger=logger,
        )
    payload, _, retry_count = execute_with_retry(
        run_once=run_once,
        logger=logger,
        provider="openai",
    )
    image_bytes_list, revised_prompts = decode_openai_images(payload)
    image_output: dict[str, Any] | None = None
    if image_bytes_list:
        if args.out_image:
            saved_files = save_images(Path(args.out_image).expanduser(), image_bytes_list)
            image_output = normalize_saved_output(saved_files)
            emit_progress_event(
                logger,
                provider="openai",
                phase="output_saved",
                status="completed",
                percent=100,
                message="Generated image files saved.",
                file_count=len(saved_files),
                output=image_output,
            )
        else:
            image_output = {
                "available": True,
                "count": len(image_bytes_list),
                "suggested_extension": detect_extension(image_bytes_list[0]),
            }
            emit_progress_event(
                logger,
                provider="openai",
                phase="image_available",
                status="completed",
                percent=100,
                message="Generated image bytes are available in the response.",
                image_output=image_output,
            )
    if args.expect_image and image_output is None:
        raise CommandError("missing_image_result", "The response did not include a generated image.")

    return CommandOutcome(
        {
            "ok": True,
            "command": "request create",
            "provider": "openai",
            "provider_selection": {
                "requested": args.provider,
                "resolved": "openai",
                "reason": selection_reason,
            },
            "request": {
                "operation": args.request_operation,
                "body_file": args.body_file,
                "model": body.get("model"),
            },
            "response": {
                "created": payload.get("created"),
                "background": payload.get("background"),
                "output_format": payload.get("output_format"),
                "quality": payload.get("quality"),
                "size": payload.get("size"),
                "usage": redact_event_payload(payload.get("usage")),
                "revised_prompts": [value for value in revised_prompts if value],
            },
            "image_output": image_output,
            "retry": {
                "count": retry_count,
                "max_retries": DEFAULT_RETRY_COUNT,
            },
            "auth": {
                "source": auth_state.source,
                "env_var": OPENAI_API_KEY_ENV,
                "refreshed": False,
            },
            "events": {
                "count": logger.seq,
            },
        }
    )


def run_request_create(args: argparse.Namespace) -> CommandOutcome:
    provider, selection_reason = select_request_provider(args)
    if provider == "openai":
        return run_request_create_openai(args, selection_reason=selection_reason)
    return run_request_create_codex(args, selection_reason=selection_reason)


def dispatch(args: argparse.Namespace) -> CommandOutcome:
    if args.command == "doctor":
        return run_doctor(args)
    if args.command == "auth" and args.auth_command == "inspect":
        return run_auth_inspect(args)
    if args.command == "models" and args.models_command == "list":
        return run_models_list(args)
    if args.command == "images" and args.images_command == "generate":
        return run_images_generate(args)
    if args.command == "images" and args.images_command == "edit":
        return run_images_edit(args)
    if args.command == "request" and args.request_command == "create":
        return run_request_create(args)
    raise CommandError("invalid_command", "Unknown command.")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        outcome = dispatch(args)
    except KeyboardInterrupt:
        payload, exit_status = build_error_payload(
            CommandError("interrupted", "Interrupted by user.", exit_status=130)
        )
        emit_json(payload)
        return exit_status
    except Exception as exc:
        payload, exit_status = build_error_payload(exc)
        emit_json(payload)
        return exit_status

    emit_json(outcome.payload)
    return outcome.exit_status
