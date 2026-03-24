// A single weapon pickup lying on the map floor.
class WeaponPickup {
  constructor(x, y, weaponId, respawnTime = 10000) {
    this.weaponId    = weaponId;
    this.respawnTime = respawnTime;
    this.phaseOffset = Math.random() * Math.PI * 2; // random start so pickups don't all sync

    const weapon = Constants.WEAPON_ID_MAP[weaponId];
    const animName = weapon?.hasPickup ? weapon.name + '_pickup' : null;
    this.sprite = animName ? new AtlasGameObject(pickupAtlas, animName, x, y) : null;
    if (this.sprite) this.sprite.isVisible = true;
  }

  get isVisible() { return this.sprite ? this.sprite.isVisible : false; }
  set isVisible(v) { if (this.sprite) this.sprite.isVisible = v; }

  update() {
    if (this.sprite) this.sprite.update();
  }

  draw(ctx) {
    if (!this.sprite || !this.sprite.isVisible) return;
    const f = pickupAtlas.getFrameData(this.sprite.animName, 0);
    if (!f) return;

    const t = performance.now() / 1000 + this.phaseOffset;
    const bob   = Math.sin(t * 1.5) * 5;  // ±5 px vertical bob
    const angle = t * (Math.PI * 2 / 6);  // one full rotation every 6 s

    ctx.save();
    ctx.translate(this.sprite.x, this.sprite.y + bob);
    ctx.rotate(angle);
    ctx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
  }

  isPlayerOverlapping(px, py, radius = 38) {
    if (!this.sprite || !this.sprite.isVisible) return false;
    const dx = px - this.sprite.x, dy = py - this.sprite.y;
    return dx * dx + dy * dy < radius * radius;
  }
}
