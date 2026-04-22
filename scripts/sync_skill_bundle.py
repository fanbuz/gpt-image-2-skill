#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "src" / "codex_auth_imagegen" / "__init__.py"
CLI_FILE = ROOT / "src" / "codex_auth_imagegen" / "cli.py"
SKILL_NAME = "gpt-image-2-skill"
SCRIPT_NAME = "gpt_image_2_skill.py"
SKILL_SCRIPT = ROOT / "skills" / SKILL_NAME / "scripts" / SCRIPT_NAME
LEGACY_SKILL_SCRIPT = ROOT / "skills" / SKILL_NAME / "scripts" / "codex_auth_imagegen.py"


def read_version() -> str:
    content = VERSION_FILE.read_text()
    match = re.search(r'__version__\s*=\s*"([^"]+)"', content)
    if not match:
        raise SystemExit("Unable to determine __version__ from __init__.py")
    return match.group(1)


def build_script_text(version: str, cli_source: str) -> str:
    rewritten = cli_source.replace('from . import __version__', f'__version__ = "{version}"')
    header = "\n".join(
        [
            "#!/usr/bin/env python3",
            '"""Bundled skill runtime for gpt-image-2-skill.',
            "",
            "Generated from src/codex_auth_imagegen/cli.py by scripts/sync_skill_bundle.py.",
            '"""',
            "",
        ]
    )
    footer = "\n".join(
        [
            "",
            "",
            'if __name__ == "__main__":',
            "    raise SystemExit(main())",
            "",
        ]
    )
    return header + rewritten + footer


def main() -> int:
    version = read_version()
    cli_source = CLI_FILE.read_text()
    script_text = build_script_text(version, cli_source)
    SKILL_SCRIPT.parent.mkdir(parents=True, exist_ok=True)
    SKILL_SCRIPT.write_text(script_text)
    if LEGACY_SKILL_SCRIPT.exists():
        LEGACY_SKILL_SCRIPT.unlink()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
