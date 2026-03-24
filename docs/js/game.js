const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let scaleFactor = Math.min(canvas.width / 800, canvas.height / 600);
let debugTiles = false;  // toggle with !debug command

const map = new MapLoader();
let obstacleGrid = [];


function drawMap(nowMs) {
  if (!mapAtlas.ready || !map.ready) return;

  const tileSize = 50;
  const mapWidth = map.width;
  const mapHeight = map.height;

  const startX = Math.max(0, Math.floor(camera.x / (tileSize * scaleFactor)));
  const startY = Math.max(0, Math.floor(camera.y / (tileSize * scaleFactor)));

  const endX = Math.min(mapWidth, startX + Math.ceil(canvas.width / (tileSize * scaleFactor)) + 1);
  const endY = Math.min(mapHeight, startY + Math.ceil(canvas.height / (tileSize * scaleFactor)) + 1);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const code = (map.tiles[y * mapWidth + x] || '000000').toUpperCase();
      const tileType = code.slice(0, 3);
      const rot  = parseInt(code[3] || '0', 10) % 4;  // 0-3 → 0/90/180/270°
      const flip = parseInt(code[4] || '0', 10) % 4;  // 0=none,1=H,2=V,3=H+V
      const cVal = parseInt(code[5] || '0', 10);

      const f = mapAtlas.getAnimatedMapTileFrame(tileType, nowMs);
      if (!f) continue;

      const half = tileSize / 2;
      const cx = x * tileSize + half;  // tile centre in world coords
      const cy = y * tileSize + half;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot * Math.PI / 2);
      if (flip !== 0) {
        ctx.scale(
          (flip === 1 || flip === 3) ? -1 : 1,
          (flip === 2 || flip === 3) ? -1 : 1
        );
      }
      ctx.drawImage(mapAtlas.image, f.x, f.y, f.w, f.h, -half, -half, tileSize, tileSize);
      ctx.restore();

      if (debugTiles) {
        // Collision overlay — draw the ColX sprite at 50% opacity with the same
        // rotation/flip as the tile so the blocked zone transforms correctly.
        const colFrame = mapAtlas.getMapTileFrame(`Col${cVal}`);
        if (colFrame && colFrame.w > 1) {
          // Col sprites are authored at 52 px; scale their dimensions proportionally
          // so partial shapes (e.g. Col6 = 52×26 = top half) stay true to their area.
          const COL_BASE = 52;
          const dstW = (colFrame.w / COL_BASE) * tileSize;
          const dstH = (colFrame.h / COL_BASE) * tileSize;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.translate(cx, cy);
          ctx.rotate(rot * Math.PI / 2);
          if (flip !== 0) {
            ctx.scale(
              (flip === 1 || flip === 3) ? -1 : 1,
              (flip === 2 || flip === 3) ? -1 : 1
            );
          }
          ctx.drawImage(mapAtlas.image, colFrame.x, colFrame.y, colFrame.w, colFrame.h, -half, -half, dstW, dstH);
          ctx.restore();
        }
        // Tile border
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * tileSize + 0.25, y * tileSize + 0.25, tileSize - 0.5, tileSize - 0.5);
        // Tile code label
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x * tileSize + 1, y * tileSize + 1, 34, 20);
        ctx.fillStyle = '#fff';
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(code, x * tileSize + 3, y * tileSize + 8);
        ctx.fillStyle = '#adf';
        ctx.fillText(`${x},${y}`, x * tileSize + 3, y * tileSize + 17);
      }
    }
  }
}

function drawHealthBar() {
  let x = 50;
  let y = 15;
  const width = 100;
  const height = 20;
  const health = Math.max(0, Math.min(width, playerManager.mainPlayer.health));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  playerManager.mainPlayer.healthbarHeart.drawCentered(ctx);
  ctx.fillStyle = 'red';
  ctx.fillRect(x, y, health, height);
  ctx.fillStyle = 'black';
  ctx.fillRect(health + x, y, width - health, height);
  ctx.restore();
}

function drawHUD() {
  drawHealthBar();
  const weapon = playerManager.mainPlayer.currentWeapon;
  if (weapon.hasPickup && pickupAtlas.ready) {
    const f = pickupAtlas.getFrameData(weapon.name + '_pickup', 0);
    if (f) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, canvas.width - f.w - 10, 10, f.w, f.h);
      ctx.restore();
    }
  }
}

function update(dt) {
  playerManager.updatePlayers();
  pickupManager.update();
  botManager.update(dt);
}

