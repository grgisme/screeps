/**
 * DistanceTransform — Two-pass Chebyshev distance transform on a 50×50 grid.
 *
 * For every walkable tile in a room, computes the distance to the nearest
 * wall or room exit (border tile). This is used by the RoomPlanner to find
 * the largest open area for bunker placement.
 *
 * Algorithm:
 *   Pass 1 (top-left → bottom-right):
 *     d[x][y] = min(d[x-1][y-1], d[x][y-1], d[x+1][y-1], d[x-1][y]) + 1
 *   Pass 2 (bottom-right → top-left):
 *     d[x][y] = min(current, d[x+1][y+1], d[x][y+1], d[x-1][y+1], d[x+1][y]) + 1
 *
 * Walls and border tiles (exits) have distance 0.
 *
 * Results are cached in volatile heap per room (lost on global reset).
 */

// ─── CACHE ─────────────────────────────────────────────────────────

const _dtCache: Map<string, { grid: Uint8Array, tick: number }> = new Map();
const DT_TTL = 5000; // Terrain doesn't change — cache for a long time

// ─── PUBLIC API ────────────────────────────────────────────────────

/**
 * Get the distance transform grid for a room.
 * Returns a flat Uint8Array[2500] indexed as grid[y * 50 + x].
 *
 * Cost: ~0.5 CPU on first call, then cached.
 */
export function getDistanceTransform(roomName: string): Uint8Array {
    const cached = _dtCache.get(roomName);
    if (cached && Game.time - cached.tick < DT_TTL) {
        return cached.grid;
    }

    const grid = computeDistanceTransform(roomName);
    _dtCache.set(roomName, { grid, tick: Game.time });
    return grid;
}

/**
 * Get the distance value at a specific position.
 */
export function getDistanceAt(roomName: string, x: number, y: number): number {
    const grid = getDistanceTransform(roomName);
    return grid[y * 50 + x];
}

/**
 * Find the position with the maximum distance (center of largest open area).
 * Optionally tie-break by proximity to a reference position.
 */
export function findMaxDistance(
    roomName: string,
    tiebreakPos?: RoomPosition,
): { x: number, y: number, distance: number } {
    const grid = getDistanceTransform(roomName);
    let bestX = 25, bestY = 25, bestDist = 0;
    let bestTiebreak = Infinity;

    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const dist = grid[y * 50 + x];
            if (dist > bestDist) {
                bestDist = dist;
                bestX = x;
                bestY = y;
                if (tiebreakPos) {
                    bestTiebreak = Math.max(
                        Math.abs(x - tiebreakPos.x),
                        Math.abs(y - tiebreakPos.y),
                    );
                }
            } else if (dist === bestDist && tiebreakPos) {
                const tb = Math.max(
                    Math.abs(x - tiebreakPos.x),
                    Math.abs(y - tiebreakPos.y),
                );
                if (tb < bestTiebreak) {
                    bestTiebreak = tb;
                    bestX = x;
                    bestY = y;
                }
            }
        }
    }

    return { x: bestX, y: bestY, distance: bestDist };
}

// ─── ALGORITHM ─────────────────────────────────────────────────────

function computeDistanceTransform(roomName: string): Uint8Array {
    const terrain = Game.map.getRoomTerrain(roomName);
    const grid = new Uint8Array(2500); // 50×50, initialized to 0

    // Initialize: walkable interior tiles start at 255, walls/borders at 0
    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const isWall = terrain.get(x, y) === TERRAIN_MASK_WALL;
            const isBorder = x === 0 || x === 49 || y === 0 || y === 49;
            grid[y * 50 + x] = (isWall || isBorder) ? 0 : 255;
        }
    }

    // Pass 1: Top-left to bottom-right
    for (let y = 1; y < 49; y++) {
        for (let x = 1; x < 49; x++) {
            const idx = y * 50 + x;
            if (grid[idx] === 0) continue; // Wall

            const neighbors = [
                grid[(y - 1) * 50 + (x - 1)], // top-left
                grid[(y - 1) * 50 + x],        // top
                grid[(y - 1) * 50 + (x + 1)], // top-right
                grid[y * 50 + (x - 1)],        // left
            ];

            grid[idx] = Math.min(grid[idx], ...neighbors.map(n => n + 1));
        }
    }

    // Pass 2: Bottom-right to top-left
    for (let y = 48; y >= 1; y--) {
        for (let x = 48; x >= 1; x--) {
            const idx = y * 50 + x;
            if (grid[idx] === 0) continue; // Wall

            const neighbors = [
                grid[(y + 1) * 50 + (x + 1)], // bottom-right
                grid[(y + 1) * 50 + x],        // bottom
                grid[(y + 1) * 50 + (x - 1)], // bottom-left
                grid[y * 50 + (x + 1)],        // right
            ];

            grid[idx] = Math.min(grid[idx], ...neighbors.map(n => n + 1));
        }
    }

    return grid;
}

/**
 * Draw the distance transform as a RoomVisual heatmap.
 * Used by the RoomPlanner's visualize() command.
 */
export function drawDistanceTransformHeatmap(roomName: string): void {
    const grid = getDistanceTransform(roomName);
    const visual = new RoomVisual(roomName);

    // Find max for normalization
    let maxDist = 0;
    for (let i = 0; i < 2500; i++) {
        if (grid[i] > maxDist) maxDist = grid[i];
    }
    if (maxDist === 0) return;

    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const dist = grid[y * 50 + x];
            if (dist === 0) continue;

            const normalized = dist / maxDist;
            // Blue (cold/far) → Red (hot/close to wall)
            const r = Math.floor((1 - normalized) * 255);
            const g = 0;
            const b = Math.floor(normalized * 255);
            const color = `rgb(${r},${g},${b})`;

            visual.rect(x - 0.5, y - 0.5, 1, 1, {
                fill: color,
                opacity: 0.15 + normalized * 0.25,
            });

            // Show number on high-value tiles
            if (dist >= maxDist - 2) {
                visual.text(`${dist}`, x, y + 0.1, {
                    font: 0.35,
                    color: '#ffffff',
                    opacity: 0.8,
                });
            }
        }
    }
}
