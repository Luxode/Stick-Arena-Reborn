class Player {
  constructor() {
    this.position = null;
    this.kills = 0;
    this.deaths = 0;
    this.name = '';
    this.weaponId = 0; // fist default
    this.indicatorHue = 0;
    this.indicatorShapeIndex = 0;
  }
}

module.exports = Player;

