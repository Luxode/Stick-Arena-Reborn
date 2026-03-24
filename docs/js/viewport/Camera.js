class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
  }
  
  setPos(player) {
    this.x = Math.floor((player.x * scaleFactor) - canvas.width / 2);
    this.y = Math.floor((player.y * scaleFactor) - canvas.height / 2);
  }
}

const camera = new Camera();
