class Player {
  constructor(x, y) {
    this.health = 100;
    this.kills  = 0;
    this.deaths = 0;
    this.canMove = true;
    this.canShoot = true;
    this.isRespawning = false;
    this.isMainPlayer = false;
    this.previousPosition = { x: -1, y: -1, rotation: -1 };
    this.name = '';

    // Indicator spinner — shape index + hue form the player's visual identity.
    // Both are synced to/from the server so all clients see the same spinner.
    this.indicatorShapeIndex = Math.floor(Math.random() * 64);
    this.indicatorHue = Math.floor(Math.random() * 360);

    // Current weapon definition (from Constants.WEAPON_ID_MAP).
    this.currentWeapon = Constants.WEAPON_ID_MAP[0]; // fist default

    // Body (upper half + weapon) — atlas-based, loops glock_idle by default.
    this.body = new AtlasGameObject(playerAtlas, 'fist_idle', x, y);
    this.body._defaultAnim = 'fist_idle';
    // Provide hitbox data compatible with checkCollision (glock_shoot frame geometry).
    this.body.spritesheetData = {
      spriteCenter: { x: 35, y: 485 },
      hitboxOffsets: {
        topLeft:     { x: 25, y: 0 },
        topRight:    { x: 50, y: 0 },
        bottomLeft:  { x: 25, y: 449 },
        bottomRight: { x: 50, y: 449 }
      }
    };

    // Legs — atlas-based, plays once per move call then hides.
    this.legs = new AtlasGameObject(playerAtlas, 'run', x, y, 1);
    this.legs.isVisible = false;

    // Hitsplat — atlas-based blood animation, picks variant from current weapon.
    this.hitsplat = new AtlasGameObject(bloodAtlas, 'blood_bullet_0', x, y, 1);
    this.hitsplat.isVisible = false;

    // Muzzle flash / shoot particle effect.
    this.muzzleFlash = new AtlasGameObject(particleAtlas, 'glock_particle', x, y, 1);
    this.muzzleFlash.isVisible = false;
    this.muzzleFlashPinned = false; // when true, particle stays at world position where it spawned

    // Death body — atlas-based, plays one random death anim then hides.
    this.deathBody = new AtlasGameObject(deathAtlas, 'death_0', x, y, 1);
    this.deathBody.isVisible = false;

    // Body event: fires when a shoot animation finishes — resets visual state.
    this.body.addEventListener("animationcomplete", () => {
      this.body.isShootingAnimation = false;
      this.body.resetAnimation();
    });

    // Death animation finished — respawn.
    this.deathBody.addEventListener("animationcomplete", () => {
      this.health = 100;
      this.canShoot = true;
      this.canMove = true;

      // Move body to the new spawn position BEFORE clearing isRespawning,
      // so the body is never drawn at the death position.
      if (this.isMainPlayer) {
        this.healthbarHeart.setAnimation('heartbeat_healthy');
        this.respawn();
      }

      this.isRespawning = false;
      this.deathBody.isVisible = false;
      this.body.isVisible = true;

      this.deathBody.setAnimation('death_0');
    });

    this.legs.addEventListener("animationcomplete", () => {
      this.canMove = true;
      this.legs.isVisible = false;
      this.legs.resetAnimationRepeat(1);
    });

    this.muzzleFlash.addEventListener("animationcomplete", () => {
      this.muzzleFlash.isVisible = false;
    });

    this.hitsplat.addEventListener("animationcomplete", () => {
      this.hitsplat.isVisible = false;
    });

    this.body.addEventListener("shotsfired", this.checkCollision.bind(this));
  }

