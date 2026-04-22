from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from codex_auth_imagegen import cli


class RetryTests(unittest.TestCase):
    def test_request_responses_with_retry_retries_three_times(self) -> None:
        auth_state = cli.AuthState(
            auth_path=Path("/tmp/auth.json"),
            auth_json={"tokens": {}},
            access_token="token",
            refresh_token="refresh",
            account_id="acct",
        )
        logger = cli.JsonEventLogger(enabled=False, stream=sys.stderr)
        call_count = {"value": 0}

        def flaky_request(**_: object) -> dict[str, object]:
            call_count["value"] += 1
            if call_count["value"] <= 3:
                raise RuntimeError("server_error: transient failure")
            return {"response": {"id": "resp_test"}, "output_items": [], "image_item": None}

        with mock.patch.object(cli, "request_responses_once", side_effect=flaky_request), mock.patch.object(
            cli.time, "sleep", return_value=None
        ):
            outcome, auth_refreshed, retry_count = cli.request_responses_with_retry(
                endpoint="https://example.com",
                auth_state=auth_state,
                body={},
                logger=logger,
            )

        self.assertEqual(call_count["value"], 4)
        self.assertFalse(auth_refreshed)
        self.assertEqual(retry_count, 3)
        self.assertEqual(outcome["response"]["id"], "resp_test")

    def test_should_retry_connection_reset_error(self) -> None:
        self.assertTrue(cli.should_retry_exception(ConnectionResetError("reset")))


class OutputExtractionTests(unittest.TestCase):
    def test_extract_image_item_from_failed_response_output(self) -> None:
        output_items = [
            {
                "id": "ig_1",
                "type": "image_generation_call",
                "status": "generating",
                "result": "YWJj",
            }
        ]
        image_item = cli.extract_image_item(output_items)
        self.assertIsNotNone(image_item)
        self.assertEqual(image_item["id"], "ig_1")

    def test_save_images_adds_number_suffixes_for_multi_image_output(self) -> None:
        with unittest.mock.patch.object(cli, "detect_extension", return_value=".png"):
            saved = cli.save_images(
                Path("/tmp/example.png"),
                [b"image-1", b"image-2"],
            )
        self.assertEqual(saved[0]["path"], "/tmp/example-1.png")
        self.assertEqual(saved[1]["path"], "/tmp/example-2.png")

    def test_decode_base64_bytes_accepts_missing_padding(self) -> None:
        self.assertEqual(cli.decode_base64_bytes("YWJjZA"), b"abcd")

    def test_decode_base64_bytes_accepts_data_url_payload(self) -> None:
        self.assertEqual(cli.decode_base64_bytes("data:image/png;base64,YWJjZA=="), b"abcd")


class AuthInspectTests(unittest.TestCase):
    def test_inspect_auth_file_reports_missing_file(self) -> None:
        auth_info = cli.inspect_auth_file(Path("/tmp/definitely-missing-auth.json"))
        self.assertFalse(auth_info["ready"])
        self.assertEqual(auth_info["auth_source"], "missing")

    def test_inspect_openai_auth_uses_env_source(self) -> None:
        with mock.patch.dict(cli.os.environ, {cli.OPENAI_API_KEY_ENV: "sk-test"}, clear=False):
            auth_info = cli.inspect_openai_auth(None)
        self.assertTrue(auth_info["ready"])
        self.assertEqual(auth_info["auth_source"], "env")

    def test_read_body_json_reads_stdin_dash(self) -> None:
        with mock.patch("sys.stdin.read", return_value=json.dumps({"model": "gpt-5.4"})):
            body = cli.read_body_json("-")
        self.assertEqual(body["model"], "gpt-5.4")


