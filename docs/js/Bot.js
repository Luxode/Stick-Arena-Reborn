// Individual bot AI. Wraps a Player instance and drives it with a simple state machine.
// Bots are only active in offline / no-real-players mode; BotManager handles lifecycle.
//
// Behaviour summary:
//   • Melee weapons (fist, bat, chainsaw, katana, laser_sword, sledgehammer)
//       → charge at the target with added aim wobble; attack with a small reaction delay.
//   • Ranged weapons (glock, shotgun, ak47, chaingun, flamethrower, railgun, tesla_helmet)
//       → orbit at ~65 % of max range, back away if too close, fire when roughly lined up.
//   • No target visible → wander to a nearby pickup (chosen with some randomness).
//   • Reaction delay: bots take 0.3–0.9 s to "notice" a newly spotted target.
//   • Aim wobble: aiming adds per-bot noise that slowly drifts over time.
//   • Anti-stuck: if movement stalls, pick a random escape direction for 1 s.

class Bot {
  // Weapon IDs in weapons.json that are melee (aggressive close-range behaviour).
  static MELEE_IDS = new Set([0, 1, 6, 8, 9, 11]);

  /**
   * @param {string} id         Unique key used in playerManager (e.g. 'bot_0').
   * @param {number} x          Spawn world-x.
   * @param {number} y          Spawn world-y.
   * @param {number} nameIndex  Index into BotManager.BOT_NAMES.
   */
  constructor(id, x, y, nameIndex = 0) {
    this.id = id;

    // Create and register the visual Player entity.
    this.player = new Player(x, y);
    this.player.name = '[BOT] ' + BotManager.BOT_NAMES[nameIndex % BotManager.BOT_NAMES.length];
    // Randomize spinner appearance
    this.player.indicatorHue        = Math.floor(Math.random() * 360);
    this.player.indicatorShapeIndex = Math.floor(Math.random() * 64);

    // Local kill/death counters (displayed on the offline scoreboard).
    this.kills  = 0;
    this.deaths = 0;

    // Set to true when bot.player.death() is called; cleared once the death
    // animation finishes (isRespawning flips back to false).
    this.respawnPending = false;

    // ── Imperfection state ───────────────────────────────────────────────────

    // Reaction delay: seconds the bot must "notice" a target before acting.
    // Randomised per spawn so each bot feels different.
    this._reactionTime  = 0.35 + Math.random() * 0.55;  // 0.35–0.90 s
    this._reactionTimer = 0;   // counts up while target is visible
    this._hasReacted    = false;

    // Aim wobble: a slowly-drifting angular offset added to facing angle.
    this._aimWobble      = 0;          // current offset in radians
    this._aimWobbleSpeed = (Math.random() - 0.5) * 1.8;  // rad/s drift direction
    // Max wobble amplitude: melee bots wobble more (they're erratic),
    // ranged bots wobble less (they're more methodical).
    this._aimWobbleAmp   = 0;          // set after weapon is known

    // Occasional hesitation: bot briefly stops moving every few seconds.
    this._hesitateTimer    = 0;
    this._hesitateInterval = 2.5 + Math.random() * 3.5;  // 2.5–6 s
    this._hesitateDuration = 0;

    // Anti-stuck state.
    this._stuckTimer       = 0;
    this._stuckEscapeAngle = Math.random() * Math.PI * 2;
    this._lastPos          = { x, y };

    // Rotation state — bots turn at a limited speed so players can dodge.
    // Melee bots turn faster (aggressive), ranged bots turn slower (methodical).
    // Final value set after weapon is known in think(); seeded randomly here.
    this._currentAngle = Math.random() * Math.PI * 2;
    this._turnSpeed    = 0; // rad/s — set per-frame once weapon is known

    // ── Roaming state ────────────────────────────────────────────────────────

    // Path-following: waypoints the bot follows when roaming
    this._path            = [];      // Array of {x, y} waypoints
    this._pathIndex       = 0;       // Current waypoint index
    this._currentTarget   = null;    // Currently roaming to this spawn/weapon point
    this._pathRefreshTime = 0;       // Timestamp when path was last calculated

    // Roaming behavior: pick a random spawn or weapon spawn periodically
    this._roamInterval    = 8 + Math.random() * 12;  // 8–20 seconds
    this._roamTimer       = Math.random() * this._roamInterval; // start at random time

    // ── Target pursuit pathfinding (for melee) ──────────────────────────────

    // Path-following when pursuing a target (mainly melee bots)
    this._targetPath         = [];    // Array of {x, y} waypoints to reach target
    this._targetPathIndex    = 0;     // Current waypoint index
    this._targetPathRefreshInterval = 0.5; // Recalculate path every 0.5s to handle moving targets
    this._targetPathRefreshTimer    = 0;

    playerManager.addPlayer(id, this.player);
  }

