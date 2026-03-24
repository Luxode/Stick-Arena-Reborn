class ScoreboardManager {
  static getInstance() {
    if (!ScoreboardManager.instance) {
      ScoreboardManager.instance = new ScoreboardManager();
    }
    return ScoreboardManager.instance;
  }

  constructor() {
    this.scores = {};        // { [playerId]: { name, kills, deaths } }
    this.tabHeld = false;
    this.roundEndActive = false;
    this.roundEndsAt = null;
  }

  get isVisible() {
    return this.tabHeld || this.roundEndActive;
  }

  updateScores(scores) {
    this.scores = scores;
  }

  showRoundEnd(scores) {
    this.scores = scores;
    this.roundEndActive = true;
  }

  hideRoundEnd() {
    this.roundEndActive = false;
  }

  getRemainingTime() {
    if (!this.roundEndsAt) return 0;
    return Math.max(0, Math.ceil((this.roundEndsAt - Date.now()) / 1000));
  }

  draw(ctx, canvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Round timer — always visible, top-center.
    const remaining = this.getRemainingTime();
    const minutes = Math.floor(remaining / 60);
    const seconds  = String(remaining % 60).padStart(2, '0');

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(canvas.width / 2 - 42, 4, 84, 26);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, canvas.width / 2, 23);

    // Rank under timer — use 'local_player' when offline (matches BotManager's key).
    const myId = (typeof socketManager !== 'undefined')
      ? (socketManager.socket?.id ?? 'local_player')
      : 'local_player';
    if (myId && this.scores && myId in this.scores) {
      const sorted = Object.entries(this.scores).sort((a, b) => b[1].kills - a[1].kills);
      const rank = sorted.findIndex(([id]) => id === myId) + 1;
      const total = sorted.length;
      const suffixes = ['th','st','nd','rd'];
      const suffix = (rank >= 11 && rank <= 13) ? 'th' : (suffixes[rank % 10] || 'th');
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(canvas.width / 2 - 36, 31, 72, 17);
      ctx.fillStyle = '#aaccee';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${rank}${suffix} / ${total}`, canvas.width / 2, 43);
    }

    if (this.isVisible) {
      this._drawOverlay(ctx, canvas);
    }

    // Bot status banner at bottom of screen.
    if (typeof botManager !== 'undefined' && botManager.status !== 'none') {
      const msg = botManager.status === 'no-server'
        ? 'No connection to the server, playing against bots.'
        : 'Waiting for other players, playing against bots.';
      ctx.font = '13px monospace';
      const tw = ctx.measureText(msg).width;
      const bx = (canvas.width - tw) / 2;
      const by = canvas.height - 12;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 8, by - 15, tw + 16, 20);
      ctx.fillStyle = botManager.status === 'no-server' ? '#ff9955' : '#88ccff';
      ctx.textAlign = 'left';
      ctx.fillText(msg, bx, by);
    }

    ctx.restore();
  }

  _drawOverlay(ctx, canvas) {
    const padX = 100, padY = 70;
    const overlayW = canvas.width  - padX * 2;
    const overlayH = canvas.height - padY * 2;

    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(padX, padY, overlayW, overlayH);

    // Thin border
    ctx.strokeStyle = '#4a6fa5';
    ctx.lineWidth = 2;
    ctx.strokeRect(padX, padY, overlayW, overlayH);

    // Title
    ctx.fillStyle = this.roundEndActive ? '#ff6b6b' : 'white';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.roundEndActive ? 'ROUND OVER' : 'SCOREBOARD',
      canvas.width / 2,
      padY + 40
    );

    // Column headers
    const startY   = padY + 70;
    const rowH     = 28;
    const colName   = padX + 24;
    const colKills  = padX + overlayW - 200;
    const colDeaths = padX + overlayW - 80;

    ctx.fillStyle = '#8899aa';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', colName, startY);
    ctx.textAlign = 'center';
    ctx.fillText('KILLS',  colKills,  startY);
    ctx.fillText('DEATHS', colDeaths, startY);

    // Separator line
    ctx.strokeStyle = '#334455';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX + 10, startY + 6);
    ctx.lineTo(padX + overlayW - 10, startY + 6);
    ctx.stroke();

    // Rows sorted by kills desc
    const myId  = (typeof socketManager !== 'undefined')
      ? (socketManager.socket?.id ?? 'local_player')
      : 'local_player';
    const sorted = Object.entries(this.scores).sort((a, b) => b[1].kills - a[1].kills);

    sorted.forEach(([id, data], i) => {
      const y    = startY + rowH * (i + 1);
      const isMe = id === myId;
      const displayName = isMe ? 'You' : data.name;

      // Derive spinner color (sepia+saturate+hue-rotate shifts base by ~36°)
      const nameHue = ((data.indicatorHue ?? 0) + 36) % 360;
      ctx.fillStyle = `hsl(${nameHue},80%,${isMe ? '75%' : '65%'})`;
      ctx.font      = isMe ? 'bold 14px monospace' : '14px monospace';

      ctx.textAlign = 'left';
      ctx.fillText(displayName, colName, y);

      ctx.fillStyle = isMe ? 'white' : '#ccc';
      ctx.textAlign = 'center';
      ctx.fillText(data.kills,  colKills,  y);
      ctx.fillText(data.deaths, colDeaths, y);
    });
  }
}

const scoreboardManager = ScoreboardManager.getInstance();