  checkCollision(data) {
    if (!this.isMainPlayer) return;

    const playerPos = data.playerPos;
    // body.rotation has +90° baked in for sprite orientation — remove it for physics.
    const rotation = this.body.rotation - (90 * Constants.TO_RADIANS);
    const origin = { x: playerPos.x, y: playerPos.y };
    const hitShape = this.currentWeapon.hitShape ?? { type: 'rect' };

    // Rectangle hitbox (default): pre-compute once, reused for all targets.
    let hitboxRegion = null;
    if (hitShape.type === 'rect') {
      const { hitboxOffsets } = this.body.spritesheetData;
      hitboxRegion = {
        topLeft:     { x: origin.x + hitboxOffsets.topLeft.x,     y: origin.y + hitboxOffsets.topLeft.y },
        topRight:    { x: origin.x + hitboxOffsets.topRight.x,    y: origin.y + hitboxOffsets.topRight.y },
        bottomLeft:  { x: origin.x + hitboxOffsets.bottomLeft.x,  y: origin.y + hitboxOffsets.bottomLeft.y },
        bottomRight: { x: origin.x + hitboxOffsets.bottomRight.x, y: origin.y + hitboxOffsets.bottomRight.y }
      };
      for (const corner in hitboxRegion) {
        const p = hitboxRegion[corner];
        const rotated = Physics.rotatePoint(origin.x, origin.y, p.x, p.y, rotation);
        hitboxRegion[corner].x = rotated.x;
        hitboxRegion[corner].y = rotated.y;
      }
    }

    const otherPlayers = playerManager.getPlayers();
    for (const playerId in otherPlayers) {
      const otherPlayer = otherPlayers[playerId];
      if (otherPlayer.isMainPlayer) continue;
      if (otherPlayer.isRespawning) continue;
      if (Physics.checkForObstacles(playerPos, otherPlayer.getPosition())) continue;

      const targetPos = otherPlayer.getPosition();
      let hit = false;
      if (hitShape.type === 'ray') {
        hit = Physics.isRayHit(origin, targetPos, rotation, hitShape.maxRange);
      } else if (hitShape.type === 'cone') {
        hit = Physics.isConeHit(origin, targetPos, rotation, hitShape.maxRange, hitShape.spreadAngle);
      } else if (hitShape.type === 'circle') {
        hit = Physics.isCircleHit(origin, targetPos, hitShape.maxRange);
      } else {
        hit = Physics.isCircleCollidingRect(targetPos, hitboxRegion);
      }

      if (hit) socketManager.emit("playerHit", { playerId, damage: this.currentWeapon.damage ?? 5, weaponId: this.currentWeapon.id ?? 0 });
    }
  }

  setPosition(x, y, rotation) {
    this.body.setPosition(x, y);
    if (rotation) {
      this.body.setRotation(rotation);
    }
  }

  getPosition() {
    return {
      x: this.body.x,
      y: this.body.y,
      rotation: this.body.rotation
    }
  }

  isPositionChanged(currentPosition) {
    return currentPosition.x !== this.previousPosition.x
      || currentPosition.y !== this.previousPosition.y
      || currentPosition.rotation !== this.previousPosition.rotation;
  }

  playWalkingAnim(legRotation = 0) {
    this.legs.isVisible = true;
    this.canMove = false;
    this.legs.setPosition(this.body.x, this.body.y);
    this.legs.setRotation(legRotation * Constants.TO_RADIANS);
  }

  move(speedX, speedY = null, legRotation = 0) {
    const curX = this.body.x;
    const curY = this.body.y;
    const newX = speedX != null ? curX + speedX : curX;
    const newY = speedY != null ? curY + speedY : curY;

    const _blocked = (x, y) => {
      if (!obstacleGrid.length) return false;
      const tx = Math.floor(x / 50), ty = Math.floor(y / 50);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
      const tile = obstacleGrid[ty * map.width + tx];
      return tile && Physics.isTileWalkBlocked(tile, x % 50, y % 50);
    };

    // Try full diagonal move first.
    if (!_blocked(newX, newY)) {
      if (speedX != null) this.body.setVelocityX(speedX);
      if (speedY != null) this.body.setVelocityY(speedY);
    } else {
      // Slide: try each axis independently so the player glides along walls.
      const canX = speedX != null && !_blocked(newX, curY);
      const canY = speedY != null && !_blocked(curX, newY);
      if (canX) this.body.setVelocityX(speedX);
      if (canY) this.body.setVelocityY(speedY);
      if (!canX && !canY) return; // fully blocked — no anim either
    }

    this.playWalkingAnim(legRotation);

    if (this.isMainPlayer) {
      socketManager.emit("playedWalkingAnimation", { rotation: legRotation });
    }
  }

