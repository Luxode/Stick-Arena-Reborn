// Manages the lifecycle of offline AI bots.
//
// Flow:
//   1. botManager.init() is called at the end of game.js.
//   2. A 2-second timer starts.  If the server delivers a 'gameState' event before
//      the timer fires, loopStarted will be true and we skip offline mode entirely.
//   3. If no server is reachable (GitHub Pages, local file, server down), the timer
//      fires, we load a random map from OFFLINE_MAPS, start the game loop, and
//      spawn BOT_COUNT bots.
//   4. If the socket later connects (server appeared), bots are despawned and the
//      server takes full control via its normal 'gameState' / 'roundStart' events.
//   5. If a real player joins while bots are active, bots are also despawned.
//
// Damage pipeline (offline):
//   • Player hits bot  → checkCollision emits 'playerHit' → patched socketManager.emit
//                        intercepts it → _handleBotHit().
//   • Bot hits target  → Bot._tryShoot() → botManager._applyDamage().

class BotManager {
  static BOT_COUNT = 2;

  static BOT_NAMES = ['Alpha', 'Beta', 'Delta', 'Omega', 'Gamma', 'Zeta', 'Theta'];

  // Maps known to play nicely for solo-vs-bots.
  static OFFLINE_MAPS = [
    'anarchystreets.dat',
    'battlegroundbase.dat',
    'brawlersburrow.dat',
    'cliffs.dat',
    'concretejungle.dat',
    'cubicles.dat',
    'facility.dat',
    'officespace.dat',
    'thepit.dat',
    'barge.dat',
    'abandonedcity.dat',
    'alientestlab.dat',
    'automateddiscoverypod.dat',
    'cliffside.dat',
    'corporatewasteland.dat',
    'cruelity.dat',
    'dday.dat',
    'deadspace.dat',
    'debug.dat',
    'desertlaboratory.dat',
    'elitebase.dat',
    'exploration.dat',
    'failcorp.dat',
    'floorthirteen.dat',
    'fortmoon.dat',
    'futureoffice.dat',
    'geminicontrolstation.dat',
    'globalmegacorpltd.dat',
    'greenlabyrinth.dat',
    'industrialdrainage.dat',
    'islandhopping.dat',
    'islandsofanarchy.dat',
    'lastmap.dat',
    'leetspace.dat',
    'lostfacility.dat',
    'lowzone.dat',
    'markedterritory.dat',
    'mypetglock.dat',
    'nuclearunderground.dat',
    'oceans.dat',
    'officepod.dat',
    'orbit.dat',
    'outerspace.dat',
    'outerspacedestruct.dat',
    'outpost.dat',
    'parisstreets.dat',
    'radiation.dat',
    'sewagetreatment.dat',
    'sewertunnel.dat',
    'shelter.dat',
    'shipdock.dat',
    'spacebridge.dat',
    'spaceelevatorcontrol.dat',
    'spaceexcavations.dat',
    'spacemountain.dat',
    'stickfederationhq.dat',
    'storageyard.dat',
    'stormdrain.dat',
    'subterraneansector.dat',
    'sunnyvaletrailerpark.dat',
    'thefoundation.dat',
    'thesfvengeance.dat',
    'toxicspillway.dat',
    'transgalacticcomstation.dat',
    'trenchrun.dat',
    'trenchrun2.dat',
    'trenchspace.dat',
    'underspace.dat',
    'universityofstick.dat',
    'unstableterrace.dat',
    'venicestreets.dat',
    'voiders.dat',
    'workplaceanxiety.dat',
    'xgenhq.dat',
    'ballistick/automateddiscoverypod.dat',
    'ballistick/barge.dat',
    'ballistick/cliffside.dat',
    'ballistick/geminicontrolstation.dat',
    'ballistick/orbit.dat',
    'ballistick/outpost.dat',
    'ballistick/spaceelevatorcontrol.dat',
    'ballistick/spacemountain.dat',
    'ballistick/stickfederationhq.dat',
    'ballistick/thesfvengeance.dat',
    'ballistick/transgalacticcomstation.dat',
    'feature/abandonedcity.dat',
    'feature/alientestlab.dat',
    'feature/anarchystreets.dat',
    'feature/battlegroundbase.dat',
    'feature/cliffs.dat',
    'feature/cruelity.dat',
    'feature/cubicles.dat',
    'feature/dday.dat',
    'feature/deadspace.dat',
    'feature/desertlaboratory.dat',
    'feature/elitebase.dat',
    'feature/exploration.dat',
    'feature/facility.dat',
    'feature/failcorp.dat',
    'feature/fortmoon.dat',
    'feature/futureoffice.dat',
    'feature/islandhopping.dat',
    'feature/islandsofanarchy.dat',
    'feature/lastmap.dat',
    'feature/leetspace.dat',
    'feature/lostfacility.dat',
    'feature/lowzone.dat',
    'feature/markedterritory.dat',
    'feature/mypetglock.dat',
    'feature/oceans.dat',
    'feature/outerspace.dat',
    'feature/outerspacedestruct.dat',
    'feature/parisstreets.dat',
    'feature/radiation.dat',
    'feature/sewertunnel.dat',
    'feature/shelter.dat',
    'feature/shipdock.dat',
    'feature/spacebridge.dat',
    'feature/spaceexcavations.dat',
    'feature/subterraneansector.dat',
    'feature/trenchspace.dat',
    'feature/underspace.dat',
    'feature/universityofstick.dat',
    'feature/venicestreets.dat',
    'feature/voiders.dat',
  ];

