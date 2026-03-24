#!/usr/bin/env python3
"""
pack_tiles.py  —  Pack animated tile sprites into a map atlas.

Reads:
  TEMP_NEW_SPRITES/tiles-animated/sprites/
    Each subdirectory is named  DefineSprite_XXXX_tileTTT  (e.g. DefineSprite_4534_tile1V0).
    Inside, frames are  1.png, 2.png, 3.png, …, N.png  (numeric, unsorted file-system order).

Writes (inside client/sprites/maps/):
  atlas_animated.png   — packed RGBA texture atlas
  atlas_animated.json  — atlas descriptor

JSON format
───────────
{
  "meta": {
    "image": "atlas_animated.png",
    "size":  { "w": W, "h": H }
  },
  "frames": {
    // Single-frame tile (stored under the 3-char key directly):
    "0A0.png": { "frame": { "x": X, "y": Y, "w": 50, "h": 50 }, … },

    // Multi-frame tile (all frames use _f001 / _f002 … suffix):
    "1V0_f001.png": { "frame": { … } },
    "1V0_f002.png": { "frame": { … } },
    …
    // Backward-compat alias for getMapTileFrame() — same rect as _f001:
    "1V0.png": { "frame": { … } },

    // Debug overlay tiles — packed at native size:
    "Col2.png": { "frame": { "x": X, "y": Y, "w": 1,  "h": 1  }, … },
    "Col4.png": { "frame": { "x": X, "y": Y, "w": 52, "h": 52 }, … },
    …
  },
  "tileAnimations": {
    // Only tiles with more than one frame appear here.
    "1V0": { "fps": 12, "frames": ["1V0_f001.png", "1V0_f002.png", …] },
    …
  }
}

Compatibility note
──────────────────
  AtlasSpritesheet.getMapTileFrame("TTT") looks up "TTT.png" in frames.
  Every tile has a "TTT.png" key so existing game code keeps working.
  The new tileAnimations map lets future code cycle through animation frames.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

# ── Config ─────────────────────────────────────────────────────────────────────

ROOT        = Path(__file__).resolve().parent.parent
SPRITES_DIR = ROOT / "TEMP_NEW_SPRITES" / "tiles-animated" / "sprites"
OUTPUT_DIR  = ROOT / "client" / "sprites" / "maps"
OUTPUT_PNG  = OUTPUT_DIR / "atlas.png"
OUTPUT_JSON = OUTPUT_DIR / "atlas.json"

DEFAULT_FPS = 12        # animation playback speed (frames per second)
MAX_SHEET_W = 4096      # atlas width  (power-of-two friendly)
PADDING     = 2         # px gap between frames  (prevents texture bleed)

# ── Helpers ────────────────────────────────────────────────────────────────────

FOLDER_RE = re.compile(r"^DefineSprite_\d+_tile(.+)$")


def parse_tile_key(folder_name: str) -> str | None:
    """Return the tile key embedded in a folder name, or None."""
    m = FOLDER_RE.match(folder_name)
    return m.group(1) if m else None


def numeric_sort_key(path: Path) -> int:
    try:
        return int(path.stem)
    except ValueError:
        return 0


def next_power_of_two(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


# ── Scan input ─────────────────────────────────────────────────────────────────

if not SPRITES_DIR.exists():
    sys.exit(f"ERROR: sprites directory not found:\n  {SPRITES_DIR}")

# tile_key → sorted list of PNG Paths
tiles: dict[str, list[Path]] = {}

for folder in sorted(SPRITES_DIR.iterdir()):
    if not folder.is_dir():
        continue
    key = parse_tile_key(folder.name)
    if key is None:
        print(f"  SKIP (unrecognised folder): {folder.name}")
        continue
    png_paths = sorted(
        [p for p in folder.iterdir() if p.suffix.lower() == ".png"],
        key=numeric_sort_key,
    )
    if not png_paths:
        print(f"  SKIP (no PNGs): {folder.name}")
        continue
    tiles[key] = png_paths

total_frames = sum(len(v) for v in tiles.values())
print(f"Found {len(tiles)} tiles  ({total_frames} total frames)")

# ── Load images ────────────────────────────────────────────────────────────────
# Each entry: (packed_key, alias_key_or_None, PIL.Image)
#   packed_key  — the key under which this image appears in the atlas
#   alias_key   — an extra "TTT.png" alias pointing to the same rect (multi-frame tiles only)

Entry = list[tuple[str, str | None, Image.Image]]

entries: list[tuple[str, str | None, Image.Image]] = []

for tile_key in sorted(tiles.keys()):
    paths = tiles[tile_key]
    n = len(paths)

    for i, path in enumerate(paths):
        img = Image.open(path).convert("RGBA")

        if n == 1:
            # Static tile — store directly under "TTT.png"
            packed_key = f"{tile_key}.png"
            alias      = None
        else:
            # Animated tile — all frames use _f001 / _f002 … suffix
            packed_key = f"{tile_key}_f{i + 1:03d}.png"
            # Frame 1 also gets a bare "TTT.png" alias for backward compat
            alias = f"{tile_key}.png" if i == 0 else None

        entries.append((packed_key, alias, img))

print(f"Packing {len(entries)} frames …")

# ── Row-based bin packing ──────────────────────────────────────────────────────
# Frames are placed left-to-right; a new row starts when the width would exceed
# MAX_SHEET_W.  Each row's height equals the tallest frame in that row.

rows: list[list[tuple[str, str | None, Image.Image]]] = []
cur_row: list[tuple[str, str | None, Image.Image]] = []
cur_row_w = 0

for entry in entries:
    _, _, img = entry
    fw = img.width
    # Width this entry would add (first frame needs no leading padding)
    width_needed = fw + (PADDING if cur_row else 0)
    if cur_row and cur_row_w + width_needed > MAX_SHEET_W:
        rows.append(cur_row)
        cur_row   = []
        cur_row_w = 0
    cur_row.append(entry)
    cur_row_w += fw + (PADDING if len(cur_row) > 1 else 0)

if cur_row:
    rows.append(cur_row)

content_h = sum(max(img.height for _, _, img in row) + PADDING for row in rows) - PADDING
atlas_w   = MAX_SHEET_W
atlas_h   = next_power_of_two(content_h)

print(f"Atlas: {atlas_w} × {atlas_h}  (content height {content_h})")

# ── Compose atlas image ────────────────────────────────────────────────────────

atlas_img = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
frame_rects: dict[str, dict] = {}  # packed_key → {x, y, w, h}

cur_y = 0
for row in rows:
    row_h = max(img.height for _, _, img in row)
    cur_x = 0
    for packed_key, alias, img in row:
        fw, fh = img.width, img.height
        atlas_img.paste(img, (cur_x, cur_y))
        rect = {"x": cur_x, "y": cur_y, "w": fw, "h": fh}
        frame_rects[packed_key] = rect
        # Alias points to the same rectangle — no extra pixels are stored
        if alias is not None:
            frame_rects[alias] = rect
        cur_x += fw + PADDING
    cur_y += row_h + PADDING

# ── Build JSON ─────────────────────────────────────────────────────────────────

frames_json: dict[str, dict] = {}
for key, rect in frame_rects.items():
    frames_json[key] = {
        "frame": rect,
        "rotated": False,
        "trimmed": False,
        "sourceSize":      {"w": rect["w"], "h": rect["h"]},
        "spriteSourceSize": {"x": 0, "y": 0, "w": rect["w"], "h": rect["h"]},
    }

# tileAnimations — only for multi-frame tiles
tile_animations: dict[str, dict] = {}
for tile_key in sorted(tiles.keys()):
    n = len(tiles[tile_key])
    if n > 1:
        frame_keys = [f"{tile_key}_f{i + 1:03d}.png" for i in range(n)]
        tile_animations[tile_key] = {"fps": DEFAULT_FPS, "frames": frame_keys}

atlas_json = {
    "meta": {
        "image":    "atlas.png",
        "size":     {"w": atlas_w, "h": atlas_h},
        "tileSize": {"w": 50, "h": 50},
        "scale":    1,
    },
    "frames":         frames_json,
    "tileAnimations": tile_animations,
}

# ── Write output ───────────────────────────────────────────────────────────────

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

atlas_img.save(OUTPUT_PNG, optimize=True)
print(f"Saved  {OUTPUT_PNG.relative_to(ROOT)}")

with open(OUTPUT_JSON, "w", encoding="utf-8", newline="\n") as f:
    json.dump(atlas_json, f, indent=2)
print(f"Saved  {OUTPUT_JSON.relative_to(ROOT)}")

# ── Summary ────────────────────────────────────────────────────────────────────

animated = [k for k, v in tiles.items() if len(v) > 1]
static   = [k for k, v in tiles.items() if len(v) == 1]
col      = [k for k in tiles if k.startswith("Col")]

print(f"""
Summary
  Total tiles      : {len(tiles)}
  Animated (>1 fr) : {len(animated)}
  Static   (1 fr)  : {len(static)}
  Debug overlays   : {len(col)}  (Col*)
  Total frames     : {total_frames}
  Atlas aliases    : {len(animated)}  ("TTT.png" → _f001 for each animated tile)
""")
