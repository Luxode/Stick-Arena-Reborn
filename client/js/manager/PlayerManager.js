class PlayerManager {
  static getInstance() {
    if (!PlayerManager.instance) {
      PlayerManager.instance = new PlayerManager();
    }
    return PlayerManager.instance;
  }

  constructor() {
    this.players = {};
    this.mainPlayer = null;
  }

  createMainPlayer(spawnPoints = []) {
    const pts = spawnPoints.length ? spawnPoints : [{ x: 400, y: 300 }];
    const { x, y } = pts[Math.floor(Math.random() * pts.length)];

    this.mainPlayer = new Player(x, y);
    this.mainPlayer.isMainPlayer = true;
    this.mainPlayer.healthbarHeart = new AtlasGameObject(heartbeatAtlas, 'heartbeat_healthy', 30, 25);

    // Apply persisted settings (name, spinner appearance).
    this.mainPlayer.name               = settingsManager.name;
    this.mainPlayer.indicatorHue       = settingsManager.spinnerHue;
    this.mainPlayer.indicatorShapeIndex = settingsManager.spinnerShapeIndex;

    // Broadcast this player's name and visual identity to the server.
    socketManager.emit('setName', { name: settingsManager.name });
    socketManager.emit('playerIdentity', {
      hue:        settingsManager.spinnerHue,
      shapeIndex: settingsManager.spinnerShapeIndex,
    });

    socketManager.emit("playerMovement", { x: x, y: y });
  }

  getPlayer(id) {
    return this.players[id];
  }

  getPlayers() {
    return this.players;
  }

  addPlayer(id, player) {
    this.players[id] = player;
  }

  removePlayer(id) {
    delete this.players[id];
  }

  updatePlayers() {
    this.mainPlayer.update();
    camera.setPos(this.mainPlayer.body);

    for (const id in this.players) {
      this.players[id].update();
    }
  }

  drawPlayers(ctx) {
    for (const id in this.players) {
      this.players[id].draw(ctx);
    }

    this.mainPlayer.draw(ctx);
  }
}

const playerManager = PlayerManager.getInstance();
