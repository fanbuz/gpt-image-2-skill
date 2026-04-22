install-local:
	python3 -m pip install --user .
	mkdir -p "$$HOME/.local/bin"
	printf '%s\n' '#!/bin/sh' 'exec python3 -m codex_auth_imagegen "$$@"' > "$$HOME/.local/bin/gpt-image-2-skill"
	chmod +x "$$HOME/.local/bin/gpt-image-2-skill"

sync-skill:
	python3 scripts/sync_skill_bundle.py
	chmod +x skills/gpt-image-2-skill/scripts/gpt_image_2_skill.py
	chmod +x skills/gpt-image-2-skill/scripts/selftest.py

smoke-skill-install:
	python3 scripts/smoke_skill_install.py

test:
	python3 -m unittest discover -s tests -p 'test_*.py'
