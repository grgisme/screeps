// ============================================================================
// RoomScorer — Evaluate visible rooms for expansion potential
// ============================================================================
//
// Pure utility: no Screeps side-effects, fully unit-testable.
// Scoring formula weights source count heavily (2-source rooms are ~2× more
// productive), penalises high swamp density (slower haul routes) and many
// exits (more attack vectors to defend).
//
// Composite score = (sourceCount * 40) - (swampRatio * 20) - (exitCount * 5)
// Range: roughly -25 (terrible) to +80 (ideal 2-source low-swamp 1-exit room).
// ============================================================================

export interface RoomScore {
    roomName: string;
    sourceCount: number;    // 1 or 2
    swampRatio: number;     // 0.0 – 1.0 (fraction of non-wall tiles that are swamp)
    exitCount: number;      // number of exit directions (1–4)
    hasController: boolean;
    score: number;          // composite score
}

/**
 * Score a visible room for expansion potential.
 * Returns null if the room is not visible (scout hasn't reported yet).
 */
export function scoreRoom(roomName: string): RoomScore | null {
    const room = Game.rooms[roomName];
    if (!room) return null;

    // ── Source count ──────────────────────────────────────────────────────
    const sources = room.find(FIND_SOURCES);
    const sourceCount = sources.length;

    // ── Swamp ratio ───────────────────────────────────────────────────────
    // Sample the room terrain to estimate swamp density.
    // Only count non-wall tiles (walls are impassable and irrelevant).
    const terrain = room.getTerrain();
    let plainCount = 0;
    let swampCount = 0;
    let wallCount = 0;
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const tile = terrain.get(x, y);
            if (tile === TERRAIN_MASK_WALL) {
                wallCount++;
            } else if (tile === TERRAIN_MASK_SWAMP) {
                swampCount++;
            } else {
                plainCount++;
            }
        }
    }
    const passable = plainCount + swampCount;
    const swampRatio = passable > 0 ? swampCount / passable : 0;

    // ── Exit count ────────────────────────────────────────────────────────
    // Each exit direction with at least one exit tile is counted.
    const EXIT_DIRECTIONS: ExitConstant[] = [FIND_EXIT_TOP, FIND_EXIT_RIGHT, FIND_EXIT_BOTTOM, FIND_EXIT_LEFT];
    let exitCount = 0;
    for (const dir of EXIT_DIRECTIONS) {
        if (room.find(dir).length > 0) exitCount++;
    }

    const hasController = !!room.controller;

    // ── Composite score ───────────────────────────────────────────────────
    const score = Math.round(
        (sourceCount * 40) - (swampRatio * 20) - (exitCount * 5)
    );

    return { roomName, sourceCount, swampRatio, exitCount, hasController, score };
}

/**
 * Score all provided room names that are currently visible.
 * Returns results sorted descending by score (best candidates first).
 */
export function rankRooms(roomNames: string[]): RoomScore[] {
    return roomNames
        .map(n => scoreRoom(n))
        .filter((s): s is RoomScore => s !== null)
        .sort((a, b) => b.score - a.score);
}
