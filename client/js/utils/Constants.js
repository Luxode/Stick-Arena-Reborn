class Constants {
  static SPEED = 210;  // px/s  (was 1.4 px/frame × 2.5 × 60 fps = 210 px/s)
  static STICK_FIGURE_HEAD_RADIUS = 17;
  static TO_RADIANS = Math.PI / 180;
  static LEFT_MOUSE_BUTTON = 0;

  static DEATH_SOUNDS = Object.freeze(['death_0', 'death_1', 'death_2', 'death_3', 'death_4', 'death_5', 'death_6']);

  // Populated at startup by fetchWeapons() from client/data/weapons.json.
  // Keyed by weapon ID for O(1) lookup.
  static WEAPON_ID_MAP = {};
}

// Fetch the shared weapon definitions and populate WEAPON_ID_MAP.
// All code that depends on weapon data must run after this resolves.
Constants._weaponsReady = fetch('./data/weapons.json')
  .then(r => r.json())
  .then(weapons => {
    const map = {};
    for (const w of weapons) map[w.id] = Object.freeze(w);
    Constants.WEAPON_ID_MAP = Object.freeze(map);
  });

