socketManager.on("currentPlayers", (players) => {
  for (const playerId in players) {
    if (playerId === socketManager.socket?.id) continue;
    const info = players[playerId];
    const player = new Player(info.position.x, info.position.y);
    if (info.name)                player.name               = info.name;
    if (info.weaponId        != null) player.equipWeapon(info.weaponId);
    if (info.indicatorHue        != null) player.indicatorHue        = info.indicatorHue;
    if (info.indicatorShapeIndex != null) player.indicatorShapeIndex = info.indicatorShapeIndex;
    playerManager.addPlayer(playerId, player);
  }
});

socketManager.on("newPlayer", (data) => {
  const player = new Player(-10, -10);
  if (data.name) player.name = data.name;
  playerManager.addPlayer(data.playerId, player);
  soundManager.play('join_lobby');
});

socketManager.on("playerDisconnected", (playerId) => {
  playerManager.removePlayer(playerId);
});

socketManager.on("playWalkingAnimation", (data) => {
  const { playerId, rotation } = data;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  player.playWalkingAnim(rotation);
});

socketManager.on("playerMoved", (data) => {
  const { playerId, playerPos } = data;
  
  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  player.setPosition(playerPos.x, playerPos.y, playerPos.rotation);
});

socketManager.on("playShoot", (data) => {
  const { playerId } = data;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  player.shoot();
});

// Last attacker's socket id — used to give kill credit when the main player dies.
let _lastAttackerId = null;

socketManager.on("playerGotHit", (data) => {
  const { playerId, damage, weaponId, attackerId } = data;
  const myId = socketManager.socket?.id;

  let player = playerManager.getPlayer(playerId);
  const isMe = !player && playerId === myId;
  if (isMe) {
    player = playerManager.mainPlayer;
    _lastAttackerId = attackerId;
  }
  if (!player || player.isRespawning) return;

  player.showHitsplat(damage, weaponId);

  // Only the victim's own client triggers death, to avoid every player calling it.
  if (isMe && player.health <= 0) {
    socketManager.emit('iDied', { killerId: _lastAttackerId });
    player.death();
  }
});

socketManager.on("playerDied", (data) => {
  const { playerId } = data;

  // Bots are handled locally; we already triggered our own death above.
  if (botManager.isBot(playerId)) return;
  if (playerId === socketManager.socket?.id) return;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;
  player.death();
});

socketManager.on("gameState", (data) => {
  scoreboardManager.updateScores(data.scores);
  scoreboardManager.roundEndsAt = data.roundEndsAt;
  if (data.phase === 'roundEnd') scoreboardManager.showRoundEnd(data.scores);
  Constants._weaponsReady.then(() => loadMap(data.mapFile).then(() => {
    // Spawn bots when alone, despawn when others are present.
    botManager.considerSpawning(data.scores);
  }));
});

function _myRank(scores) {
  const myId = socketManager.socket?.id;
  if (!myId || !(myId in scores)) return null;
  const sorted = Object.entries(scores).sort((a, b) => b[1].kills - a[1].kills);
  return sorted.findIndex(([id]) => id === myId) + 1; // 1-based
}

let _prevMyKills = 0;
let _prevMyRank  = null;

socketManager.on("scoreUpdate", (data) => {
  const myId      = socketManager.socket?.id;
  const prevKills = scoreboardManager.scores[myId]?.kills ?? 0;
  const prevRank  = _prevMyRank;

  scoreboardManager.updateScores(data.scores);

  // Keep the local player entity's counters in sync with the server's authoritative values.
  if (myId && data.scores[myId] && playerManager.mainPlayer) {
    playerManager.mainPlayer.kills  = data.scores[myId].kills;
    playerManager.mainPlayer.deaths = data.scores[myId].deaths;
  }

  const newKills = data.scores[myId]?.kills ?? 0;
  const newRank  = _myRank(data.scores);
  _prevMyRank = newRank;

  if (newKills > prevKills) soundManager.play('kill');

  if (newRank !== null && prevRank !== null && newRank !== prevRank) {
    soundManager.play(newRank === 1 ? 'position_first' : 'position_change');
  }
});

socketManager.on("roundEnd", (data) => {
  scoreboardManager.showRoundEnd(data.scores);
  const rank = _myRank(data.scores);
  soundManager.play(rank === 1 ? 'win' : 'lose');
  _prevMyRank = null; // reset for next round
});

socketManager.on("roundStart", (data) => {
  scoreboardManager.updateScores(data.scores);
  scoreboardManager.roundEndsAt = data.roundEndsAt;
  scoreboardManager.hideRoundEnd();
  loadMap(data.mapFile).then(() => {
    if (playerManager.mainPlayer) {
      playerManager.mainPlayer.forceRespawn(map.spawnPoints);
    }
    // Reset all remote players back to fist — server resets weaponId on round start.
    for (const id in playerManager.getPlayers()) {
      playerManager.getPlayers()[id].equipWeapon(0);
    }
    // Re-evaluate bots: despawn if others joined, keep/spawn if still alone.
    botManager.considerSpawning(data.scores);
  });
});

socketManager.on("playerIdentityUpdate", (data) => {
  const player = playerManager.getPlayer(data.playerId);
  if (!player) return;
  player.indicatorHue        = data.indicatorHue;
  player.indicatorShapeIndex = data.indicatorShapeIndex;
});

socketManager.on("pickupState", (states) => {
  pickupManager.applyState(states);
});

socketManager.on("pickupTaken", (data) => {
  const { spawnIndex, playerId, weaponId } = data;
  // Our own pickup is already handled locally; only process events for remote players.
  if (playerId === socketManager.socket?.id) return;
  pickupManager.takePickupRemote(spawnIndex, playerId, weaponId);
});

socketManager.on("chatMessage", (data) => {
  chatManager.addMessage(data.name, data.text, data.hue ?? null);
});

socketManager.on("playerNameChanged", (data) => {
  const player = playerManager.getPlayer(data.playerId);
  if (player) player.name = data.name;
});

socketManager.on("kicked", (data) => {
  alert(data.reason || 'You have been removed from the server.');
  socketManager.socket.disconnect();
});

socketManager.on("forceWeapon", (data) => {
  if (playerManager.mainPlayer) playerManager.mainPlayer.equipWeapon(data.weaponId);
});


