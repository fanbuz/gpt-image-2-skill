# gpt-image-2-skill

One repo with two delivery surfaces:

- a local CLI for direct use
- a bundled skill repo shape for `npx skills add`

## Skill Install

After pushing this repo to GitHub, install the skill with:

```bash
npx skills add https://github.com/Wangnov/gpt-image-2-skill --skill gpt-image-2-skill
```

The distributable skill lives in `skills/gpt-image-2-skill/` and includes its own runnable Python scripts.

## CLI Install

```bash
cd /path/to/gpt-image-2-skill
make install-local
```

`make install-local` installs the package with `pip --user` and writes a stable wrapper to `~/.local/bin/gpt-image-2-skill`.

## Repo Layout

```text
skills/gpt-image-2-skill/
  SKILL.md
  agents/openai.yaml
  scripts/gpt_image_2_skill.py
  scripts/selftest.py

src/codex_auth_imagegen/
  cli.py
```

`scripts/sync_skill_bundle.py` vendors the current CLI implementation into the skill bundle so the installed skill stays self-contained.

## Command surface

CLI form:

```bash
gpt-image-2-skill --json doctor
gpt-image-2-skill --json auth inspect
gpt-image-2-skill --json models list
gpt-image-2-skill --json images generate --prompt "..." --out ./image.png
gpt-image-2-skill --json images edit --prompt "..." --ref-image ./input.png --out ./edited.png
gpt-image-2-skill --json request create --request-operation responses --body-file ./body.json
gpt-image-2-skill --json --provider openai request create --request-operation generate --body-file ./body.json
```

Bundled skill form:

```bash
python3 skills/gpt-image-2-skill/scripts/gpt_image_2_skill.py --json doctor
python3 skills/gpt-image-2-skill/scripts/gpt_image_2_skill.py --json images generate --prompt "..." --out ./image.png
python3 skills/gpt-image-2-skill/scripts/selftest.py
```

## Auth policy

- `openai` reads `OPENAI_API_KEY` by default. `--api-key` exists for explicit one-off tests.
- `codex` reads `~/.codex/auth.json` by default or `$CODEX_HOME/auth.json` when `CODEX_HOME` is set.
- the Codex provider refreshes the access token automatically on one `401`
- both providers retry transient failures up to 3 times with exponential backoff

## Provider model policy

- `openai` defaults to `gpt-image-2`
- `codex` defaults to `gpt-5.4` and delegates image generation to the `image_generation` tool
- `-m/--model` is provider-native

## Common image options

- `--background auto|opaque|transparent`
- `--size auto|2K|4K|WIDTHxHEIGHT`
- `2K` resolves to `2048x2048`
- `4K` resolves to `3840x2160`
- portrait 4K uses `2160x3840`
- square high-resolution requests top out at `2880x2880`
- custom `WIDTHxHEIGHT` values follow the current OpenAI image constraints: both edges are multiples of 16, max edge `3840`, max total pixels `8294400`, max aspect ratio `3:1`
- `--quality auto|low|medium|high`
- `--format png|jpeg|webp`
- `--compression 0-100`

## Provider-specific image options

- `openai`: `--n`, `--moderation`, `--mask`, `--input-fidelity`
- `codex`: `--instructions`, `--json-events`, automatic auth refresh, SSE event logging

## JSON policy

- JSON is the primary output surface and is emitted to stdout.
- progress events, retry notices, and raw Codex SSE events are emitted to stderr only.
- success responses use a top-level `{ "ok": true, ... }` envelope.
- failures use `{ "ok": false, "error": { "code", "message", "detail?" } }`.
- tokens and API keys are never printed.

## Progress events

- `--json-events` emits JSON Lines to `stderr`.
- `kind: "progress"` is the stable cross-provider surface for scripts.
- `kind: "sse"` carries raw Codex server events for live Codex-specific consumers.
- `openai` emits coarse phases such as `request_started`, `multipart_prepared`, `request_completed`, and `output_saved`.
- `codex` emits the same stable progress phases plus raw SSE events such as `response.created`, `response.output_item.done`, and `response.completed`.

Example:

```bash
gpt-image-2-skill --json --json-events images generate \
  --prompt "A glossy red apple sticker" \
  --out /tmp/apple.png \
  2>/tmp/progress.jsonl
```

## Examples

Generate with provider auto:

```bash
gpt-image-2-skill --json images generate \
  --prompt "A glossy red apple sticker" \
  --out /tmp/apple.png
```

Generate through the official Images API:

```bash
OPENAI_API_KEY=... gpt-image-2-skill --json \
  --provider openai \
  images generate \
  --prompt "A studio photo of a red apple on transparent background" \
  --out /tmp/apple.png \
  --format png \
  --quality high \
  --size 2K
```

Edit through the Codex backend:

```bash
gpt-image-2-skill --json \
  --provider codex \
  --json-events \
  images edit \
  --prompt "Turn this apple into a glossy product shot" \
  --ref-image /tmp/apple.png \
  --out /tmp/apple-edit.png \
  --background auto
```

Landscape 4K and portrait 4K examples:

```bash
gpt-image-2-skill --json images generate \
  --prompt "A cinematic city skyline at sunset" \
  --out /tmp/skyline.png \
  --size 4K

gpt-image-2-skill --json images generate \
  --prompt "A full-length fashion editorial portrait" \
  --out /tmp/portrait.png \
  --size 2160x3840
```

## Validation

```bash
python3 scripts/sync_skill_bundle.py
python3 scripts/smoke_skill_install.py
python3 -m unittest discover -s tests -p 'test_*.py'
python3 skills/gpt-image-2-skill/scripts/selftest.py
```

For a direct local install dry run:

```bash
npx skills add "$(pwd)" --skill gpt-image-2-skill -y
```
