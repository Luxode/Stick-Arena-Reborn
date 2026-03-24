class Physics {
  static isCircleCollidingRect(circle, rect, radius = Constants.STICK_FIGURE_HEAD_RADIUS) {
    const corner1 = rect.topLeft;
    const corner2 = rect.topRight;
    const corner3 = rect.bottomLeft;
    const corner4 = rect.bottomRight;

    const distance1 = this.distanceToLine(circle, corner1, corner2);
    const distance2 = this.distanceToLine(circle, corner2, corner3);
    const distance3 = this.distanceToLine(circle, corner3, corner4);
    const distance4 = this.distanceToLine(circle, corner4, corner1);

    if (distance1 <= radius || distance2 <= radius || distance3 <= radius || distance4 <= radius) {
      return true;
    }

    return false;
  }

  static distanceToLine(point, linePoint1, linePoint2) {
    const lineLength = this.distance(linePoint1, linePoint2);
    const numerator = Math.abs((linePoint2.y - linePoint1.y) * point.x - (linePoint2.x - linePoint1.x) * point.y + linePoint2.x * linePoint1.y - linePoint2.y * linePoint1.x);
    return numerator / lineLength;
  }

  static distance(point1, point2) {
    return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
  }

  // https://stackoverflow.com/a/22428650
  static rotatePoint(playerX, playerY, otherX, otherY, rotation) {
    const dx = otherX - playerX;
    const dy = otherY - playerY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const otherPointAngle = Math.atan2(dy, dx);
    const screenX = playerX + length * Math.cos(otherPointAngle + rotation);
    const screenY = playerY + length * Math.sin(otherPointAngle + rotation);

    return ({
      x: screenX,
      y: screenY
    });
  }

  // Returns true if the player's sub-tile position (localX, localY within the
  // 50×50 tile) is inside the tile's blocked walk zone, accounting for rotation.
  static isTileWalkBlocked(tile, localX, localY) {
    const { c, r, f = 0 } = tile;
    if (c <= 2) return false;
    if (c === 3 || c === 4) return true;

    // Partial collision (c=5–9): un-rotate then un-flip to reach the canonical
    // (R=0, F=0) frame. Rotation is applied first in rendering (ctx.rotate),
    // then flip is applied in the rotated coordinate system (ctx.scale).
    // So we undo rotation FIRST to get back to unrotated space, then undo flip.
    //
    // Rendering uses ctx.rotate(r * π/2), which in Y-down canvas is visually CW:
    //   r=1 → 90° CW on screen (top→right);  inverse: [lx,ly] = [ly, 50-lx]
    //   r=3 → 90° CCW on screen (top→left);  inverse: [lx,ly] = [50-ly, lx]
    let lx = localX, ly = localY;
    if      (r === 1) { [lx, ly] = [ly, 50 - lx]; }
    else if (r === 2) { [lx, ly] = [50 - lx, 50 - ly]; }
    else if (r === 3) { [lx, ly] = [50 - ly, lx]; }
    if (f === 1 || f === 3) lx = 50 - lx;  // undo horizontal flip
    if (f === 2 || f === 3) ly = 50 - ly;  // undo vertical flip

    switch (c) {
      case 5: return ly < 37.5;                           // top 3/4 blocked
      case 6: return ly < 25;                             // top half blocked
      case 7: return ly < 12.5;                           // top 1/4 blocked
      case 8: return lx < 25 && ly < 25;                  // top-left corner blocked
      case 9: return ly < 25 || (lx < 25 && ly >= 25);   // top half + bottom-left blocked
      default: return false;
    }
  }

  // Ray hit: checks if targetPos centre is within 'radius' pixels of the ray
  // fired from 'origin' in direction 'rotation' (radians), up to 'maxRange'.
  static isRayHit(origin, targetPos, rotation, maxRange, radius = Constants.STICK_FIGURE_HEAD_RADIUS) {
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const fwdX = Math.cos(rotation);
    const fwdY = Math.sin(rotation);
    const t = dx * fwdX + dy * fwdY;           // scalar projection onto ray
    const perp = Math.abs(dx * fwdY - dy * fwdX); // perpendicular distance
    return t >= 0 && t <= maxRange && perp <= radius;
  }

  // Circle hit: checks if targetPos is within maxRange of origin (direction-independent).
  static isCircleHit(origin, targetPos, maxRange) {
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    return Math.sqrt(dx * dx + dy * dy) <= maxRange;
  }

  // Cone hit: checks if targetPos is within 'maxRange' AND within half of
  // 'spreadAngle' (degrees) either side of 'rotation' (radians).
  static isConeHit(origin, targetPos, rotation, maxRange, spreadAngle) {
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxRange) return false;
    let angleDiff = Math.atan2(dy, dx) - rotation;
    // Normalise to [-π, π]
    angleDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
    return Math.abs(angleDiff) <= (spreadAngle * Math.PI / 180) / 2;
  }

  static checkForObstacles(playerPos, targetPlayerPos) {
    // Calculate distance between players
    const xDistance = targetPlayerPos.x - playerPos.x;
    const yDistance = targetPlayerPos.y - playerPos.y;
    const totalDistance = Math.sqrt(xDistance ** 2 + yDistance ** 2);

    // Calculate number of tiles between players
    const numTiles = totalDistance / 50;

    // Calculate x and y increments for each tile
    const xIncrement = xDistance / numTiles;
    const yIncrement = yDistance / numTiles;

    // Initialize variables for loop
    let currentX = playerPos.x;
    let currentY = playerPos.y;

    // Iterate through tiles between players
    for (let i = 0; i < numTiles; i++) {
      // Convert current position to tile index
      const tileX = Math.floor(currentX / 50);
      const tileY = Math.floor(currentY / 50);
      const mapWidth = (typeof map !== 'undefined' && map.ready) ? map.width : 35;
      const tileIndex = tileX + tileY * mapWidth;

      // Check if tile is an obstacle (only c=3 blocks bullets)
      const tile = obstacleGrid[tileIndex];
      if (obstacleGrid.length && tile && tile.c === 3) {
        return true;
      }

      // Update current position
      currentX += xIncrement;
      currentY += yIncrement;
    }

    return false;
  }
}