  get isMelee() {
    return Bot.MELEE_IDS.has(this.player.currentWeapon?.id ?? 0);
  }

  // ── Main AI tick ────────────────────────────────────────────────────────────

  think(dt) {
    const p = this.player;

    // After the death animation finishes, teleport to a spawn point.
    if (this.respawnPending && !p.isRespawning) {
      this.respawnPending = false;
      this._doRespawn();
      return;
    }
    if (p.isRespawning) return;

    // Collect any pickup we're standing on.
    this._checkPickups();

    // Update aim wobble amplitude now that weapon is known.
    this._aimWobbleAmp = this.isMelee ? 0.45 : 0.18;

    // Turn speed: melee bots spin faster, ranged bots aim slower.
    // Add per-bot variance so they feel different from each other.
    this._turnSpeed = this.isMelee
      ? (2.8 + Math.random() * 1.2)   // 2.8–4.0 rad/s
      : (1.4 + Math.random() * 0.8);  // 1.4–2.2 rad/s

    // Drift the wobble angle, clamping within ±amp and bouncing direction.
    this._aimWobble += this._aimWobbleSpeed * dt;
    if (Math.abs(this._aimWobble) > this._aimWobbleAmp) {
      this._aimWobbleSpeed *= -1;
      this._aimWobble = Math.sign(this._aimWobble) * this._aimWobbleAmp;
    }

    // Tick hesitation.
    if (this._hesitateDuration > 0) {
      this._hesitateDuration -= dt;
    }
    this._hesitateTimer += dt;
    if (this._hesitateTimer >= this._hesitateInterval) {
      this._hesitateTimer    = 0;
      this._hesitateInterval = 2.5 + Math.random() * 3.5;
      this._hesitateDuration = 0.12 + Math.random() * 0.25;  // 0.12–0.37 s pause
    }
    const hesitating = this._hesitateDuration > 0;

    const myPos  = p.getPosition();
    const weapon = p.currentWeapon;
    const isUnarmed = (weapon?.id ?? 0) === 0; // Fist is weapon ID 0

    // Find nearest visible (line-of-sight) enemy.
    const rawTarget = this._findTarget(myPos);

    // Reaction delay: only act once the bot has "seen" the target long enough.
    if (rawTarget) {
      this._reactionTimer += dt;
      if (this._reactionTimer >= this._reactionTime) this._hasReacted = true;
    } else {
      // Target lost — reset so the next sighting requires a fresh reaction.
      this._reactionTimer = 0;
      this._hasReacted    = false;
    }
    const target = (rawTarget && this._hasReacted && !isUnarmed) ? rawTarget : null;

    if (target) {
      const tp   = target.getPosition();
      const dx   = tp.x - myPos.x;
      const dy   = tp.y - myPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRange = weapon?.hitShape?.maxRange ?? 50;

      // Aim at target with wobble offset, turning at limited speed.
      const rawAngle = Math.atan2(dy, dx);
      const aimAngle = rawAngle + this._aimWobble;
      this._turnToward(aimAngle, dt);
      p.body.setRotation(this._currentAngle + (90 * Constants.TO_RADIANS));

      if (!hesitating) {
        if (this.isMelee) {
          // Use pathfinding to chase target, recalculating periodically to handle moving targets
          this._updateTargetPursuit(target, myPos, map);
          this._moveAlongTargetPath(dt);
        } else {
          // Ranged bot: focus on maintaining line of sight using pathfinding
          const hasLineOfSight = !Physics.checkForObstacles(myPos, tp);
          // Only retreat if target is dangerously close (within ~1/3 of weapon range + margin)
          // This keeps the bot from fleeing when target is still far away
          const minSafeDistance = hitRange * 0.35;  // Only retreat if closer than this
          const withinRetreatingDistance = dist < minSafeDistance;
          
          if (!hasLineOfSight) {
            // No line of sight - use pathfinding to move toward target to find a vantage point
            this._updateTargetPursuit(target, myPos, map);
            this._moveAlongTargetPath(dt);
          } else if (withinRetreatingDistance) {
            // Target is dangerously close - use pathfinding to back away
            // Maintain distance at ~50% of weapon range for safe firing distance
            const backAwayDist = hitRange * 0.5 + (Math.random() - 0.5) * 40;
            const backAwayPoint = {
              x: myPos.x - (dx / dist) * backAwayDist,
              y: myPos.y - (dy / dist) * backAwayDist
            };
            this._updateTargetRetreat(backAwayPoint, myPos, map);
            this._moveAlongTargetPath(dt);
          } else {
            // Target is at good distance: hold position and clear any retreat path
            this._targetPath = [];
            this._targetPathIndex = 0;
            this._targetPathRefreshTimer = 0;
          }
        }
      }

      // Fire only when within range, wobble is low, AND bot is actually facing the target
      // (turn lag means a spinning bot shouldn't shoot the moment it starts turning).
      const aimThreshold = this.isMelee ? this._aimWobbleAmp : this._aimWobbleAmp * 0.7;
      const wobbleOk  = Math.abs(this._aimWobble) < aimThreshold;
      const facingOk  = Math.abs(this._angleDiff(this._currentAngle, rawAngle)) < (this.isMelee ? 0.5 : 0.25);
      if (dist <= hitRange && p.canShoot && wobbleOk && facingOk) {
        this._tryShoot(target);
      }

      // Reset stuck timer while actively pursuing.
      this._stuckTimer = 0;
    } else {
      // No (reacted) target: roam using pathfinding to spawn points and weapon spawns.
      // Clear any existing target pursuit path
      this._targetPath = [];
      this._targetPathIndex = 0;
      this._targetPathRefreshTimer = 0;

      this._updateRoaming(dt, myPos, map, isUnarmed);
      
      const goal = this._currentTarget;
      if (goal && !hesitating) {
        this._moveTowardPath(dt);
        const dx2 = goal.x - myPos.x;
        const dy2 = goal.y - myPos.y;
        this._turnToward(Math.atan2(dy2, dx2), dt);
        p.body.setRotation(this._currentAngle + (90 * Constants.TO_RADIANS));
      }
    }

    this._handleStuck(dt, myPos);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Returns the nearest Player that has line-of-sight to this bot, or null. */
  _findTarget(myPos) {
    let nearest  = null;
    let bestDist = Infinity;

    // Human player.
    const main = playerManager.mainPlayer;
    if (main && !main.isRespawning) {
      const tp = main.getPosition();
      const d  = this._dist(myPos, tp);
      if (d < bestDist && !Physics.checkForObstacles(myPos, tp)) {
        bestDist = d;
        nearest  = main;
      }
    }

    // Other bots.
    const botPlayers = botManager.getBotPlayers();
    for (const [id, bp] of Object.entries(botPlayers)) {
      if (id === this.id || bp.isRespawning) continue;
      const tp = bp.getPosition();
      const d  = this._dist(myPos, tp);
      if (d < bestDist && !Physics.checkForObstacles(myPos, tp)) {
        bestDist = d;
        nearest  = bp;
      }
    }

    return nearest;
  }

  /**
   * Returns world-position of a nearby pickup to wander toward.
   * Instead of always picking the absolute nearest, the bot randomly chooses
   * from any pickup within 1.5× the nearest distance, adding some variety.
   */
  _wanderPickupPos(myPos) {
    const candidates = [];
    let minDist = Infinity;
    for (const pick of pickupManager.pickups) {
      if (!pick.isVisible || !pick.sprite) continue;
      const d = this._dist(myPos, { x: pick.sprite.x, y: pick.sprite.y });
      if (d < minDist) minDist = d;
      candidates.push({ x: pick.sprite.x, y: pick.sprite.y, d });
    }
    if (!candidates.length) return null;
    const nearby = candidates.filter(c => c.d <= minDist * 1.5);
    return nearby[Math.floor(Math.random() * nearby.length)];
  }

  /** Move toward (tx, ty) at the bot's current weapon walk-speed. */
  _moveTo(tx, ty, dt) {
    const myPos = this.player.getPosition();
    const dx    = tx - myPos.x;
    const dy    = ty - myPos.y;
    const dist  = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) return;

    const speed = Constants.SPEED * (this.player.currentWeapon?.walkSpeed ?? 1.0);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    this.player.move((dx / dist) * speed * dt, (dy / dist) * speed * dt, angle);
  }

