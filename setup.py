from setuptools import find_packages, setup


setup(
    name="gpt-image-2-skill",
    version="0.2.0",
    description="Agent-first CLI and skill runtime for GPT Image 2 through OpenAI API keys or Codex auth.json.",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    entry_points={
        "console_scripts": [
            "gpt-image-2-skill=codex_auth_imagegen.cli:main",
        ]
    },
)
