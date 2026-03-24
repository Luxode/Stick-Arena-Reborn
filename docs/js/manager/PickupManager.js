class PickupManager {
  static getInstance() {
    if (!PickupManager.instance) {
      PickupManager.instance = new PickupManager();
    }
    return PickupManager.instance;
  }

  constructor() {
    this.pickups = [];
  }

  initFromMap(weaponSpawns) {
    this.pickups = weaponSpawns.map(
      ws => new WeaponPickup(ws.x, ws.y, ws.weaponId, ws.respawnTime)
    );
    // Visible immediately; server state (applyState) will correct any already-taken ones.
  }

  // Apply the pickup state array sent by the server (on join / reconnect).
  // Hides taken pickups and starts local respawn timers based on the server's respawnAt timestamp.
  applyState(states) {
    states.forEach((state, i) => {
      const pick = this.pickups[i];
      if (!pick) return;
      if (state.available) {
        pick.isVisible = true;
      } else {
        pick.isVisible = false;
        const ms = state.respawnAt
          ? Math.max(0, state.respawnAt - Date.now())
          : (pick.respawnTime || 10000);
        setTimeout(() => { if (this.pickups[i]) this.pickups[i].isVisible = true; }, ms);
      }
    });
  }

  // Unified pickup: hides the pickup, equips it on playerEntity, starts local respawn timer.
  // Pass emitToServer=true for the human player when connected.
  takePickup(index, playerEntity, emitToServer = false) {
    const pick = this.pickups[index];
    if (!pick || !pick.isVisible) return false;
    pick.isVisible = false;
    if (playerEntity) playerEntity.equipWeapon(pick.weaponId);
    const ms = pick.respawnTime || 10000;
    setTimeout(() => { if (this.pickups[index]) this.pickups[index].isVisible = true; }, ms);
    if (emitToServer) socketManager.emit('pickupWeapon', { spawnIndex: index });
    return true;
  }

  // Called when the server relays that a remote player picked something up.
  takePickupRemote(index, playerId, weaponId) {
    const pick = this.pickups[index];
    if (!pick) return;
    pick.isVisible = false;
    const ms = pick.respawnTime || 10000;
    setTimeout(() => { if (this.pickups[index]) this.pickups[index].isVisible = true; }, ms);
    const player = playerManager.getPlayer(playerId);
    if (player) player.equipWeapon(weaponId);
  }

  update() {
    this.pickups.forEach(p => p.update());

    if (!playerManager.mainPlayer) return;
    const px = playerManager.mainPlayer.body.x;
    const py = playerManager.mainPlayer.body.y;
    for (let i = 0; i < this.pickups.length; i++) {
      if (this.pickups[i].isPlayerOverlapping(px, py)) {
        this.takePickup(i, playerManager.mainPlayer, true);
      }
    }
  }

  draw(ctx) {
    this.pickups.forEach(p => p.draw(ctx));
  }
}

const pickupManager = PickupManager.getInstance();