class ParserTests(unittest.TestCase):
    def test_parse_image_size_accepts_aliases(self) -> None:
        self.assertEqual(cli.parse_image_size("2K"), "2048x2048")
        self.assertEqual(cli.parse_image_size("4k"), "3840x2160")

    def test_parse_image_size_accepts_valid_dimensions(self) -> None:
        self.assertEqual(cli.parse_image_size("2880x2880"), "2880x2880")
        self.assertEqual(cli.parse_image_size("2160x3840"), "2160x3840")

    def test_parse_image_size_rejects_oversized_square(self) -> None:
        with self.assertRaises(argparse.ArgumentTypeError):
            cli.parse_image_size("4096x4096")

    def test_parse_image_size_rejects_non_multiple_of_16(self) -> None:
        with self.assertRaises(argparse.ArgumentTypeError):
            cli.parse_image_size("1000x1000")

    def test_parse_image_size_rejects_aspect_ratio_over_limit(self) -> None:
        with self.assertRaises(argparse.ArgumentTypeError):
            cli.parse_image_size("3840x1024")

    def test_images_edit_requires_ref_image(self) -> None:
        with self.assertRaises(SystemExit):
            cli.parse_args(
                [
                    "--json",
                    "images",
                    "edit",
                    "--prompt",
                    "edit this image",
                    "--out",
                    "/tmp/out.png",
                ]
            )

    def test_images_edit_accepts_ref_image(self) -> None:
        args = cli.parse_args(
            [
                "--json",
                "images",
                "edit",
                "--prompt",
                "edit this image",
                "--out",
                "/tmp/out.png",
                "--ref-image",
                "/tmp/input.png",
            ]
        )
        self.assertEqual(args.images_command, "edit")
        self.assertEqual(args.ref_image, ["/tmp/input.png"])

    def test_images_generate_accepts_provider_and_openai_options(self) -> None:
        args = cli.parse_args(
            [
                "--json",
                "--provider",
                "openai",
                "images",
                "generate",
                "--prompt",
                "draw an apple",
                "--out",
                "/tmp/apple.png",
                "--size",
                "1024x1024",
                "--quality",
                "high",
                "--format",
                "png",
                "--n",
                "2",
            ]
        )
        self.assertEqual(args.provider, "openai")
        self.assertEqual(args.n, 2)
        self.assertEqual(args.quality, "high")

    def test_images_generate_normalizes_size_alias(self) -> None:
        args = cli.parse_args(
            [
                "--json",
                "images",
                "generate",
                "--prompt",
                "draw an apple",
                "--out",
                "/tmp/apple.png",
                "--size",
                "2K",
            ]
        )
        self.assertEqual(args.size, "2048x2048")

    def test_images_generate_rejects_invalid_size(self) -> None:
        with self.assertRaises(SystemExit):
            cli.parse_args(
                [
                    "--json",
                    "images",
                    "generate",
                    "--prompt",
                    "draw an apple",
                    "--out",
                    "/tmp/apple.png",
                    "--size",
                    "4096x4096",
                ]
            )


