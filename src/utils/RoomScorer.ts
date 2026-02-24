// ============================================================================
// RoomScorer — Evaluate visible rooms for expansion potential
// ============================================================================
//
// Pure utility: no Screeps side-effects, fully unit-testable.
//
// PERSISTENT WORLD scoring formula:
//   Composite = (sourceCount * 40) - (swampRatio * 20) - (exitCount * 5)
//   Range: roughly -25 (terrible) to +80 (ideal 2-source low-swamp 1-exit room).
//
// SEASON MODE scoring formula (T2.3 — apex-rush mode):
//   Score resources accumulate as Level². A Level-5 room is worth 25× Level-1.
//   Seasonal formula: (level² * 20) - (swampRatio * 10) - (exitCount * 3)
//   Rooms with no controller (highways, SK) are scored 0.
//   Pass seasonMode=true to use this formula.
// ============================================================================

export interface RoomScore {
    roomName: string;
    sourceCount: number;    // 1 or 2
    swampRatio: number;     // 0.0 – 1.0 (fraction of non-wall tiles that are swamp)
    exitCount: number;      // number of exit directions (1–4)
    hasController: boolean;
    controllerLevel: number; // 0 if neutral/no controller
    score: number;          // composite score
}

/**
 * Score a visible room for expansion potential.
 * Returns null if the room is not visible (scout hasn't reported yet).
 *
 * @param roomName   Room to score
 * @param seasonMode T2.3 — if true, uses Level² formula for seasonal score resources
 */
export function scoreRoom(roomName: string, seasonMode = false): RoomScore | null {
    const room = Game.rooms[roomName];
    if (!room) return null;

    // ── Source count ──────────────────────────────────────────────────────
    const sources = room.find(FIND_SOURCES);
    const sourceCount = sources.length;

    // ── Swamp ratio ───────────────────────────────────────────────────────
    const terrain = room.getTerrain();
    let plainCount = 0;
    let swampCount = 0;
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const tile = terrain.get(x, y);
            if (tile === TERRAIN_MASK_SWAMP) swampCount++;
            else if (tile !== TERRAIN_MASK_WALL) plainCount++;
        }
    }
    const passable = plainCount + swampCount;
    const swampRatio = passable > 0 ? swampCount / passable : 0;

    // ── Exit count ────────────────────────────────────────────────────────
    const EXIT_DIRECTIONS: ExitConstant[] = [FIND_EXIT_TOP, FIND_EXIT_RIGHT, FIND_EXIT_BOTTOM, FIND_EXIT_LEFT];
    let exitCount = 0;
    for (const dir of EXIT_DIRECTIONS) {
        if (room.find(dir).length > 0) exitCount++;
    }

    const hasController = !!room.controller;
    const controllerLevel = room.controller?.level ?? 0;

    // ── Composite score ───────────────────────────────────────────────────
    let score: number;
    if (seasonMode) {
        // T2.3 — Season apex-rush: score resource value scales as Level².
        // No controller = no score resources = worthless for Season objectives.
        if (!hasController) {
            score = 0;
        } else {
            // Level 0 (neutral controller) still claimable — value is potential max Level.
            // Treat neutral as Level 5 potential (can reach max quickly when claimed first).
            const effectiveLevel = controllerLevel === 0 ? 5 : controllerLevel;
            score = Math.round(
                (effectiveLevel * effectiveLevel * 20) - (swampRatio * 10) - (exitCount * 3)
            );
        }
    } else {
        // Persistent world: source count dominates
        score = Math.round(
            (sourceCount * 40) - (swampRatio * 20) - (exitCount * 5)
        );
    }

    return { roomName, sourceCount, swampRatio, exitCount, hasController, controllerLevel, score };
}

/**
 * Score all provided room names that are currently visible.
 * Returns results sorted descending by score (best candidates first).
 *
 * @param roomNames  Rooms to evaluate
 * @param seasonMode Pass true to use seasonal Level² scoring
 */
export function rankRooms(roomNames: string[], seasonMode = false): RoomScore[] {
    return roomNames
        .map(n => scoreRoom(n, seasonMode))
        .filter((s): s is RoomScore => s !== null)
        .sort((a, b) => b.score - a.score);
}
