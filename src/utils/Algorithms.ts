// ============================================================================
// Algorithms — Pathfinding and Spatial Analysis Utilities
// ============================================================================

/**
 * Calculates the Distance Transform for a given room.
 * The Distance Transform assigns each value in the CostMatrix the distance to the nearest "wall" (0).
 * 
 * @param roomName The name of the room to analyze.
 * @param initialMatrix Optional CostMatrix to start with. If not provided, one is created from Terrain.
 *                      (0 = Wall/Obstacle, 255 = Walkable)
 * @returns A CostMatrix where the value of each tile is the distance to the nearest wall.
 */
export function distanceTransform(roomName: string, initialMatrix?: CostMatrix): CostMatrix {
    const terrain = Game.map.getRoomTerrain(roomName);
    const cm = initialMatrix || new PathFinder.CostMatrix();

    // 1. Initialization: Set walls to 0, walkables to 255 (if not provided)
    if (!initialMatrix) {
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    cm.set(x, y, 0);
                } else {
                    cm.set(x, y, 255);
                }
            }
        }
    }

    // 2. Forward Pass (Top-Left -> Bottom-Right)
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const val = cm.get(x, y);
            if (val === 0) continue; // It's a wall

            let min = 255;
            // Check Top
            if (y > 0) min = Math.min(min, cm.get(x, y - 1));
            // Check Left
            if (x > 0) min = Math.min(min, cm.get(x - 1, y));
            // Check Top-Left
            // if (x > 0 && y > 0) min = Math.min(min, cm.get(x - 1, y - 1)); // Octile approximation?
            // Determine metric: Manhattan (4-neighbors) or Chebyshev (8-neighbors)?
            // Screeps range is Chebyshev (diagonal = 1).
            // So we check all 4 previously visited neighbors for 8-way connectivity?
            // Actually, for Chebyshev distance, checking Top, Left, Top-Left, Top-Right is needed?
            // Forward pass:
            //   TL T TR
            //   L  C
            // We have visited TL, T, TR (in previous row) and L (in current row).

            if (y > 0) {
                min = Math.min(min, cm.get(x, y - 1)); // Top
                if (x > 0) min = Math.min(min, cm.get(x - 1, y - 1)); // Top-Left
                if (x < 49) min = Math.min(min, cm.get(x + 1, y - 1)); // Top-Right (already visited row y-1)
            }
            if (x > 0) min = Math.min(min, cm.get(x - 1, y)); // Left

            if (min < 255) {
                cm.set(x, y, min + 1);
            }
        }
    }

    // 3. Backward Pass (Bottom-Right -> Top-Left)
    for (let x = 49; x >= 0; x--) {
        for (let y = 49; y >= 0; y--) {
            let val = cm.get(x, y);
            if (val === 0) continue;

            let min = val;

            // Neighbors: Bottom, Right, Bottom-Right, Bottom-Left
            if (y < 49) {
                min = Math.min(min, cm.get(x, y + 1) + 1); // Bottom
                if (x < 49) min = Math.min(min, cm.get(x + 1, y + 1) + 1); // Bottom-Right
                if (x > 0) min = Math.min(min, cm.get(x - 1, y + 1) + 1); // Bottom-Left
            }
            if (x < 49) min = Math.min(min, cm.get(x + 1, y) + 1); // Right

            if (min < val) {
                cm.set(x, y, min);
            }
        }
    }

    return cm;
}
