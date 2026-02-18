// ============================================================================
// Algorithms — Pathfinding and Spatial Analysis Utilities
// ============================================================================

/**
 * Calculates the Chebyshev Distance Transform for a given room.
 * The Distance Transform assigns each cell in the CostMatrix the distance
 * to the nearest wall (value 0). This is used by the room planner to find
 * optimal anchor positions for base stamps.
 *
 * Implementation notes (V8 / Screeps optimizations):
 *
 * 1. **Loop order:** Outer = y (rows), Inner = x (columns). This is
 *    critical for Chebyshev correctness. In the forward pass we check
 *    the Top-Right neighbor (x+1, y-1). Because y is the outer loop,
 *    row y-1 has already been fully processed, so column x+1 at row y-1
 *    is valid. With x-outer / y-inner loops, column x+1 at row y-1
 *    would NOT yet be processed, breaking diagonal wall propagation.
 *
 * 2. **Exit masking:** Room exits (x=0, x=49, y=0, y=49) are forced to 0
 *    regardless of terrain. Without this, the base planner can stamp
 *    structures directly on exits, trapping creeps.
 *
 * 3. **Direct _bits access:** CostMatrix.get()/set() perform bounds
 *    checking on every call. Over 2,500+ iterations per pass, this is
 *    measurable CPU waste. We bypass it by accessing the internal
 *    Uint8Array `_bits` directly. Index = x * 50 + y.
 *
 * @param roomName     The name of the room to analyze.
 * @param initialMatrix Optional CostMatrix to start with. If not provided,
 *                      one is created from Terrain (0 = Wall, 255 = Open).
 * @returns A CostMatrix where each tile's value is its Chebyshev distance
 *          to the nearest wall.
 */
export function distanceTransform(roomName: string, initialMatrix?: CostMatrix): CostMatrix {
    const terrain = Game.map.getRoomTerrain(roomName);
    const cm = initialMatrix || new PathFinder.CostMatrix();

    // Direct access to the internal Uint8Array — bypasses bounds checking.
    // In Screeps, CostMatrix stores values in a 2500-element Uint8Array
    // indexed by (x * 50 + y).
    const bits = (cm as any)._bits as Uint8Array;

    // --- 1. Initialization ---
    // Walls → 0, walkable → 255.
    // Room exits (border tiles) are forced to 0 to prevent structural
    // placement on exits.
    if (!initialMatrix) {
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                const idx = x * 50 + y;
                if (x === 0 || x === 49 || y === 0 || y === 49 ||
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    bits[idx] = 0;
                } else {
                    bits[idx] = 255;
                }
            }
        }
    }

    // --- 2. Forward Pass (Top-Left → Bottom-Right) ---
    // Outer = y, Inner = x. Checks 4 previously-visited Chebyshev neighbors:
    //   TL  T  TR     (row y-1, fully processed)
    //   L   C         (row y, columns < x already processed)
    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const idx = x * 50 + y;
            const val = bits[idx];
            if (val === 0) continue; // Wall — distance is already 0

            let min = 255;

            // Top (x, y-1)
            if (y > 0) min = Math.min(min, bits[idx - 1]);
            // Left (x-1, y)
            if (x > 0) min = Math.min(min, bits[idx - 50]);
            // Top-Left (x-1, y-1)
            if (x > 0 && y > 0) min = Math.min(min, bits[idx - 51]);
            // Top-Right (x+1, y-1) — safe because row y-1 is fully processed
            if (x < 49 && y > 0) min = Math.min(min, bits[idx + 49]);

            if (min < 255) {
                bits[idx] = min + 1;
            }
        }
    }

    // --- 3. Backward Pass (Bottom-Right → Top-Left) ---
    // Checks 4 previously-visited neighbors in the reverse direction:
    //         C  R     (row y, columns > x already processed)
    //   BL  B  BR     (row y+1, fully processed)
    for (let y = 49; y >= 0; y--) {
        for (let x = 49; x >= 0; x--) {
            const idx = x * 50 + y;
            let val = bits[idx];
            if (val === 0) continue;

            let min = val;

            // Bottom (x, y+1)
            if (y < 49) min = Math.min(min, bits[idx + 1] + 1);
            // Right (x+1, y)
            if (x < 49) min = Math.min(min, bits[idx + 50] + 1);
            // Bottom-Right (x+1, y+1)
            if (x < 49 && y < 49) min = Math.min(min, bits[idx + 51] + 1);
            // Bottom-Left (x-1, y+1)
            if (x > 0 && y < 49) min = Math.min(min, bits[idx - 49] + 1);

            if (min < val) {
                bits[idx] = min;
            }
        }
    }

    return cm;
}
