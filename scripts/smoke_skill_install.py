#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_NAME = "gpt-image-2-skill"


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="gpt-image-2-skill-") as temp_dir:
        temp_path = Path(temp_dir)

        install = run(
            [
                "npx",
                "--yes",
                "skills",
                "add",
                str(ROOT),
                "--skill",
                SKILL_NAME,
                "-y",
                "--copy",
            ],
            cwd=temp_path,
        )

        installed_skill = temp_path / ".agents" / "skills" / SKILL_NAME
        expected_files = [
            installed_skill / "SKILL.md",
            installed_skill / "agents" / "openai.yaml",
            installed_skill / "scripts" / "gpt_image_2_skill.py",
            installed_skill / "scripts" / "selftest.py",
        ]
        for path in expected_files:
            if not path.is_file():
                raise SystemExit(f"Missing installed skill file: {path}")

        selftest = run(
            [sys.executable, str(installed_skill / "scripts" / "selftest.py")],
            cwd=temp_path,
        )

        summary = {
            "ok": True,
            "source": str(ROOT),
            "installed_skill": str(installed_skill),
            "install_stdout": install.stdout,
            "selftest": json.loads(selftest.stdout),
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
