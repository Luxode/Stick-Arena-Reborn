// Parses Stick Arena .dat map files.
//
// Format:
//   inf=W H Map Name
//   &tiles= TTTRFC TTTRFC ...   (6-char codes per tile)
//   &sp=  X1 Y1 X2 Y2 ...      (spawn points, 0 0 = unused slot)
//   &ws=  X Y WeaponId RespawnSec ...  (weapon spawns, 0 0 0 0 = unused)
//   &rt=  Seconds               (round time, optional)
//   &ts=  0|1                   (team setting, 0=FFA)
//
// Tile code: TTT R F C
//   TTT = 3-char tile image key (looked up in atlas as "TTT.png")
//   R   = rotation (0-3, multiples of 90°)
//   F   = flip (0=none 1=H 2=V 3=H+V)
//   C   = collision (3 = solid wall, 0/other = walkable)
class MapLoader {
  constructor() {
    this.ready = false;
    this.width = 0;
    this.height = 0;
    this.name = '';
    this.tiles = [];          // raw 6-char codes
    this.collisionMap = [];   // 0=walkable, 1=solid (based on 6th char == '3')
    this.spawnPoints = [];    // [{x, y}]
    this.weaponSpawns = [];   // [{x, y, weaponId, respawnTime (ms)}]
  }

  async load(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load map: ${url}`);
    const text = await resp.text();
    this._parse(text);
    this.ready = true;
  }

  _parse(text) {
    const s = text.replace(/\r/g, '').trim();

    // inf=W H Map Name
    const infMatch = s.match(/inf=(\d+)\s+(\d+)\s+([^\n&]+)/i);
    if (!infMatch) throw new Error('inf= line not found in .dat');
    this.width  = parseInt(infMatch[1], 10);
    this.height = parseInt(infMatch[2], 10);
    this.name   = infMatch[3].trim();

    // &tiles= ...  &
    const tilesMatch = s.match(/&tiles=\s*([\s\S]*?)&/i);
    if (!tilesMatch) throw new Error('&tiles= block not found');
    this.tiles = tilesMatch[1].trim().split(/\s+/).filter(Boolean);

    // Collision map: stores {c, r, f} per tile (6th, 4th, and 5th characters of the tile code).
    // c=0-2: fully passable; c=3: solid (no walk, no shoot); c=4: no walk (shoot-through);
    // c=5-9: partial walk collision whose blocked zone rotates with r and flips with f.
    this.collisionMap = this.tiles.map(code => ({
      c: parseInt(code[5], 10) || 0,
      r: (parseInt(code[3], 10) || 0) % 4,
      f: (parseInt(code[4], 10) || 0) % 4,
    }));

    // &sp=  X1 Y1 X2 Y2 …  (0 0 pairs = unused)
    this.spawnPoints = [];
    const spMatch = s.match(/&sp=([^\n&]+)/i);
    if (spMatch) {
      const nums = spMatch[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        if (nums[i] !== 0 || nums[i + 1] !== 0) {
          this.spawnPoints.push({ x: nums[i] + 25, y: nums[i + 1] + 25 });
        }
      }
    }

    // &ws=  X Y WeaponId RespawnSec …  (groups of 4, 0 0 * * = unused)
    this.weaponSpawns = [];
    const wsMatch = s.match(/&ws=([^\n&]+)/i);
    if (wsMatch) {
      const nums = wsMatch[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i + 3 < nums.length; i += 4) {
        if (nums[i] !== 0 || nums[i + 1] !== 0) {
          this.weaponSpawns.push({
            x: nums[i] + 25,
            y: nums[i + 1] + 25,
            weaponId: nums[i + 2],
            respawnTime: (nums[i + 3] || 10) * 1000,
          });
        }
      }
    }
  }
}
