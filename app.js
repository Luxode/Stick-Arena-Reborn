const express = require("express");
const path = require("path");
const fs = require("fs");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server);

const Player = require("./server/models/Player");

// Convert a map filename like '__anarchystreets.dat' to 'Anarchystreets'.
function mapDisplayName(filename) {
  return filename.replace(/^_+/, '').replace(/\.dat$/i, '')
    .replace(/^./, c => c.toUpperCase());
}

app.use(express.static(path.join(__dirname, "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client/index.html"));
});

// Toggle debug map via the !debugmap admin command in chat.
let debugMapEnabled = false;
const DEBUG_MAP_FILE = '__debug.dat';

// Discover all available maps at startup.
const mapsDir = path.join(__dirname, "client/data/maps");
const mapFiles = fs.readdirSync(mapsDir).filter(f => f.endsWith(".dat"));

function pickMap() {
  return debugMapEnabled ? DEBUG_MAP_FILE : mapFiles[Math.floor(Math.random() * mapFiles.length)];
}

const ROUND_DURATION_MS   = 5 * 60 * 1000; // 5 minutes
const ROUND_END_DISPLAY_MS = 10 * 1000;    // 10 s scoreboard display

let players = {};
const bannedIps = new Set();

let game = {
  mapFile:      pickMap(),
  roundEndsAt:  Date.now() + ROUND_DURATION_MS,
  phase:        'playing', // 'playing' | 'roundEnd'
  pickups:      [],  // { weaponId, respawnTime, available, respawnAt }
  pickupTimers: {}, // spawnIndex → timeout handle
};

function getScores() {
  const scores = {};
  for (const id in players) {
    scores[id] = {
      name:         players[id].name,
      kills:        players[id].kills,
      deaths:       players[id].deaths,
      indicatorHue: players[id].indicatorHue ?? 0,
    };
  }
  return scores;
}

let roundEndTimeout = null;

function scheduleRoundEnd() {
  if (roundEndTimeout) clearTimeout(roundEndTimeout);
  const remaining = game.roundEndsAt - Date.now();
  roundEndTimeout = setTimeout(() => {
    game.phase = 'roundEnd';
    io.emit('roundEnd', { scores: getScores() });
    io.emit('chatMessage', { name: 'Server', text: `Round over! Next round starting in ${ROUND_END_DISPLAY_MS / 1000} seconds...` });
    setTimeout(startNewRound, ROUND_END_DISPLAY_MS);
  }, Math.max(remaining, 0));
}

function startNewRound() {
  game.mapFile     = pickMap();
  game.roundEndsAt = Date.now() + ROUND_DURATION_MS;
  game.phase       = 'playing';

  // Cancel all pending pickup respawn timers and reset state.
  for (const idx in game.pickupTimers) clearTimeout(game.pickupTimers[idx]);
  game.pickupTimers = {};
  game.pickups = [];

  for (const id in players) {
    players[id].kills    = 0;
    players[id].deaths   = 0;
    players[id].weaponId = 0; // reset to fist on round start
  }

  io.emit('roundStart', {
    mapFile:     game.mapFile,
    roundEndsAt: game.roundEndsAt,
    scores:      getScores(),
  });
  io.emit('chatMessage', { name: 'Server', text: `Round started on ${mapDisplayName(game.mapFile)}!` });

  scheduleRoundEnd();
}

scheduleRoundEnd();

