#!/usr/bin/env python3
"""
pack_player_sprites.py  —  Pack player animation sprites into a spritesheet.

Reads:
  TEMP_NEW_SPRITES/player/sprites/DefineSprite_XXXX/
    Frames are  1.png, 2.png, …, N.png  (numeric sort).

Writes:
  client/sprites/player/spritesheet.png
  client/sprites/player/spritesheet.json

Processing per animation
─────────────────────────
  • Shoot animations (name contains "shoot"): frame 1 is a collision-hitbox
    placeholder — it is SKIPPED.
  • Blue head pixels (the head circle is blue in ~half the frames):
    any pixel with alpha > 0 where blue is dominant is converted to black,
    preserving the original alpha to keep anti-aliasing clean.
  • Bounding box: the UNION of tight bounding boxes across every frame in the
    animation is used for cropping so shapes stay consistent (i.e. a character
    that lunges forward does not shift within the frame).
  • Origin: centroid of the head circle, detected from frames where the head
    is blue (easiest to isolate).  Average of first-3 and last-3 blue-head
    frames.  Stored both per-frame and in set_origins.

Output JSON format  (matches AtlasSpritesheet.js)
──────────────────────────────────────────────────
  {
    "frames": {
      "fist_idle_000": { "x": X, "y": Y, "w": W, "h": H,
                         "origin": { "ox": OX, "oy": OY } },
      …
    },
    "set_origins": {
      "fist_idle": { "ox": OX, "oy": OY },
      …
    },
    "animations": [
      { "name": "fist_idle", "fps": 12,
        "frames": ["fist_idle_000", "fist_idle_001", …] },
      …
    ]
  }
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ── Animation name map ─────────────────────────────────────────────────────────
# sprite_id (str) → display name
# Add new entries here when more animations arrive.
SPRITE_MAP: dict[str, str] = {
    "1799": "walk",
    "1800": "run",
    "1805": "fist idle",
    "1815": "fist walk",
    "1821": "fist shoot 1",
    "1825": "fist shoot 2",
    "1836": "fist shoot 3",
    "1849": "bat idle",
    "1856": "bat walk",
    "1884": "bat shoot",
    "1896": "katana idle",
    "1936": "katana shoot 1",
    "1965": "katana shoot 2",
    "1986": "katana shoot 3",
    "1992": "glock idle",
    "1995": "glock walk",
    "2001": "glock shoot",
    "2010": "ak47 idle",
    "2016": "ak47 walk",
    "2022": "ak47 shoot",
    "2034": "shotgun idle",
    "2045": "shotgun walk",
    "2058": "shotgun shoot",
    "2071": "sledgehammer idle",
    "2077": "sledgehammer walk",
    "2146": "sledgehammer shoot",
    "2168": "flamethrower idle",
    "2226": "flamethrower shoot",
    "2257": "chaingun idle",
    "2263": "chaingun walk",
    "2310": "chaingun shoot",
    "2326": "chainsaw idle",
    "2332": "chainsaw walk",
    "2349": "chainsaw shoot",
    "2367": "laser_sword idle",
    "2380": "laser_sword walk",
    "2416": "laser_sword shoot 1",
    "2440": "laser_sword shoot 2",
    "2486": "laser_sword shoot 3",
    "2511": "tesla_helmet idle",
    "2537": "tesla_helmet walk",
    "2568": "tesla_helmet shoot",
    "2582": "railgun idle",
    "2610": "railgun shoot"
}

# ── Config ──────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent
SPRITES_DIR = ROOT / "TEMP_NEW_SPRITES" / "player" / "sprites"
OUTPUT_DIR  = ROOT / "client" / "sprites" / "player"
OUTPUT_PNG  = OUTPUT_DIR / "spritesheet.png"
OUTPUT_JSON = OUTPUT_DIR / "spritesheet.json"

IDLE_FPS     = 12  # fps for idle / walk animations
SHOOT_FPS   = 24  # fps for shoot animations
MAX_SHEET_W  = 4096
PADDING      = 2     # px gap between frames

# Head detection — blue head: b > BLUE_B_MIN and b > r * BLUE_RATIO
BLUE_B_MIN  = 100
BLUE_RATIO  = 1.5    # b must exceed both r and g by this factor
ALPHA_MIN   = 10     # pixels below this alpha are treated as transparent

# Number of (blue-head) frames sampled from start and end for origin detection
HEAD_SAMPLE = 3

# ── Helpers ─────────────────────────────────────────────────────────────────────

def anim_key(display_name: str) -> str:
    """'fist shoot 1'  →  'fist_shoot1'"""
    name = display_name.lower().strip()
    # collapse whitespace before a trailing digit to remove the space
    name = re.sub(r'\s+(\d+)$', r'\1', name)
    # replace remaining spaces/hyphens with underscores
    name = re.sub(r'[\s\-]+', '_', name)
    return name


def is_shoot(display_name: str) -> bool:
    return "shoot" in display_name.lower()


def numeric_sort(path: Path) -> int:
    try:
        return int(path.stem)
    except ValueError:
        return 0


def load_frame(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"), dtype=np.uint8)


def blue_to_black(arr: np.ndarray) -> np.ndarray:
    """Replace blue-dominant pixels (alpha > 0) with black, preserving alpha."""
    out = arr.copy()
    r, g, b, a = out[:, :, 0].astype(float), out[:, :, 1].astype(float), \
                 out[:, :, 2].astype(float), out[:, :, 3]
    mask = (
        (a > ALPHA_MIN) &
        (b > BLUE_B_MIN) &
        (b > r * BLUE_RATIO) &
        (b > g * BLUE_RATIO)
    )
    out[mask, 0] = 0
    out[mask, 1] = 0
    out[mask, 2] = 0
    return out


def tight_bbox_union(frames_arr: list[np.ndarray]) -> tuple[int, int, int, int]:
    """Return (x_min, y_min, x_max, y_max) union bbox of opaque pixels."""
    fh, fw = frames_arr[0].shape[:2]
    x_min, y_min = fw, fh
    x_max, y_max = 0, 0
    any_opaque = False
    for arr in frames_arr:
        ys, xs = np.where(arr[:, :, 3] > ALPHA_MIN)
        if not len(ys):
            continue
        any_opaque = True
        x_min = min(x_min, int(xs.min()))
        y_min = min(y_min, int(ys.min()))
        x_max = max(x_max, int(xs.max()))
        y_max = max(y_max, int(ys.max()))
    if not any_opaque:
        return 0, 0, fw - 1, fh - 1
    return x_min, y_min, x_max, y_max


def detect_head_origin(frames_arr: list[np.ndarray],
                       crop_x: int, crop_y: int) -> tuple[int, int] | None:
    """
    Find centroid of the blue head circle across a sample of frames.
    Returns (ox, oy) in CROPPED frame coordinates, or None if not detected.
    """
    # Gather frames with the most blue pixels (blue-head frames)
    blue_counts = []
    for i, arr in enumerate(frames_arr):
        r, g, b, a = (arr[:, :, c].astype(float) for c in range(4))
        cnt = int(((b > BLUE_B_MIN) & (b > r * BLUE_RATIO) & (b > g * BLUE_RATIO) & (a > ALPHA_MIN)).sum())
        blue_counts.append((cnt, i))

    blue_counts.sort(reverse=True)
    sample_indices = [idx for cnt, idx in blue_counts[:HEAD_SAMPLE * 2] if cnt > 10]

    if not sample_indices:
        return None

    oxs, oys = [], []
    for i in sample_indices:
        arr = frames_arr[i]
        r, g, b, a = (arr[:, :, c].astype(float) for c in range(4))
        mask = (b > BLUE_B_MIN) & (b > r * BLUE_RATIO) & (b > g * BLUE_RATIO) & (a > ALPHA_MIN)
        ys, xs = np.where(mask)
        if not len(ys):
            continue
        # Weight by saturation (bluer = more central)
        weight = b[ys, xs] - np.maximum(r[ys, xs], g[ys, xs])
        w_sum = weight.sum() or 1.0
        oxs.append(float((xs * weight).sum() / w_sum) - crop_x)
        oys.append(float((ys * weight).sum() / w_sum) - crop_y)

    if not oxs:
        return None

    return round(float(np.mean(oxs))), round(float(np.mean(oys)))


def next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


# ── Scan and load ───────────────────────────────────────────────────────────────

if not SPRITES_DIR.exists():
    sys.exit(f"ERROR: sprites directory not found:\n  {SPRITES_DIR}")

# Build ordered list of (display_name, anim_key, is_shoot, [png_paths])
animations: list[tuple[str, str, bool, list[Path]]] = []

for sprite_id, display_name in SPRITE_MAP.items():
    folder = SPRITES_DIR / f"DefineSprite_{sprite_id}"
    if not folder.exists():
        print(f"  WARNING: folder not found for {sprite_id} ({display_name}), skipping")
        continue
    pngs = sorted(
        [p for p in folder.iterdir() if p.suffix.lower() == ".png"],
        key=numeric_sort,
    )
    if not pngs:
        print(f"  WARNING: no PNGs in {folder.name}, skipping")
        continue
    animations.append((display_name, anim_key(display_name), is_shoot(display_name), pngs))

print(f"Loaded {len(animations)} animations")

# ── Process each animation ─────────────────────────────────────────────────────
# Produces: list of (anim_key, [(frame_key, cropped_rgba), ...], ox, oy)

ProcessedAnim = tuple[str, list[tuple[str, np.ndarray]], int, int]
processed: list[ProcessedAnim] = []

for display_name, key, shoot, pngs in animations:
    # Skip frame 1 for shoot animations
    source_pngs = pngs[1:] if shoot else pngs

    if not source_pngs:
        print(f"  WARNING: {display_name} has no frames after skip, skipping")
        continue

    # Load and convert blue → black
    frames_raw = [blue_to_black(load_frame(p)) for p in source_pngs]

    # Union bounding box (before colour conversion doesn't matter — sizes are the same)
    x_min, y_min, x_max, y_max = tight_bbox_union(frames_raw)
    cw = x_max - x_min + 1
    ch = y_max - y_min + 1

    # Crop all frames identically
    cropped = [arr[y_min : y_max + 1, x_min : x_max + 1] for arr in frames_raw]

    # Detect head origin (from original frames — before blue→black so blue is still present)
    frames_orig = [load_frame(p) for p in source_pngs]
    origin = detect_head_origin(frames_orig, x_min, y_min)
    if origin is None:
        # Fallback: horizontal centre, 25% from top
        origin = (cw // 2, ch // 4)
        print(f"  {display_name}: head not detected, using fallback origin {origin}")
    ox, oy = origin

    # Clamp origin to frame bounds
    ox = max(0, min(cw - 1, ox))
    oy = max(0, min(ch - 1, oy))

    frame_entries = [
        (f"{key}_{i:03d}", tile)
        for i, tile in enumerate(cropped)
    ]
    processed.append((key, frame_entries, ox, oy))
    print(f"  {display_name:<30}  {len(source_pngs):>3} frames  {cw}×{ch}  origin=({ox},{oy})")

# ── Pack into atlas ─────────────────────────────────────────────────────────────

# Flatten to (frame_key, anim_key, tile_arr, ox, oy)
flat: list[tuple[str, str, np.ndarray, int, int]] = []
for akey, entries, ox, oy in processed:
    for fkey, tile in entries:
        flat.append((fkey, akey, tile, ox, oy))

rows: list[list[tuple[str, str, np.ndarray, int, int]]] = []
cur_row: list[tuple] = []
cur_w = 0

for item in flat:
    _, _, tile, _, _ = item
    tw = tile.shape[1]
    if cur_row and cur_w + tw + PADDING > MAX_SHEET_W:
        rows.append(cur_row)
        cur_row = []
        cur_w = 0
    cur_row.append(item)
    cur_w += tw + (PADDING if cur_row else 0)

if cur_row:
    rows.append(cur_row)

content_h = sum(max(t.shape[0] for _, _, t, _, _ in row) + PADDING for row in rows) - PADDING
atlas_w   = MAX_SHEET_W
atlas_h   = next_pow2(content_h)

print(f"\nAtlas: {atlas_w} × {atlas_h}  (content height {content_h})")

atlas_img = np.zeros((atlas_h, atlas_w, 4), dtype=np.uint8)
out_frames: dict[str, dict] = {}

cur_y = 0
for row in rows:
    row_h = max(t.shape[0] for _, _, t, _, _ in row)
    cur_x = 0
    for fkey, akey, tile, ox, oy in row:
        th, tw = tile.shape[:2]
        atlas_img[cur_y : cur_y + th, cur_x : cur_x + tw] = tile
        out_frames[fkey] = {
            "x": cur_x, "y": cur_y, "w": tw, "h": th,
        }
        cur_x += tw + PADDING
    cur_y += row_h + PADDING

# ── Build JSON ──────────────────────────────────────────────────────────────────

set_origins: dict[str, dict] = {}
animation_list: list[dict] = []

for akey, entries, ox, oy in processed:
    set_origins[akey] = {"ox": ox, "oy": oy}
    fps = SHOOT_FPS if 'shoot' in akey else IDLE_FPS
    animation_list.append({
        "name": akey,
        "fps": fps,
        "frames": [fkey for fkey, _ in entries],
    })

output_json = {
    "frames":      out_frames,
    "set_origins": set_origins,
    "animations":  animation_list,
}

# ── Write output ────────────────────────────────────────────────────────────────

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

Image.fromarray(atlas_img, "RGBA").save(OUTPUT_PNG, optimize=True)
print(f"Saved  {OUTPUT_PNG.relative_to(ROOT)}")

with open(OUTPUT_JSON, "w", encoding="utf-8", newline="\n") as f:
    json.dump(output_json, f, indent=2)
print(f"Saved  {OUTPUT_JSON.relative_to(ROOT)}")

print("\nDone.")