  /** Fire the current weapon and apply damage to the target locally. */
  _tryShoot(target) {
    this.player.shoot();
    botManager._applyDamage(this, target);
  }

  /** Walk over pickups and collect them via the shared PickupManager pipeline. */
  _checkPickups() {
    const pos = this.player.getPosition();
    for (let i = 0; i < pickupManager.pickups.length; i++) {
      if (pickupManager.pickups[i].isPlayerOverlapping(pos.x, pos.y)) {
        pickupManager.takePickup(i, this.player, false);
      }
    }
  }

  /**
   * If the bot barely moved this frame, increment a stuck counter.
   * After 1 s of being stuck, randomise an escape direction and nudge toward it.
   */
  _handleStuck(dt, myPos) {
    const moved = this._dist(myPos, this._lastPos);
    this._lastPos = { x: myPos.x, y: myPos.y };

    if (moved < 1.5) {
      this._stuckTimer += dt;
      if (this._stuckTimer > 1.0) {
        this._stuckEscapeAngle = Math.random() * Math.PI * 2;
        this._stuckTimer = 0;
      }
      const speed = Constants.SPEED * 0.5;
      const a     = this._stuckEscapeAngle;
      this.player.move(
        Math.cos(a) * speed * dt,
        Math.sin(a) * speed * dt,
        a * (180 / Math.PI)
      );
    } else {
      this._stuckTimer = 0;
    }
  }

