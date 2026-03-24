// Raw screen-space mouse position (used for cursor rendering in game.js).
let mouseScreenX = -100;
let mouseScreenY = -100;

function mouseMoveHandler(event) {
  mouseScreenX = event.offsetX;
  mouseScreenY = event.offsetY;

  if (!playerManager.mainPlayer || playerManager.mainPlayer.isRespawning) return;

  const mouseX = event.offsetX - canvas.width / 2;
  const mouseY = event.offsetY - canvas.height / 2;

  const spriteRotation = Math.atan2(mouseY, mouseX) + (90 * Constants.TO_RADIANS);
  playerManager.mainPlayer.body.setRotation(spriteRotation);
}

let mouseLMBDown = false;

function onMouseDown(event) {
  if (event.button !== Constants.LEFT_MOUSE_BUTTON) return;
  mouseLMBDown = true;
}

function onMouseUp(event) {
  if (event.button !== Constants.LEFT_MOUSE_BUTTON) return;
  mouseLMBDown = false;
}

function mouseEvents() {
  if (!playerManager.mainPlayer) return;
  if (!mouseLMBDown) return;
  if (!playerManager.mainPlayer.canShoot || playerManager.mainPlayer.isRespawning) return;
  playerManager.mainPlayer.shoot();
}