function drawCursor() {
  if (!cursorAtlas.ready) return;
  const names = Object.keys(cursorAtlas.animationMap);
  if (!names.length) return;
  const animName = names[settingsManager.cursorIndex % names.length];
  const f = cursorAtlas.getFrameData(animName, 0);
  if (!f) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cursorAtlas.image, f.x, f.y, f.w, f.h,
    Math.round(mouseScreenX - f.w / 2),
    Math.round(mouseScreenY - f.h / 2),
    f.w, f.h);
  ctx.restore();
}

function draw(nowMs) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-camera.x, -camera.y);
  ctx.scale(scaleFactor, scaleFactor);

  drawMap(nowMs);
  pickupManager.draw(ctx);
  drawHUD();
  playerManager.drawPlayers(ctx);
  if (debugTiles) drawDebugHitshape(ctx);
  scoreboardManager.draw(ctx, canvas);
  chatManager.draw(ctx, canvas);
  drawCursor();
}

// Draws the main player's weapon hitshape in world space.
function drawDebugHitshape(ctx) {
  const player = playerManager.mainPlayer;
  if (!player || player.isRespawning) return;

  const origin   = player.getPosition();          // {x, y, rotation}
  const rotation = origin.rotation - (90 * Constants.TO_RADIANS); // strip sprite +90° offset
  const weapon   = player.currentWeapon;
  const hitShape = weapon.hitShape ?? { type: 'rect' };
  const radius   = Constants.STICK_FIGURE_HEAD_RADIUS;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,0,0.85)';
  ctx.fillStyle   = 'rgba(255,255,0,0.15)';
  ctx.lineWidth   = 1.5;

  if (hitShape.type === 'ray') {
    const ex = origin.x + Math.cos(rotation) * hitShape.maxRange;
    const ey = origin.y + Math.sin(rotation) * hitShape.maxRange;
    // Ray line
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Width corridor (±radius)
    const nx = -Math.sin(rotation) * radius;
    const ny =  Math.cos(rotation) * radius;
    ctx.beginPath();
    ctx.moveTo(origin.x + nx, origin.y + ny);
    ctx.lineTo(ex + nx, ey + ny);
    ctx.moveTo(origin.x - nx, origin.y - ny);
    ctx.lineTo(ex - nx, ey - ny);
    ctx.stroke();

  } else if (hitShape.type === 'cone') {
    const halfAngle = (hitShape.spreadAngle * Math.PI / 180) / 2;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.arc(origin.x, origin.y, hitShape.maxRange, rotation - halfAngle, rotation + halfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

  } else if (hitShape.type === 'circle') {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, hitShape.maxRange, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else {
    // rect — reconstruct the rotated hitbox from offsets
    const { hitboxOffsets } = player.body.spritesheetData;
    const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(k => {
      const off = hitboxOffsets[k];
      return Physics.rotatePoint(origin.x, origin.y, origin.x + off.x, origin.y + off.y, rotation);
    });
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

let lastTime = 0;
function loop(nowMs) {
  if (!lastTime) lastTime = nowMs;
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);  // seconds; capped to avoid spiral after tab switch
  lastTime = nowMs;

  update(dt);
  draw(nowMs);
  keyEvents(dt);
  mouseEvents();
  requestAnimationFrame(loop);
}

document.addEventListener("keydown", keyDownHandler);
document.addEventListener("keyup", keyUpHandler);
document.addEventListener("blur", onBlurHandler)
canvas.addEventListener("mousemove", mouseMoveHandler);
canvas.addEventListener("mousedown", onMouseDown);
canvas.addEventListener("mouseup", onMouseUp);
canvas.addEventListener("dragstart", e => e.preventDefault());

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.attributeName === "width" || mutation.attributeName === "height") {
      scaleFactor = Math.min(canvas.width / 800, canvas.height / 600);
    }
  });
});

observer.observe(canvas, { attributes: true });

let loopStarted = false;

// Kick off the offline-mode timer.  Must be after all managers are defined.
botManager.init();

function loadMap(filename) {
  return map.load('data/maps/' + filename).then(() => {
    obstacleGrid = map.collisionMap;
    pickupManager.initFromMap(map.weaponSpawns);
    // Tell the server about this map's pickup layout so it can sync state.
    socketManager.emit('mapLoaded', {
      weaponSpawns: map.weaponSpawns.map(ws => ({ weaponId: ws.weaponId, respawnTime: ws.respawnTime })),
    });
    if (!loopStarted) {
      playerManager.createMainPlayer(map.spawnPoints);
      loopStarted = true;
      loop();
    }
  }).catch(err => console.error('Failed to load map:', err));
}