io.on("connection", (socket) => {
  console.log("a user connected: ", socket.id);

  // Reject banned IPs immediately.
  const connIp = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '')
    .split(',')[0].trim().replace(/^::ffff:/, '');
  if (bannedIps.has(connIp)) {
    socket.emit('kicked', { reason: 'You are banned.' });
    socket.disconnect(true);
    return;
  }

  const p = new Player();
  p.name     = 'Player ' + socket.id.slice(0, 4);
  p.position = { x: 0, y: 0 };
  players[socket.id] = p;

  socket.emit("currentPlayers", players);
  socket.emit("gameState", {
    mapFile:     game.mapFile,
    roundEndsAt: game.roundEndsAt,
    phase:       game.phase,
    scores:      getScores(),
  });
  socket.broadcast.emit("newPlayer", { playerId: socket.id, name: p.name });
  io.emit("scoreUpdate", { scores: getScores() });
  io.emit("chatMessage", { name: 'Server', text: `${p.name} joined the game.` });

  socket.on("disconnect", () => {
    console.log("user disconnected: ", socket.id);
    const leavingName = players[socket.id]?.name ?? 'A player';
    delete players[socket.id];
    io.emit("playerDisconnected", socket.id);
    io.emit("scoreUpdate", { scores: getScores() });
    io.emit("chatMessage", { name: 'Server', text: `${leavingName} left the game.` });
  });

  socket.on("playerMovement", (movementData) => {
    if (!players[socket.id]) return;
    players[socket.id].position = movementData;
    socket.broadcast.emit("playerMoved", {
      playerId:  socket.id,
      playerPos: players[socket.id].position
    });
  });

  socket.on("playedShoot", () => {
    socket.broadcast.emit("playShoot", { playerId: socket.id });
  });

  socket.on("playedWalkingAnimation", (walkingInfo) => {
    socket.broadcast.emit("playWalkingAnimation", {
      playerId: socket.id,
      rotation: walkingInfo.rotation
    });
  });

  // Relay hit to all clients — the victim's client owns health tracking and reports death.
  socket.on("playerHit", (data) => {
    const { playerId: victimId, damage, weaponId } = data;
    if (!(victimId in players)) return;
    if (game.phase !== 'playing') return;
    io.emit("playerGotHit", { playerId: victimId, damage, weaponId, attackerId: socket.id });
  });

  // Victim's own client reports death once their local HP reaches zero.
  socket.on("iDied", (data) => {
    if (!players[socket.id]) return;
    if (game.phase !== 'playing') return;
    players[socket.id].deaths  += 1;
    players[socket.id].weaponId = 0; // reset to fist on death
    const killerId = data.killerId;
    if (killerId && players[killerId]) players[killerId].kills += 1;
    io.emit("playerDied", { playerId: socket.id });
    io.emit("scoreUpdate", { scores: getScores() });
  });

  socket.on("playerRespawn", (data) => {
    socket.broadcast.emit("playerMoved", {
      playerId:  socket.id,
      playerPos: data.position
    });
  });

  // Client sends its spinner identity once the map has loaded.
  socket.on("playerIdentity", (data) => {
    if (!players[socket.id]) return;
    players[socket.id].indicatorHue        = data.hue        | 0;
    players[socket.id].indicatorShapeIndex = data.shapeIndex | 0;
    socket.broadcast.emit("playerIdentityUpdate", {
      playerId:           socket.id,
      indicatorHue:       data.hue        | 0,
      indicatorShapeIndex: data.shapeIndex | 0,
    });
  });

  // Client finished parsing the map — send (or initialize) pickup state.
  socket.on("mapLoaded", (data) => {
    if (game.pickups.length === 0 && Array.isArray(data.weaponSpawns) && data.weaponSpawns.length) {
      game.pickups = data.weaponSpawns.map(ws => ({
        weaponId:    ws.weaponId,
        respawnTime: ws.respawnTime,
        available:   true,
        respawnAt:   null,
      }));
    }
    // Send current state so this client shows the right pickups.
    socket.emit("pickupState", game.pickups.map(p => ({ available: p.available, respawnAt: p.respawnAt })));
  });

  // Client player walked over a pickup.
  socket.on("pickupWeapon", (data) => {
    const { spawnIndex } = data;
    if (!players[socket.id]) return;
    const pickup = game.pickups[spawnIndex];
    if (!pickup || !pickup.available) return;

    pickup.available = false;
    pickup.respawnAt = Date.now() + pickup.respawnTime;
    players[socket.id].weaponId = pickup.weaponId;

    // Broadcast to others — the picking player already resolved this locally.
    socket.broadcast.emit("pickupTaken", { spawnIndex, playerId: socket.id, weaponId: pickup.weaponId });

    // Server resets availability after respawn so pickupState stays accurate for new joiners.
    const timer = setTimeout(() => {
      pickup.available = true;
      pickup.respawnAt = null;
      delete game.pickupTimers[spawnIndex];
      // No pickupRespawned emit — clients manage their own visibility timers.
    }, pickup.respawnTime);
    game.pickupTimers[spawnIndex] = timer;
  });

  socket.on("chatMessage", (data) => {
    const name = players[socket.id]?.name ?? 'Unknown';
    const hue  = players[socket.id]?.indicatorHue ?? 0;
    const text = String(data.text ?? '').trim().slice(0, 80);
    if (!text) return;

    // Admin commands — local clients only.
    if (text.startsWith('!')) {
      const raw = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '';
      const ip  = raw.split(',')[0].trim().replace(/^::ffff:/, '');
      const isLocal = !ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost'
        || /^10\./.test(ip)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
        || /^192\.168\./.test(ip);

      if (isLocal) {
        const parts = text.split(/\s+/);
        const cmd   = parts[0].toLowerCase();

        if (cmd === '!next') {
          if (game.phase === 'playing') {
            if (roundEndTimeout) clearTimeout(roundEndTimeout);
            game.phase = 'roundEnd';
            io.emit('roundEnd', { scores: getScores() });
            setTimeout(startNewRound, ROUND_END_DISPLAY_MS);
          }
          return;
        }

        if (cmd === '!kick') {
          const target = parts[1];
          for (const id in players) {
            if (players[id].name === target || id === target) {
              io.to(id).emit('kicked', { reason: 'Kicked by admin.' });
              setTimeout(() => { const s = io.sockets.sockets.get(id); if (s) s.disconnect(true); }, 500);
              io.emit('chatMessage', { name: '[Admin]', text: `${players[id].name} was kicked.` });
              return;
            }
          }
          return;
        }

        if (cmd === '!ban') {
          const target = parts[1];
          for (const id in players) {
            if (players[id].name === target || id === target) {
              const banIp = (io.sockets.sockets.get(id)?.handshake?.headers?.['x-forwarded-for']
                || io.sockets.sockets.get(id)?.handshake?.address || '').split(',')[0].trim().replace(/^::ffff:/, '');
              if (banIp) bannedIps.add(banIp);
              io.to(id).emit('kicked', { reason: 'Banned by admin.' });
              setTimeout(() => { const s = io.sockets.sockets.get(id); if (s) s.disconnect(true); }, 500);
              io.emit('chatMessage', { name: '[Admin]', text: `${players[id].name} was banned.` });
              return;
            }
          }
          return;
        }

        if (cmd === '!weapon') {
          const weaponId = parseInt(parts[1], 10);
          if (!isNaN(weaponId) && weaponId >= 0 && weaponId < weaponsData.length) {
            players[socket.id].weaponId = weaponId;
            socket.emit('forceWeapon', { weaponId });
          }
          return;
        }


        if (cmd === '!debugmap') {
          debugMapEnabled = !debugMapEnabled;
          socket.emit('chatMessage', { name: 'Server', text: `Debug map ${debugMapEnabled ? 'ON (__debug.dat)' : 'OFF (random maps)'} — starting new round...` });
          if (roundEndTimeout) clearTimeout(roundEndTimeout);
          game.phase = 'roundEnd';
          io.emit('roundEnd', { scores: getScores() });
          setTimeout(startNewRound, ROUND_END_DISPLAY_MS);
          return;
        }

        return; // ignore unknown ! commands from local
      }
    }

    io.emit("chatMessage", { name, hue, text });
  });

  socket.on("setName", (data) => {
    if (!players[socket.id]) return;
    const name = String(data.name ?? '').trim().slice(0, 20);
    if (!name) return;
    players[socket.id].name = name;
    socket.broadcast.emit("playerNameChanged", { playerId: socket.id, name });
    io.emit("scoreUpdate", { scores: getScores() });
  });
});

server.listen(process.env.PORT || 1138, () => {
  console.log(`Listening on ${server.address().port}`);
});