  equipWeapon(weaponId) {
    const weapon = Constants.WEAPON_ID_MAP[weaponId] ?? Constants.WEAPON_ID_MAP[2];
    this.currentWeapon = weapon;
    const idleAnim = weapon.name + '_idle';
    this.body._defaultAnim = idleAnim;
    this.body.isShootingAnimation = false;
    this.body.setAnimation(idleAnim);
    if (weapon.hasPickup) {
      soundManager.play(weapon.name + '_pickup');
    }
  }

  shoot() {
    const weapon = this.currentWeapon;
    const shootSounds = weapon.shootSounds ?? [weapon.name + '_shoot'];
    soundManager.playRandom(shootSounds);
    this.canShoot = false;
    setTimeout(() => { this.canShoot = true; }, weapon.fireCooldown);
    const shootAnim = weapon.shootAnims[Math.floor(Math.random() * weapon.shootAnims.length)];
    this.body.isShootingAnimation = true;
    this.body.setAnimation(shootAnim, 1);
    if (weapon.shootParticle && particleAtlas.ready) {
      const particleAnim = particleAtlas.animationMap[weapon.shootParticle];
      const pOff = particleAnim?.offset || [0, 0];
      this.muzzleFlashPinned = particleAnim?.pinned || false;
      this.muzzleFlash.setAnimation(weapon.shootParticle, 1);
      if (this.muzzleFlashPinned) {
        // Bake offset into world position now so the particle stays put.
        const r = this.body.rotation;
        const wx = this.body.x + pOff[0] * Math.cos(r) - pOff[1] * Math.sin(r);
        const wy = this.body.y + pOff[0] * Math.sin(r) + pOff[1] * Math.cos(r);
        this.muzzleFlash.setPosition(wx, wy);
      } else {
        this.muzzleFlash.setPosition(this.body.x, this.body.y);
      }
      this.muzzleFlash.isVisible = true;
    }
    if (this.isMainPlayer) socketManager.emit('playedShoot');
  }

  death() {
    this.health = 0;
    this.isRespawning = true;
    this.canShoot = false;
    this.canMove = false;

    soundManager.playRandom(Constants.DEATH_SOUNDS);

    // Reset to fist.
    this.equipWeapon(0);

    // Pick a random death animation.
    const animName = 'death_' + Math.floor(Math.random() * 8);
    this.body.isShootingAnimation = false;
    this.body.setAnimation('fist_idle');
    this.body.isVisible = false;
    this.legs.isVisible = false;
    this.deathBody.setPosition(this.body.x, this.body.y);
    this.deathBody.setAnimation(animName, 1);
    this.deathBody.isVisible = true;
  }

  respawn() {
    const pts = (typeof map !== 'undefined' && map.ready && map.spawnPoints.length)
      ? map.spawnPoints
      : [{ x: 400, y: 300 }];
    const { x, y } = pts[Math.floor(Math.random() * pts.length)];

    this.body.setPosition(x, y);

    socketManager.emit("playerRespawn", { position: { x, y } });
  }

  // Called on round start — resets the player to a spawn point regardless of death state.
  forceRespawn(spawnPoints = []) {
    const pts = spawnPoints.length ? spawnPoints : [{ x: 400, y: 300 }];
    const { x, y } = pts[Math.floor(Math.random() * pts.length)];

    this.health = 100;
    this.isRespawning = false;
    this.canShoot = true;
    this.canMove = true;
    this.deathBody.isVisible = false;
    this.body.isVisible = true;
    this.body.isShootingAnimation = false;
    this.equipWeapon(0);
    this.body.setPosition(x, y);

    if (this.isMainPlayer) {
      this.healthbarHeart.setAnimation('heartbeat_healthy');
      socketManager.emit("playerRespawn", { position: { x, y } });
    }
  }

