let keys = {
  up:     false,
  left:   false,
  down:   false,
  right:  false,
  sprint: false,
  shoot:  false,
};

// Case-insensitive for single characters; exact match for special keys (Shift, etc.).
function keyMatches(event, action) {
  const bound = settingsManager.getKey(action);
  if (!bound) return false;
  if (bound.length === 1) return event.key.toLowerCase() === bound.toLowerCase();
  return event.key === bound;
}

// Map name to .dat filename mapping
const MAP_NAMES = {
  'unstableterrace': '__unstableterrace.dat',
  'ballistick': '__ballistick.dat',
  'desertlaboratory': '__desertlaboratory.dat',
  'elitebase': '__elitebase.dat',
  'exploration': '__exploration.dat',
  'facility': '__facility.dat',
  'failcorp': '__failcorp.dat',
  'floorthirteen': '__floorthirteen.dat',
  'fortmoon': '__fortmoon.dat',
  'futureoffice': '__futureoffice.dat',
  'geminicontrolstation': '__geminicontrolstation.dat',
  'globalmegacorpltd': '__globalmegacorpltd.dat',
  'greenlabyrinth': '__greenlabyrinth.dat',
  'industrialdrainage': '__industrialdrainage.dat',
  'islandhopping': '__islandhopping.dat',
  'islandsofanarchy': '__islandsofanarchy.dat',
  'cubicles': '__cubicles.dat',
  'concretejungle': '__concretejungle.dat',
  'cruelity': '__cruelity.dat',
  'dday': '__dday.dat',
  'deadspace': '__deadspace.dat',
  'debug': '__debug.dat',
  'sewertunnel': '__sewertunnel.dat',
  'sewagetreatment': '__sewagetreatment.dat',
  'automateddiscoverypod': '__automateddiscoverypod.dat',
  'anarchystreets': '__anarchystreets.dat',
  'alientestlab': '__alientestlab.dat',
  'abandonedcity': '__abandonedcity.dat',
  'battlegroundbase': '__battlegroundbase.dat',
  'barge': '__barge.dat',
  'outpost': '__outpost.dat',
  'parisstreets': '__parisstreets.dat',
  'radiation': '__radiation.dat',
};

function keyDownHandler(event) {
  // If chat is open, route all keys to it except Enter (which submits).
  if (chatManager.isOpen) {
    if (event.key === 'Enter') {
      const text = chatManager.close();
      if (text === '!debug') {
        debugTiles = !debugTiles;
      } else if (text.startsWith('!map ')) {
        const mapName = text.substring(5).trim().toLowerCase();
        const mapFile = MAP_NAMES[mapName];
        if (mapFile) {
          // Use the global loadMap function to properly reinitialize everything
          if (typeof loadMap !== 'undefined') {
            // Pass the full filename (e.g., '__barge.dat') to loadMap
            loadMap(mapFile);
            console.log(`[Map] Loading ${mapName}...`);
          } else {
            console.warn(`[Map] loadMap function not available`);
          }
        } else {
          console.warn(`[Map] Unknown map: ${mapName}`);
        }
      } else if (text) {
        socketManager.emit('chatMessage', { text });
      }
    } else {
      chatManager.handleKey(event);
    }
    return;
  }

  // Settings panel handles Escape via capture phase; suppress game input while open.
  if (settingsManager.isOpen()) return;

  if      (keyMatches(event, 'up'))     keys.up     = true;
  else if (keyMatches(event, 'left'))   keys.left   = true;
  else if (keyMatches(event, 'down'))   keys.down   = true;
  else if (keyMatches(event, 'right'))  keys.right  = true;
  else if (keyMatches(event, 'sprint')) keys.sprint = true;
  else if (event.key === 'Enter') {
    chatManager.open();
  } else if (keyMatches(event, 'shoot')) {
    keys.shoot = true;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    scoreboardManager.tabHeld = true;
  } else if (event.key === ' ') {
    event.preventDefault();
  } else if (event.key === 'Shift') {
    scoreboardManager.tabHeld = true;
  }
}

function keyUpHandler(event) {
  if (keyMatches(event, 'up'))     keys.up     = false;
  else if (keyMatches(event, 'left'))   keys.left   = false;
  else if (keyMatches(event, 'down'))   keys.down   = false;
  else if (keyMatches(event, 'right'))  keys.right  = false;
  else if (keyMatches(event, 'sprint')) keys.sprint = false;
  else if (keyMatches(event, 'shoot'))  keys.shoot  = false;

  if (event.key === 'Tab' || event.key === 'Shift') scoreboardManager.tabHeld = false;
}

function onBlurHandler() {
  keys = { up: false, left: false, down: false, right: false, sprint: false, shoot: false };
}

function keyEvents(dt) {
  if (!playerManager.mainPlayer || playerManager.mainPlayer.isRespawning) return;

  if (keys.shoot && playerManager.mainPlayer.canShoot) {
    playerManager.mainPlayer.shoot();
  }

  // Speed in px/s multiplied by dt gives frame-rate-independent px this frame.
  const weaponMult = playerManager.mainPlayer.currentWeapon.walkSpeed ?? 1;
  const spd = Constants.SPEED * weaponMult * dt;

  if (keys.up && keys.right) {
    playerManager.mainPlayer.move(spd / 1.414, -spd / 1.414, 45);
  } else if (keys.up && keys.left) {
    playerManager.mainPlayer.move(-spd / 1.414, -spd / 1.414, 135);
  } else if (keys.down && keys.right) {
    playerManager.mainPlayer.move(spd / 1.414, spd / 1.414, -45);
  } else if (keys.down && keys.left) {
    playerManager.mainPlayer.move(-spd / 1.414, spd / 1.414, -315);
  } else if (keys.up) {
    playerManager.mainPlayer.move(null, -spd, 0);
  } else if (keys.left) {
    playerManager.mainPlayer.move(-spd, null, 90);
  } else if (keys.down) {
    playerManager.mainPlayer.move(null, spd, 0);
  } else if (keys.right) {
    playerManager.mainPlayer.move(spd, null, 90);
  }
}
