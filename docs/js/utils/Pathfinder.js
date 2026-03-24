/**
 * A* pathfinding implementation for navigating bots across the map.
 * Works with the tile grid system where tiles are 50x50 pixels.
 * Prefers fully walkable tiles to minimize getting stuck on obstacles.
 */
class Pathfinder {
  /**
   * Find a path from start to goal position using A* algorithm.
   * @param {Object} start - {x, y} world position
   * @param {Object} goal - {x, y} world position
   * @param {Object} map - Map object with width, height, and collision data
   * @param {Array} obstacleGrid - Collision grid from map
   * @returns {Array} Array of waypoint objects [{x, y}, ...] or null if unreachable
   */
  static findPath(start, goal, map, obstacleGrid) {
    if (!map || !obstacleGrid || obstacleGrid.length === 0) {
      return null;
    }

    // Convert world positions to tile grid positions
    const startTile = Pathfinder._worldToTile(start);
    const goalTile = Pathfinder._worldToTile(goal);

    // Clamp to valid map bounds
    if (!Pathfinder._isValidTile(startTile, map)) {
      return null;
    }
    if (!Pathfinder._isValidTile(goalTile, map)) {
      return null;
    }

    // If start and goal are the same tile, return direct path
    if (startTile.x === goalTile.x && startTile.y === goalTile.y) {
      return [goal];
    }

    // A* search
    const openSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = `${startTile.x},${startTile.y}`;
    const goalKey = `${goalTile.x},${goalTile.y}`;

    openSet.add(startKey);
    gScore.set(startKey, 0);
    fScore.set(startKey, Pathfinder._heuristic(startTile, goalTile));

    while (openSet.size > 0) {
      // Find node in openSet with lowest fScore
      let current = null;
      let lowestF = Infinity;
      for (const key of openSet) {
        const f = fScore.get(key) || Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = key;
        }
      }

      if (current === goalKey) {
        // Path found - reconstruct it
        return Pathfinder._reconstructPath(cameFrom, current, map);
      }

      openSet.delete(current);
      const [curX, curY] = current.split(',').map(Number);

      // Check all 8 neighbors (including diagonals)
      const neighbors = Pathfinder._getNeighbors(curX, curY, map, obstacleGrid);
      for (const { x: nx, y: ny, cost } of neighbors) {
        const neighborKey = `${nx},${ny}`;
        const tentativeG = (gScore.get(current) || 0) + cost;

        if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeG);
          fScore.set(neighborKey, tentativeG + Pathfinder._heuristic({ x: nx, y: ny }, goalTile));

          if (!openSet.has(neighborKey)) {
            openSet.add(neighborKey);
          }
        }
      }

      // Safety limit to prevent infinite loops
      if (gScore.size > 2000) {
        return null;
      }
    }

    // No path found
    return null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  static _worldToTile(worldPos) {
    return {
      x: Math.floor(worldPos.x / 50),
      y: Math.floor(worldPos.y / 50)
    };
  }

  static _tileToWorld(tile) {
    return {
      x: tile.x * 50 + 25,
      y: tile.y * 50 + 25
    };
  }

  static _isValidTile(tile, map) {
    return tile.x >= 0 && tile.x < map.width && tile.y >= 0 && tile.y < map.height;
  }

  /**
   * Check if a tile is walkable.
   * Strongly prefer fully walkable tiles. Partial collisions allowed only as last resort.
   * @returns {Object|null} {x, y, cost} if walkable, null if blocked
   */
  static _getTileCost(x, y, map, obstacleGrid) {
    if (!Pathfinder._isValidTile({ x, y }, map)) {
      return null;
    }

    const tileIndex = y * map.width + x;
    const tile = obstacleGrid[tileIndex];

    if (!tile) {
      // No collision data = fully walkable
      return { x, y, cost: 1 };
    }

    const { c } = tile;

    // Collision type 0-2: fully walkable
    if (c <= 2) {
      return { x, y, cost: 1 };
    }

    // Collision type 3, 4: not walkable
    if (c >= 3 && c <= 4) {
      return null;
    }

    // Collision type 5-9: partially blocked
    // Check if the tile CENTER (25, 25) is actually walkable
    if (c >= 5 && c <= 9) {
      if (typeof Physics !== 'undefined' && Physics.isTileWalkBlocked(tile, 25, 25)) {
        // Center is blocked; this tile cannot be walked through
        return null;
      }
      // Center is walkable but with extreme penalty; only used as absolute last resort
      return { x, y, cost: 25 };
    }

    return { x, y, cost: 1 };
  }

  /**
   * Get valid neighbor tiles (8-directional, preferring clear paths).
   * @returns {Array} Array of {x, y, cost} objects
   */
  static _getNeighbors(x, y, map, obstacleGrid) {
    const neighbors = [];

    // 4-directional (cardinal): cost 1
    const cardinal = [
      { x: x + 1, y }, { x: x - 1, y },
      { x, y: y + 1 }, { x, y: y - 1 }
    ];

    // 4-directional (diagonal): cost 1.4 (sqrt(2))
    const diagonal = [
      { x: x + 1, y: y + 1 }, { x: x + 1, y: y - 1 },
      { x: x - 1, y: y + 1 }, { x: x - 1, y: y - 1 }
    ];

    // Check cardinal neighbors first (prefer axis-aligned movement)
    for (const pos of cardinal) {
      const result = Pathfinder._getTileCost(pos.x, pos.y, map, obstacleGrid);
      if (result) {
        neighbors.push(result);
      }
    }

    // Check diagonals (only if both adjacent tiles are walkable)
    for (const pos of diagonal) {
      // Check the two cardinal neighbors this diagonal would cross
      const adj1 = Pathfinder._getTileCost(pos.x - (pos.x - x), pos.y, map, obstacleGrid);
      const adj2 = Pathfinder._getTileCost(pos.x, pos.y - (pos.y - y), map, obstacleGrid);

      if (adj1 && adj2) {
        const result = Pathfinder._getTileCost(pos.x, pos.y, map, obstacleGrid);
        if (result) {
          result.cost = result.cost * 1.4; // diagonal multiplier
          neighbors.push(result);
        }
      }
    }

    return neighbors;
  }

  /**
   * Manhattan distance heuristic.
   */
  static _heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * Reconstruct the path from start to goal using the cameFrom map.
   */
  static _reconstructPath(cameFrom, current, map) {
    const path = [];
    let curr = current;

    while (cameFrom.has(curr)) {
      const [x, y] = curr.split(',').map(Number);
      path.unshift(Pathfinder._tileToWorld({ x, y }));
      curr = cameFrom.get(curr);
    }

    // Add the starting tile
    const [startX, startY] = curr.split(',').map(Number);
    path.unshift(Pathfinder._tileToWorld({ x: startX, y: startY }));

    return path;
  }

  /**
   * Simplify a path by removing waypoints that can be reached directly.
   * This reduces the number of target points the bot needs to visit.
   */
  static simplifyPath(path, obstacleGrid, map) {
    if (path.length <= 2) return path;

    const simplified = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      let furthest = current + 1;

      // Find the furthest point we can reach directly
      for (let i = current + 2; i < path.length; i++) {
        if (!Physics.checkForObstacles(path[current], path[i])) {
          furthest = i;
        }
      }

      simplified.push(path[furthest]);
      current = furthest;
    }

    return simplified;
  }
}