  static getBotCount(map) {
    const area = map.width * map.height;
    if (area <= 900) return 2;
    if (area <= 2500) return 4;
    return 7;
  }

  static getInstance() {
    if (!BotManager.instance) BotManager.instance = new BotManager();
    return BotManager.instance;
  }

  constructor() {
    this.bots   = {};      // botId → Bot
    this.active = false;
    // 'none' | 'no-server' | 'waiting'
    // 'no-server'  — socket.io never connected
    // 'waiting'    — socket connected but no other real players yet
    this.status = 'none';

    this._originalEmit  = null;
    this._offlineTimer  = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Called once from game.js after all scripts are loaded. */
  init() {
    // Cancel the offline timer if the socket connects in time.
    socketManager.on('connect', () => {
      if (this._offlineTimer) {
        clearTimeout(this._offlineTimer);
        this._offlineTimer = null;
      }
      // Update status label if bots are already running.
      if (this.active) this.status = 'waiting';
    });

    // Server disconnected while bots are running.
    socketManager.on('disconnect', () => {
      if (this.active) this.status = 'no-server';
    });

    // A real player joined — bots are no longer needed.
    socketManager.on('newPlayer', () => {
      if (this.active) this.despawn();
    });

    // Wait 2 s for a server connection; if none, load a random map and start bots.
    // If the socket DOES connect, gameState → loadMap → considerSpawning handles it.
    this._offlineTimer = setTimeout(() => {
      this._offlineTimer = null;
      if (!loopStarted) this._startOffline();
    }, 2000);
  }

  /**
   * Called after every server-driven map load.
   * Spawns bots when the player is alone; despawns them when others are present.
   * @param {object} scores  The scores object from gameState / roundStart.
   */
  considerSpawning(scores) {
    const myId   = socketManager.socket?.id;
    const others = Object.keys(scores).filter(id => id !== myId && !this.isBot(id));

    if (others.length > 0) {
      // Real players present — make sure bots are gone.
      if (this.active) this.despawn();
      return;
    }

    // Alone on the server — spawn or keep bots.
    if (!this.active) {
      this.status = socketManager.isConnected ? 'waiting' : 'no-server';
      const pts = (typeof map !== 'undefined' && map.ready && map.spawnPoints.length)
        ? map.spawnPoints : [{ x: 400, y: 300 }];
      const botCount = BotManager.getBotCount(map);
      this.spawn(pts, botCount);
      chatManager.addMessage('Server',
        this.status === 'waiting'
          ? 'Waiting for other players, playing against bots.'
          : 'No connection to the server, playing against bots.',
        null);
    }
  }

  /** Spawn botCount bots at random spawn points. */
  spawn(spawnPoints, botCount = BotManager.BOT_COUNT) {
    if (this.active) return;
    this.active = true;

    // Reset the human player's local score for a fresh bot session.
    if (playerManager.mainPlayer) {
      playerManager.mainPlayer.kills  = 0;
      playerManager.mainPlayer.deaths = 0;
    }

    this._patchSocketEmit();

    for (let i = 0; i < botCount; i++) {
      const id = 'bot_' + i;
      const sp = spawnPoints.length
        ? spawnPoints[Math.floor(Math.random() * spawnPoints.length)]
        : { x: 400, y: 300 };
      this.bots[id] = new Bot(id, sp.x, sp.y, i);
    }

    this._updateScoreboard();
  }

  /** Remove all bots and restore normal socket behaviour. */
  despawn() {
    for (const bot of Object.values(this.bots)) bot.remove();
    this.bots   = {};
    this.active = false;
    this.status = 'none';
    this._restoreSocketEmit();
  }

  // ── Accessors (used by Bot instances) ────────────────────────────────────────

  isBot(id) { return id in this.bots; }

  /** Returns a plain { botId → Player } map so bots can target each other. */
  getBotPlayers() {
    const out = {};
    for (const [id, bot] of Object.entries(this.bots)) out[id] = bot.player;
    return out;
  }

  // ── Per-frame update (called from game.js update()) ──────────────────────────

  update(dt) {
    if (!this.active) return;
    for (const bot of Object.values(this.bots)) bot.think(dt);
  }

  // ── Damage handling ───────────────────────────────────────────────────────────

  /**
   * Bot fired its weapon at `targetPlayer`.
   * Applies damage locally and triggers death if health reaches zero.
   */
  _applyDamage(attackerBot, targetPlayer) {
    if (targetPlayer.isRespawning) return;
    const weapon   = attackerBot.player.currentWeapon;
    const damage   = weapon?.damage   ?? 5;
    const weaponId = weapon?.id       ?? 0;

    targetPlayer.showHitsplat(damage, weaponId);
    if (targetPlayer.health > 0) return;

    if (targetPlayer === playerManager.mainPlayer) {
      // Bot killed the human player.
      attackerBot.kills++;
      targetPlayer.deaths++;
      targetPlayer.death(); // Player.death() → anim → respawn() for isMainPlayer ✓
    } else {
      // Bot killed another bot.
      for (const [, b] of Object.entries(this.bots)) {
        if (b.player === targetPlayer) {
          b.deaths++;
          attackerBot.kills++;
          b.player.death();
          b.respawnPending = true;
          break;
        }
      }
    }
    this._updateScoreboard();
  }

  /**
   * The human player's checkCollision detected a hit on a bot.
   * (Intercepted from 'playerHit' socket emit via _patchSocketEmit.)
   */
  _handleBotHit(botId, damage, weaponId) {
    const bot = this.bots[botId];
    if (!bot || bot.player.isRespawning) return;

    // Use damage/weaponId passed directly from the intercepted emit.
    const dmg = damage ?? playerManager.mainPlayer?.currentWeapon?.damage ?? 5;
    const wid = weaponId ?? playerManager.mainPlayer?.currentWeapon?.id ?? 0;

    bot.player.showHitsplat(dmg, wid);
    if (bot.player.health > 0) return;

    bot.deaths++;
    if (playerManager.mainPlayer) playerManager.mainPlayer.kills++;
    bot.player.death();
    bot.respawnPending = true;
    this._updateScoreboard();
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _startOffline() {
    const maps = BotManager.OFFLINE_MAPS;
    const file = maps[Math.floor(Math.random() * maps.length)];
    // Determine initial status: if socket.io isn't even available we're fully offline;
    // if it is but hasn't connected yet we're still waiting to see.
    this.status = (typeof io === 'undefined' || !socketManager.socket) ? 'no-server' : 'waiting';
    loadMap(file)
      .then(() => {
        const pts = (map.ready && map.spawnPoints.length) ? map.spawnPoints : [{ x: 400, y: 300 }];
        const botCount = BotManager.getBotCount(map);
        this.spawn(pts, botCount);
        chatManager.addMessage('Server', 'No server found — playing offline with bots.', null);
      })
      .catch(err => console.warn('[BotManager] Failed to load offline map:', err));
  }

  /**
   * Monkey-patch socketManager.emit so 'playerHit' events aimed at bot IDs
   * are resolved locally instead of sent over the network.
   */
  _patchSocketEmit() {
    this._originalEmit = socketManager.emit.bind(socketManager);
    const self = this;
    socketManager.emit = function(event, data) {
      if (event === 'playerHit' && self.isBot(data?.playerId)) {
        self._handleBotHit(data.playerId, data.damage, data.weaponId);
        return;
      }
      self._originalEmit(event, data);
    };
  }

  _restoreSocketEmit() {
    if (this._originalEmit) {
      socketManager.emit = this._originalEmit;
      this._originalEmit = null;
    }
  }

  /** Push the current offline scores to the scoreboard for Tab-overlay display. */
  _updateScoreboard() {
    const scores = {};

    // Human player — use socket id when available, fall back to a fixed key.
    const myId = socketManager.socket?.id ?? 'local_player';
    const main = playerManager.mainPlayer;
    if (main) {
      scores[myId] = {
        name:         main.name,
        kills:        main.kills,
        deaths:       main.deaths,
        indicatorHue: main.indicatorHue ?? 0,
      };
    }

    // Bots.
    for (const [id, bot] of Object.entries(this.bots)) {
      scores[id] = {
        name:         bot.player.name,
        kills:        bot.kills,
        deaths:       bot.deaths,
        indicatorHue: bot.player.indicatorHue,
      };
    }

    scoreboardManager.updateScores(scores);
  }
}

const botManager = BotManager.getInstance();