  /**
   * Update roaming state: periodically pick a new roaming target
   * (spawn point or weapon spawn) and calculate a path to it.
   * When unarmed, prioritize weapon spawns over player spawns.
   */
  _updateRoaming(dt, myPos, mapObj, isUnarmed = false) {
    this._roamTimer += dt;

    // Time to pick a new roaming destination?
    if (this._roamTimer >= this._roamInterval) {
      this._roamTimer = 0;
      this._roamInterval = 8 + Math.random() * 12; // 8–20 seconds

      // Gather all possible roaming targets
      const targets = [];
      const weaponTargets = [];

      // Add player spawn points
      if (mapObj && mapObj.spawnPoints) {
        targets.push(...mapObj.spawnPoints);
      }

      // Add weapon spawn points
      if (mapObj && mapObj.weaponSpawns) {
        // Only include weapons that are currently available (picked up = not visible)
        for (let i = 0; i < mapObj.weaponSpawns.length; i++) {
          const pickup = pickupManager?.pickups[i];
          // Check if this weapon pickup is available through pickupManager
          if (pickup && pickup.isVisible && pickup.sprite) {
            // Use the actual sprite position, not the spawn tile coordinates
            weaponTargets.push({ x: pickup.sprite.x, y: pickup.sprite.y });
          }
        }
        // If not unarmed, also add available weapons to general targets
        if (!isUnarmed) {
          targets.push(...weaponTargets);
        }
      }

      // When unarmed, prioritize weapon spawns; only fall back to player spawns if no weapons
      let availableTargets = targets;
      if (isUnarmed && weaponTargets.length > 0) {
        availableTargets = weaponTargets;
      }

      if (availableTargets.length > 0) {
        // Pick target: nearest if unarmed, random otherwise
        let selectedTarget = null;
        let pathFound = false;

        if (isUnarmed && weaponTargets.length > 0) {
          // For unarmed bots: find nearest weapon with a valid path
          const sortedWeapons = [...weaponTargets].sort((a, b) => this._dist(myPos, a) - this._dist(myPos, b));
          
          for (const weapon of sortedWeapons) {
            if (typeof Pathfinder !== 'undefined' && mapObj && obstacleGrid && obstacleGrid.length > 0) {
              const path = Pathfinder.findPath(myPos, weapon, mapObj, obstacleGrid);
              if (path && path.length > 0) {
                selectedTarget = weapon;
                this._path = path;
                this._pathIndex = 0;
                pathFound = true;
                break; // Found reachable weapon, use it
              }
            } else {
              // Pathfinder unavailable; use first weapon
              selectedTarget = weapon;
              pathFound = true;
              break;
            }
          }
          
          // If no reachable weapon found, fall back to player spawn points
          if (!selectedTarget && targets.length > 0) {
            selectedTarget = targets[Math.floor(Math.random() * targets.length)];
            pathFound = false; // Will use default pathfinding below
          }
        } else {
          // Armed bots: pick random target
          selectedTarget = availableTargets[Math.floor(Math.random() * availableTargets.length)];
          pathFound = false; // Will use default pathfinding below
        }

        if (selectedTarget) {
          this._currentTarget = selectedTarget;
          
          // If we haven't already found a path (for weapons), calculate one now
          if (!pathFound) {
            if (typeof Pathfinder !== 'undefined' && mapObj && obstacleGrid && obstacleGrid.length > 0) {
              const path = Pathfinder.findPath(myPos, this._currentTarget, mapObj, obstacleGrid);
              if (path && path.length > 0) {
                this._path = path;
                this._pathIndex = 0;
              } else {
                // No path found; skip this target and try again next interval
                this._roamTimer = this._roamInterval - 0.1;
              }
            } else {
              // Pathfinder not available; direct movement (last resort)
              this._path = [this._currentTarget];
              this._pathIndex = 0;
            }
          }
        }
      }
    }

    // If we're close to the current target, mark it as reached and pick a new one
    if (this._currentTarget) {
      const distToTarget = this._dist(myPos, this._currentTarget);
      if (distToTarget < 60) {
        // Reached target; force new roaming destination next update
        this._roamTimer = this._roamInterval - 0.1;
      }
    }
  }

