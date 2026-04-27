# Transparent PNG playbook

Use this reference when the user asks for a final transparent-background PNG. The CLI is a tool layer; the Agent is responsible for choosing prompts, backgrounds, and retry strategy.

## Command roles

| Command | Role |
|---|---|
| `transparent generate` | Prompt-to-final PNG. Generates one controlled matte source, extracts alpha locally, verifies, and fails if the final PNG is not usable. |
| `transparent extract` | Local alpha extraction from existing source images. Use this for difficult assets, custom source prompts, or multi-background flows. |
| `transparent verify` | Final acceptance gate. Use `--strict` before delivery. |

Do not treat provider-native `--background transparent` as the reliable path, especially with Codex. Controlled backgrounds plus local extraction are the reliable path.

## Default loop

1. Start with `transparent generate` for ordinary isolated assets.
2. If verification fails, keep sources with `--report-dir` and inspect the source matte.
3. Change the matte color or source prompt, then call `transparent extract`.
4. For translucency or glow, create black and white variants and use dual extraction.
5. Run `transparent verify --strict` on the final PNG.
6. Deliver only the verified PNG unless the user asked for diagnostics.

## Prompt rules for controlled mattes

Use the prompt to control the scene, not to request alpha directly:

- Ask for one isolated asset, centered, with clear margin.
- Ask for a perfectly flat, uniform background color.
- Forbid gradients, texture, scenery, shadows, reflections, labels, frames, and contact shadows unless they are part of the asset.
- Pick a background color that does not appear in the object.
- If a color contaminates edges, retry with magenta, cyan, blue, green, black, or white.

Example source prompt:

```text
a polished fantasy sword game asset, centered, full blade visible, no text, no frame.
Render on a perfectly flat pure magenta background. No shadows, gradients, texture, scenery, reflections, or background-colored details.
```

## Method selection

### Opaque entities

Use a single chroma matte.

```bash
node scripts/gpt_image_2_skill.cjs --json --json-events \
  transparent generate \
  --prompt "a polished fantasy sword game asset, no text, no frame" \
  --out /tmp/sword.png --size 2K --quality high
```

If the object contains green, avoid green:

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --method chroma \
  --input /tmp/source-magenta.png --matte-color magenta \
  --out /tmp/asset.png --strict
```

### Hair, fur, lace, chains, nets

Use higher resolution and a matte color with strong contrast. Thin structures are sensitive to background spill.

Good source prompt details:

- `high resolution`
- `crisp separated strands`
- `no shadow`
- `clear margin around every edge`
- `flat pure magenta/cyan background`

Retry by changing matte color if verification warns about edges or the visual preview shows residue.

### Glass, liquid, transparent plastic, holograms

Use dual-background extraction. Generate or edit two aligned source images:

- one on pure black
- one on pure white

Use reference editing where possible so the geometry remains aligned.

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --method dual \
  --dark-image /tmp/glass-black.png \
  --light-image /tmp/glass-white.png \
  --out /tmp/glass.png --strict
```

Dual extraction preserves semi-transparency better than chroma extraction.

### Glow, flame, smoke, mist, magic particles

Prefer dual extraction. The final PNG should have non-zero `partial_pixels`.

Source prompt rules:

- Keep the effect away from image edges unless edge cutoff is intended.
- Avoid background texture.
- Ask for the same composition on black and white backgrounds.
- Use `transparent verify` and check `partial_pixels`, `alpha_max`, and `warnings`.

### Shadows

Decide if the shadow belongs to the asset.

- If no: forbid contact shadows in the source prompt.
- If yes: use enough margin and either chroma extraction for simple hard shadows or dual extraction for soft translucent shadows.

## Verification

Always verify:

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent verify --input /tmp/asset.png --strict
```

Important fields:

| Field | Meaning |
|---|---|
| `passed` | The CLI acceptance gate. Deliver only if true. |
| `input_has_alpha` | The file is encoded with alpha. |
| `alpha_min` | Should be near 0 for a real transparent background. |
| `alpha_max` | Should be greater than 20; fully semi-transparent assets do not need 255. |
| `transparent_ratio` | Confirms there is actual transparent background area. |
| `partial_pixels` | Important for glow, smoke, glass, hair edges, and shadows. |
| `warnings` | Edge contact or missing semi-transparency warnings. |

## Failure handling

| Symptom | Action |
|---|---|
| `transparent_verification_failed` | Do not deliver. Retry with a different matte or dual extraction. |
| Edge residue | Change matte color, increase contrast, or reduce source shadows. |
| Object partially removed | Matte color appears in the object; choose a different matte. |
| No semi-transparent pixels for glow/glass | Use dual extraction instead of chroma. |
| Dual extraction looks noisy | The two source images are not aligned; regenerate via edit/reference flow. |
| Object touches image edge | Regenerate with more margin or larger canvas. |

Keep source files only while iterating:

```bash
node scripts/gpt_image_2_skill.cjs --json --json-events \
  transparent generate \
  --prompt "..." --out /tmp/final.png \
  --report-dir /tmp/transparent-debug
```
