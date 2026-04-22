#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
CLI = BASE_DIR / "gpt_image_2_skill.py"


def run_json(*args: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(CLI), "--json", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "invalid_json_output",
                        "message": "Bundled CLI did not emit JSON.",
                        "stdout": result.stdout,
                        "stderr": result.stderr,
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from exc


def main() -> int:
    doctor = run_json("doctor")
    auth = run_json("auth", "inspect")
    models = run_json("models", "list")
    summary = {
        "doctor_ok": doctor.get("ok"),
        "requested_provider": doctor.get("provider_selection", {}).get("requested"),
        "resolved_provider": doctor.get("provider_selection", {}).get("resolved"),
        "auth_openai_ready": auth.get("providers", {}).get("openai", {}).get("ready"),
        "auth_codex_ready": auth.get("providers", {}).get("codex", {}).get("ready"),
        "providers": sorted((models.get("providers") or {}).keys()),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