  /**
   * Move along the current path waypoints using A* navigation.
   * Automatically advances to the next waypoint when close enough.
   */
  _moveTowardPath(dt) {
    const myPos = this.player.getPosition();

    // Skip invalid indices
    if (this._pathIndex >= this._path.length) {
      return;
    }

    const currentWaypoint = this._path[this._pathIndex];
    const distToWaypoint = this._dist(myPos, currentWaypoint);

    // If we're close to the waypoint, advance to the next one
    if (distToWaypoint < 30) {
      this._pathIndex++;
      if (this._pathIndex >= this._path.length) {
        // Path complete; will pick a new target next update
        return;
      }
    }

    // Move toward the current waypoint
    if (this._pathIndex < this._path.length) {
      const target = this._path[this._pathIndex];
      this._moveTo(target.x, target.y, dt);
    }
  }

  /**
   * Update pursuit path to target: periodically recalculate the path to the target's current position
   * using A* to navigate around obstacles. This is mainly used for melee bots.
   */
  _updateTargetPursuit(targetPlayer, myPos, mapObj) {
    this._targetPathRefreshTimer += 1 / 60; // Approximate dt (assuming 60 FPS)

    // Recalculate path periodically to handle moving targets
    if (this._targetPathRefreshTimer >= this._targetPathRefreshInterval) {
      this._targetPathRefreshTimer = 0;

      const targetPos = targetPlayer.getPosition();

      // Calculate a path using A*
      if (typeof Pathfinder !== 'undefined' && mapObj && obstacleGrid && obstacleGrid.length > 0) {
        const path = Pathfinder.findPath(myPos, targetPos, mapObj, obstacleGrid);
        if (path && path.length > 0) {
          this._targetPath = path;
          this._targetPathIndex = 0;
        } else {
          // No path found; resort to direct movement
          this._targetPath = [targetPos];
          this._targetPathIndex = 0;
        }
      } else {
        // Pathfinder not available; direct movement
        this._targetPath = [targetPos];
        this._targetPathIndex = 0;
      }
    }
  }