  showHitsplat(damage, attackerWeaponId) {
    const attackerWeapon = Constants.WEAPON_ID_MAP[attackerWeaponId];
    const impactKey = attackerWeapon?.impactSound ?? 'impact';
    soundManager.play(impactKey);
    const anims = this.currentWeapon.bloodAnims;
    const anim = anims[Math.floor(Math.random() * anims.length)];
    this.hitsplat.setAnimation(anim, 1);
    this.hitsplat.setPosition(this.body.x, this.body.y);
    this.hitsplat.isVisible = true;
    this.health -= (damage ?? this.currentWeapon.damage);

    if (this.isMainPlayer) {
      const targetAnim = this.health >= 75 ? 'heartbeat_healthy'
                       : this.health >  20 ? 'heartbeat_impacted'
                                           : 'heartbeat_critical';
      if (this.healthbarHeart.animName !== targetAnim) {
        this.healthbarHeart.setAnimation(targetAnim);
      }
    }
  }

  update() {
    this.legs.update();
    this.body.update();
    this.hitsplat.update();
    this.muzzleFlash.update();
    if (this.muzzleFlash.isVisible && !this.muzzleFlashPinned) {
      this.muzzleFlash.setPosition(this.body.x, this.body.y);
    }
    if (this.isRespawning) {
      this.deathBody.update();
    }

    if (this.isMainPlayer) {
      this.healthbarHeart.update();
    }

    const currentPosition = this.getPosition();
    if (this.isPositionChanged(currentPosition) && this.isMainPlayer) {
      socketManager.emit("playerMovement", currentPosition);
      this.previousPosition = currentPosition;
    }
  }

  _drawIndicator(ctx) {
    // Hidden while dead.
    if (this.isRespawning) return;
    if (!indicatorAtlas.ready) return;

    const names = Object.keys(indicatorAtlas.animationMap);
    if (!names.length) return;
    const animName = names[this.indicatorShapeIndex % names.length];
    const anim = indicatorAtlas.getAnimation(animName);
    if (!anim || !anim.frames.length) return;

    // Rotary spinners (1 frame) spin via ctx.rotate().
    // Animated spinners (>1 frame) step through frames; no rotation needed.
    const now = Date.now();
    const isAnimated = anim.frames.length > 1;
    const frameIndex = isAnimated
      ? Math.floor((now / 1000) * anim.fps) % anim.frames.length
      : 0;

    const f = indicatorAtlas.getFrameData(animName, frameIndex);
    if (!f) return;

    const scale = 0.8;
    const dw = f.w * scale;
    const dh = f.h * scale;

    ctx.save();
    ctx.filter = `sepia(1) saturate(5) hue-rotate(${this.indicatorHue}deg)`;
    ctx.translate(this.body.x, this.body.y);
    if (!isAnimated) {
      ctx.rotate((now % 3000) / 3000 * Math.PI * 2);
    }
    ctx.drawImage(indicatorAtlas.image, f.x, f.y, f.w, f.h, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  draw(ctx) {
    // Indicator spinner drawn first (below everything).
    this._drawIndicator(ctx);
    // Legs are drawn first (behind body).
    if (!this.canMove) {
      this.legs.draw(ctx);
    }
    if (this.isRespawning) {
      this.deathBody.draw(ctx);
    } else {
      // Body rotates around the head pivot so the character aims correctly.
      this.body.drawWithHeadPivot(ctx);
    }
    this.hitsplat.drawCentered(ctx);
    const pOff = (!this.muzzleFlashPinned && this.currentWeapon.shootParticle && particleAtlas.animationMap[this.currentWeapon.shootParticle]?.offset) || [0, 0];
    this.muzzleFlash.drawCenteredRotated(ctx, this.muzzleFlashPinned ? 0 : this.body.rotation, pOff[0], pOff[1]);
    // Name tag above the player (hidden while dead).
    if (!this.isRespawning && this.name) {
      const x = this.body.x;
      const y = this.body.y;
      ctx.save();
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const padding = 3;
      const tw = ctx.measureText(this.name).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - tw / 2 - padding, y - 48 - 13, tw + padding * 2, 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.name, x, y - 48);
      ctx.restore();
    }
  }
}