class ProviderSelectionTests(unittest.TestCase):
    def test_select_image_provider_prefers_openai_when_api_key_exists(self) -> None:
        args = cli.parse_args(
            [
                "--json",
                "images",
                "generate",
                "--prompt",
                "draw an apple",
                "--out",
                "/tmp/apple.png",
            ]
        )
        with mock.patch.object(cli, "inspect_openai_auth", return_value={"ready": True}), mock.patch.object(
            cli, "inspect_codex_auth_file", return_value={"ready": True}
        ):
            provider, reason = cli.select_image_provider(args)
        self.assertEqual(provider, "openai")
        self.assertEqual(reason, "auto_openai_api_key")

    def test_build_openai_image_body_for_edit_includes_mask_and_images(self) -> None:
        body = cli.build_openai_image_body(
            operation="edit",
            prompt="edit this image",
            model="gpt-image-2",
            ref_images=["data:image/png;base64,AAAA"],
            mask="data:image/png;base64,BBBB",
            input_fidelity="high",
            background="auto",
            size="1024x1024",
            quality="high",
            output_format="png",
            output_compression=None,
            n=1,
            moderation="auto",
        )
        self.assertEqual(body["images"][0]["image_url"], "data:image/png;base64,AAAA")
        self.assertEqual(body["mask"]["image_url"], "data:image/png;base64,BBBB")
        self.assertEqual(body["input_fidelity"], "high")
        self.assertEqual(body["model"], "gpt-image-2")

    def test_build_openai_edit_multipart_payload_contains_image_and_mask_parts(self) -> None:
        boundary, payload = cli.build_openai_edit_multipart_payload(
            {
                "model": "gpt-image-2",
                "prompt": "Edit this image",
                "images": [{"image_url": "data:image/png;base64,YWJjZA=="}],
                "mask": {"image_url": "data:image/png;base64,YWJjZA=="},
                "size": "1024x1024",
            }
        )
        self.assertIn(boundary.encode("utf-8"), payload)
        self.assertIn(b'name="image[]"', payload)
        self.assertIn(b'name="mask"', payload)
        self.assertIn(b'name="model"', payload)


class ProgressEventTests(unittest.TestCase):
    def test_emit_progress_event_writes_json_line(self) -> None:
        stream = io.StringIO()
        logger = cli.JsonEventLogger(enabled=True, stream=stream)

        cli.emit_progress_event(
            logger,
            provider="openai",
            phase="request_started",
            status="running",
            percent=0,
            message="OpenAI image request sent.",
            endpoint="https://example.com/v1/images/generations",
        )

        record = json.loads(stream.getvalue().strip())
        self.assertEqual(record["kind"], "progress")
        self.assertEqual(record["type"], "request_started")
        self.assertEqual(record["data"]["provider"], "openai")
        self.assertEqual(record["data"]["percent"], 0)
        self.assertEqual(record["data"]["status"], "running")


class SkillBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "sync_skill_bundle.py")],
            check=True,
            capture_output=True,
            text=True,
        )

    def test_skill_repo_contains_installable_files(self) -> None:
        skill_dir = ROOT / "skills" / "gpt-image-2-skill"
        self.assertTrue((skill_dir / "SKILL.md").is_file())
        self.assertTrue((skill_dir / "agents" / "openai.yaml").is_file())
        self.assertTrue((skill_dir / "scripts" / "gpt_image_2_skill.py").is_file())
        self.assertTrue((skill_dir / "scripts" / "selftest.py").is_file())

    def test_bundled_script_is_directly_runnable(self) -> None:
        bundle = ROOT / "skills" / "gpt-image-2-skill" / "scripts" / "gpt_image_2_skill.py"
        bundle_text = bundle.read_text()
        self.assertIn('__version__ = "', bundle_text)
        self.assertIn('if __name__ == "__main__":', bundle_text)
        self.assertIn('CLI_NAME = "gpt-image-2-skill"', bundle_text)

        result = subprocess.run(
            [sys.executable, str(bundle), "--json", "doctor"],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)
        self.assertIn("ok", payload)
        self.assertIn("provider_selection", payload)

    def test_selftest_runs_against_bundled_script(self) -> None:
        selftest = ROOT / "skills" / "gpt-image-2-skill" / "scripts" / "selftest.py"
        result = subprocess.run(
            [sys.executable, str(selftest)],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)
        self.assertIn("doctor_ok", payload)
        self.assertIn("providers", payload)

    def test_readme_mentions_skills_add_install(self) -> None:
        readme = (ROOT / "README.md").read_text()
        self.assertIn("npx skills add https://github.com/Wangnov/gpt-image-2-skill --skill gpt-image-2-skill", readme)
        self.assertIn('npx skills add "$(pwd)" --skill gpt-image-2-skill -y', readme)
        self.assertIn("kind: \"progress\"", readme)


if __name__ == "__main__":
    unittest.main()