  /**
   * Move along the pursuit path toward target waypoint.
   * Advances to next waypoint when close enough.
   */
  _moveAlongTargetPath(dt) {
    const myPos = this.player.getPosition();

    // Skip if no path
    if (this._targetPathIndex >= this._targetPath.length) {
      return;
    }

    const currentWaypoint = this._targetPath[this._targetPathIndex];
    const distToWaypoint = this._dist(myPos, currentWaypoint);

    // If we're close to the waypoint, advance to the next one
    if (distToWaypoint < 30) {
      this._targetPathIndex++;
      if (this._targetPathIndex >= this._targetPath.length) {
        // Path complete; _updateTargetPursuit will recalculate
        return;
      }
    }

    // Move toward the current waypoint
    if (this._targetPathIndex < this._targetPath.length) {
      const target = this._targetPath[this._targetPathIndex];
      this._moveTo(target.x, target.y, dt);
    }
  }

  /**
   * Update retreat path to a destination point: calculates path using A* to navigate
   * around obstacles while retreating. Used by ranged bots when too close to enemies.
   */
  _updateTargetRetreat(retreatPoint, myPos, mapObj) {
    this._targetPathRefreshTimer += 1 / 60; // Approximate dt (assuming 60 FPS)

    // Recalculate path periodically to handle dynamic retreat
    if (this._targetPathRefreshTimer >= this._targetPathRefreshInterval) {
      this._targetPathRefreshTimer = 0;

      // Calculate a path using A*
      if (typeof Pathfinder !== 'undefined' && mapObj && obstacleGrid && obstacleGrid.length > 0) {
        const path = Pathfinder.findPath(myPos, retreatPoint, mapObj, obstacleGrid);
        if (path && path.length > 0) {
          this._targetPath = path;
          this._targetPathIndex = 0;
        } else {
          // No path found; resort to direct movement
          this._targetPath = [retreatPoint];
          this._targetPathIndex = 0;
        }
      } else {
        // Pathfinder not available; direct movement
        this._targetPath = [retreatPoint];
        this._targetPathIndex = 0;
      }
    }
  }

  /**
   * Called once the death animation completes (isRespawning → false).
   * The Player.death() animation handler already resets health / canShoot / visibility;
   * we only need to teleport the body to a new spawn point.
   */
  _doRespawn() {
    const pts = (typeof map !== 'undefined' && map.ready && map.spawnPoints.length)
      ? map.spawnPoints
      : [{ x: 400, y: 300 }];
    const sp = pts[Math.floor(Math.random() * pts.length)];
    this.player.body.setPosition(sp.x, sp.y);
    this.player.legs.setPosition(sp.x, sp.y);
  }

  _dist(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Signed shortest angular difference from `from` to `to`, in [-π, π]. */
  _angleDiff(from, to) {
    let d = to - from;
    d = ((d + Math.PI) % (2 * Math.PI)) - Math.PI;
    return d < -Math.PI ? d + 2 * Math.PI : d;
  }

  /** Rotate _currentAngle toward targetAngle at _turnSpeed rad/s. */
  _turnToward(targetAngle, dt) {
    const diff    = this._angleDiff(this._currentAngle, targetAngle);
    const maxStep = this._turnSpeed * dt;
    if (Math.abs(diff) <= maxStep) {
      this._currentAngle = targetAngle;
    } else {
      this._currentAngle += Math.sign(diff) * maxStep;
    }
    // Keep in [-π, π]
    this._currentAngle = ((this._currentAngle + Math.PI) % (2 * Math.PI)) - Math.PI;
  }

  /** Remove this bot's Player from the manager. */
  remove() {
    playerManager.removePlayer(this.id);
  }
}
