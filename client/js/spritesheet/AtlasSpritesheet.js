class AtlasSpritesheet {
  constructor(name, imageUrl, jsonData) {
    this.spritesheetName = name;
    this.image = new Image();
    this.image.src = imageUrl;
    this.frames = {};
    this.animationMap = {};  // name -> { fps, frames: [frameKey, ...], offset?: [x, y] }
    this.setOrigins = {};
    this.ready = false;

    const load = (data) => {
      const rawFrames = data.frames || {};
      this.frames = rawFrames;
      for (const anim of (data.animations || [])) {
        this.animationMap[anim.name] = { fps: anim.fps, frames: anim.frames, offset: anim.offset || null, pinned: anim.pinned || false };
      }
      this.tileAnimations = data.tileAnimations || {};
      this.setOrigins = data.set_origins || {};
      this.ready = true;
    };

    if (typeof jsonData === 'object' && jsonData !== null) {
      // Inline data — synchronous, no fetch needed.
      load(jsonData);
    } else {
      // URL string — fetch asynchronously.
      fetch(jsonData)
        .then(r => r.json())
        .then(load);
    }
  }

  getAnimation(name) {
    return this.animationMap[name] || null;
  }

  // Returns { x, y, w, h, origin } for a given animation frame.
  // origin is the single {ox, oy} anchor from set_origins (or a sensible default).
  getFrameData(animName, frameIndex) {
    const anim = this.animationMap[animName];
    if (!anim || !anim.frames.length) return null;
    const key = anim.frames[Math.max(0, frameIndex) % anim.frames.length];
    const raw = this.frames[key];
    if (!raw) return null;

    // Support both {x,y,w,h} and {frame:{x,y,w,h}} formats
    const f = (raw.frame !== undefined) ? raw.frame : raw;
    const so = this.setOrigins[animName] || {};
    // Single origin — falls back to per-frame baked origin then center-bottom
    const origin = (so.ox != null) ? so : (raw.origin || { ox: Math.round(f.w / 2), oy: Math.round(f.h * 0.95) });

    return { x: f.x, y: f.y, w: f.w, h: f.h, origin };
  }

  // Returns tile frame {x,y,w,h} from the map atlas by 3-char tile key (e.g. "0B0").
  getMapTileFrame(tileKey) {
    const key = tileKey + '.png';
    const raw = this.frames[key];
    if (!raw) return null;
    return (raw.frame !== undefined) ? raw.frame : raw;
  }

  // Like getMapTileFrame but advances through animation frames using a wall-clock
  // timestamp (milliseconds, as supplied by requestAnimationFrame).
  getAnimatedMapTileFrame(tileKey, nowMs) {
    const anim = this.tileAnimations[tileKey];
    let key;
    if (anim && anim.frames.length > 1) {
      const frameIndex = Math.floor((nowMs / 1000) * anim.fps) % anim.frames.length;
      key = anim.frames[frameIndex];
    } else {
      key = tileKey + '.png';
    }
    const raw = this.frames[key];
    if (!raw) return null;
    return (raw.frame !== undefined) ? raw.frame : raw;
  }
}

// Singleton indicator (spinner) atlas
const indicatorAtlas = new AtlasSpritesheet(
  'indicator',
  'sprites/indicator/spritesheet.png',
  'sprites/indicator/spritesheet.json'
);

// Singleton player atlas loaded once
const playerAtlas = new AtlasSpritesheet(
  'player',
  'sprites/player/spritesheet.png',
  'sprites/player/spritesheet.json'
);

// Singleton death atlas loaded once
const deathAtlas = new AtlasSpritesheet(
  'death',
  'sprites/death/spritesheet.png',
  'sprites/death/spritesheet.json'
);

// Singleton pickup atlas loaded once
const pickupAtlas = new AtlasSpritesheet(
  'pickup',
  'sprites/pickup/spritesheet.png',
  'sprites/pickup/spritesheet.json'
);

// Singleton heartbeat atlas (HUD health indicator)
const heartbeatAtlas = new AtlasSpritesheet(
  'heartbeat',
  'sprites/player/heartbeat.png',
  'sprites/player/heartbeat.json'
);

// Singleton blood atlas loaded once
const bloodAtlas = new AtlasSpritesheet(
  'blood',
  'sprites/blood/spritesheet.png',
  'sprites/blood/spritesheet.json'
);

// Singleton map atlas loaded once
const mapAtlas = new AtlasSpritesheet(
  'map',
  'sprites/maps/atlas.png',
  'sprites/maps/atlas.json'
);

// Singleton cursor atlas
const cursorAtlas = new AtlasSpritesheet(
  'cursor',
  'sprites/cursor/spritesheet.png',
  'sprites/cursor/spritesheet.json'
);

// Singleton particle atlas — muzzle flash / shoot effect sprites
const particleAtlas = new AtlasSpritesheet(
  'particles',
  'sprites/particles/spritesheet.png',
  'sprites/particles/spritesheet.json'
);
