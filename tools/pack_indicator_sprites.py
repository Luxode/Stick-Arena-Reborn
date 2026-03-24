#!/usr/bin/env python3
"""
pack_indicator_sprites.py  —  Pack indicator spinner sprites into a spritesheet.

Reads:
  TEMP_NEW_SPRITES/indicator/sprites/DefineSprite_{ID}_indicatorMC{N}/
    Frames are  1.png, 2.png, …, N.png  (numeric sort).

Rules:
  • 1 PNG in folder  → "rotary" spinner: single frame, rotated continuously
                        in client code (ctx.rotate based on Date.now()).
  • >1 PNGs in folder → "animated" spinner: all frames packed and stepped
                        through in client code; no rotation applied.
                        All animated spinners run at ANIMATED_FPS frames/sec.

For animated spinners, the union bounding box across all frames is used for
consistent cropping so the graphic stays anchored within its frame.

Writes:
  client/sprites/indicator/spritesheet.png
  client/sprites/indicator/spritesheet.json

Output JSON format  (consumed by AtlasSpritesheet.js)
─────────────────────────────────────────────────────
  {
    "meta": { "image": "spritesheet.png", "size": {"w": W, "h": H}, ... },
    "frames": {
      "{id}_indicatorMC{N}_000": { "x": X, "y": Y, "w": W, "h": H },
      "{id}_indicatorMC{N}_001": { ... },
      ...
    },
    "animations": [
      { "name": "{id}_indicatorMC{N}", "fps": 12,
        "frames": ["{id}_indicatorMC{N}_000", ...] },
      ...
    ]
  }

Client behaviour (Player.js _drawIndicator):
  anim.frames.length === 1  →  rotary:   ctx.rotate() + frame 0
  anim.frames.length  >  1  →  animated: time-based frameIndex, no rotation
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ── Config ──────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent
SPRITES_DIR = ROOT / "TEMP_NEW_SPRITES" / "indicator" / "sprites"
OUTPUT_DIR  = ROOT / "client" / "sprites" / "indicator"
OUTPUT_PNG  = OUTPUT_DIR / "spritesheet.png"
OUTPUT_JSON = OUTPUT_DIR / "spritesheet.json"

ROTARY_FPS   = 24   # fps for rotary (1-frame) spinners; irrelevant at runtime (rotation uses Date.now())
ANIMATED_FPS = 24   # frame rate for animated spinners
MAX_SHEET_W  = 4096
PADDING     = 2      # px gap between packed frames
ALPHA_MIN   = 10     # pixels below this alpha are treated as fully transparent

# ── Helpers ─────────────────────────────────────────────────────────────────────

FOLDER_RE = re.compile(r'^DefineSprite_(\d+)_indicatorMC(\d+)$', re.IGNORECASE)


def folder_sort_key(p: Path) -> int:
    m = FOLDER_RE.match(p.name)
    return int(m.group(1)) if m else 999_999


def numeric_sort(path: Path) -> int:
    try:
        return int(path.stem)
    except ValueError:
        return 0


def load_frame(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"), dtype=np.uint8)


def tight_bbox_union(frames: list[np.ndarray]) -> tuple[int, int, int, int]:
    """Return (x_min, y_min, x_max, y_max) union of all opaque-pixel bboxes."""
    h, w = frames[0].shape[:2]
    x_min, y_min = w, h
    x_max, y_max = 0, 0
    any_opaque = False
    for arr in frames:
        ys, xs = np.where(arr[:, :, 3] > ALPHA_MIN)
        if not len(ys):
            continue
        any_opaque = True
        x_min = min(x_min, int(xs.min()))
        y_min = min(y_min, int(ys.min()))
        x_max = max(x_max, int(xs.max()))
        y_max = max(y_max, int(ys.max()))
    if not any_opaque:
        return 0, 0, w - 1, h - 1
    return x_min, y_min, x_max, y_max


def next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


# ── Scan folders ─────────────────────────────────────────────────────────────────

if not SPRITES_DIR.exists():
    sys.exit(f"ERROR: sprites directory not found:\n  {SPRITES_DIR}")

entries: list[tuple[int, int, str, list[Path], bool]] = []

for folder in sorted(SPRITES_DIR.iterdir(), key=folder_sort_key):
    m = FOLDER_RE.match(folder.name)
    if not m or not folder.is_dir():
        continue

    sprite_id = int(m.group(1))
    mc_num    = int(m.group(2))
    pngs = sorted(
        [p for p in folder.iterdir() if p.suffix.lower() == ".png"],
        key=numeric_sort,
    )
    if not pngs:
        print(f"  WARNING: no PNGs in {folder.name}, skipping")
        continue

    anim_name = f"{sprite_id}_indicatorMC{mc_num}"
    rotary    = len(pngs) == 1
    entries.append((sprite_id, mc_num, anim_name, pngs, rotary))

n_rotary   = sum(1 for e in entries if e[4])
n_animated = len(entries) - n_rotary
print(f"Found {len(entries)} indicator sprites  ({n_rotary} rotary, {n_animated} animated)\n")

# ── Process each sprite ──────────────────────────────────────────────────────────
# Produces: list of (anim_name, [(frame_key, cropped_arr), ...], rotary)

ProcessedEntry = tuple[str, list[tuple[str, np.ndarray]], bool, int]
processed: list[ProcessedEntry] = []

for sprite_id, mc_num, anim_name, pngs, rotary in entries:
    frames_raw = [load_frame(p) for p in pngs]

    # Crop to union bbox so all frames share the same canvas size.
    x_min, y_min, x_max, y_max = tight_bbox_union(frames_raw)
    cw = x_max - x_min + 1
    ch = y_max - y_min + 1
    cropped = [arr[y_min : y_max + 1, x_min : x_max + 1] for arr in frames_raw]

    frame_entries = [
        (f"{anim_name}_{i:03d}", tile)
        for i, tile in enumerate(cropped)
    ]

    kind = "rotary" if rotary else f"animated / {len(pngs)} frames"
    fps_val = ROTARY_FPS if rotary else ANIMATED_FPS
    print(f"  {anim_name:<28}  {kind:<26}  {cw}×{ch}  fps={fps_val}")
    processed.append((anim_name, frame_entries, rotary, fps_val))

# ── Pack into atlas (shelf algorithm) ────────────────────────────────────────────

# Flatten to (frame_key, anim_name, tile_arr, rotary)
flat: list[tuple[str, str, np.ndarray, bool]] = []
for anim_name, frame_entries, rotary, fps_val in processed:
    for fkey, tile in frame_entries:
        flat.append((fkey, anim_name, tile, rotary))

rows: list[list[tuple[str, str, np.ndarray, bool]]] = []
cur_row: list[tuple] = []
cur_w = 0

for item in flat:
    fkey, anim_name, tile, rotary = item
    tw = tile.shape[1]
    if cur_row and cur_w + tw + PADDING > MAX_SHEET_W:
        rows.append(cur_row)
        cur_row = []
        cur_w = 0
    cur_row.append(item)
    cur_w += tw + PADDING  # slight overcount on first item; inconsequential

if cur_row:
    rows.append(cur_row)

content_h = (
    sum(max(t.shape[0] for _, _, t, _ in row) + PADDING for row in rows) - PADDING
    if rows else 0
)
atlas_w = MAX_SHEET_W
atlas_h = next_pow2(content_h) if content_h > 0 else 1

print(f"\nAtlas: {atlas_w} × {atlas_h}  (content height {content_h})")

atlas_img  = np.zeros((atlas_h, atlas_w, 4), dtype=np.uint8)
out_frames: dict[str, dict] = {}

cur_y = 0
for row in rows:
    row_h = max(t.shape[0] for _, _, t, _ in row)
    cur_x = 0
    for fkey, anim_name, tile, _ in row:
        th, tw = tile.shape[:2]
        atlas_img[cur_y : cur_y + th, cur_x : cur_x + tw] = tile
        out_frames[fkey] = {"x": cur_x, "y": cur_y, "w": tw, "h": th}
        cur_x += tw + PADDING
    cur_y += row_h + PADDING

# ── Build JSON ────────────────────────────────────────────────────────────────────

animation_list: list[dict] = []
for anim_name, frame_entries, rotary, fps_val in processed:
    animation_list.append({
        "name":   anim_name,
        "fps":    fps_val,
        "frames": [fkey for fkey, _ in frame_entries],
    })

content_w = (
    max(f["x"] + f["w"] for f in out_frames.values())
    if out_frames else 0
)

output_json = {
    "meta": {
        "image":   "spritesheet.png",
        "size":    {"w": atlas_w, "h": atlas_h},
        "content": {"w": content_w, "h": content_h},
        "padding": PADDING,
        "pot":     True,
    },
    "frames":     out_frames,
    "animations": animation_list,
}

# ── Write output ─────────────────────────────────────────────────────────────────

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

Image.fromarray(atlas_img, "RGBA").save(OUTPUT_PNG, optimize=True)
print(f"Saved  {OUTPUT_PNG.relative_to(ROOT)}")

with open(OUTPUT_JSON, "w", encoding="utf-8", newline="\n") as f:
    json.dump(output_json, f, indent=2)
print(f"Saved  {OUTPUT_JSON.relative_to(ROOT)}")

print("\nDone.")
