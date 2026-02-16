/**
 * BunkerStamp — Static layout template for automated base construction.
 *
 * Defines structure positions relative to an anchor point (0,0 = center).
 * Each entry includes {dx, dy, structureType, minRCL} so the planner
 * can progressively build structures as RCL increases.
 *
 * Layout: Diamond/cross pattern radiating from center spawn.
 * Total footprint: ~11×11 (fits within DT distance of 6+).
 *
 * The stamp is designed so that:
 *   - All extensions are within 3 tiles of a spawn (fast refilling)
 *   - Towers cover the entire room from central positions
 *   - Storage/terminal are adjacent to spawn for hauler efficiency
 *   - Roads form an internal grid for creep traffic
 */

// ─── TYPES ─────────────────────────────────────────────────────────

export interface StampEntry {
    /** Offset from anchor X */
    dx: number;
    /** Offset from anchor Y */
    dy: number;
    /** Structure type to build */
    structureType: BuildableStructureConstant;
    /** Minimum RCL required to build this */
    minRCL: number;
}

// ─── RCL STRUCTURE LIMITS ──────────────────────────────────────────

/** Max structures per RCL (from Screeps docs) */
export const STRUCTURE_LIMITS: { [type: string]: number[] } = {
    // Index = RCL (0-8), value = max count
    [STRUCTURE_SPAWN]: [0, 1, 1, 1, 1, 1, 1, 2, 3],
    [STRUCTURE_EXTENSION]: [0, 0, 5, 10, 20, 30, 40, 50, 60],
    [STRUCTURE_TOWER]: [0, 0, 0, 1, 1, 2, 2, 3, 6],
    [STRUCTURE_STORAGE]: [0, 0, 0, 0, 1, 1, 1, 1, 1],
    [STRUCTURE_LINK]: [0, 0, 0, 0, 0, 2, 3, 4, 6],
    [STRUCTURE_TERMINAL]: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    [STRUCTURE_LAB]: [0, 0, 0, 0, 0, 0, 3, 6, 10],
    [STRUCTURE_OBSERVER]: [0, 0, 0, 0, 0, 0, 0, 0, 1],
    [STRUCTURE_FACTORY]: [0, 0, 0, 0, 0, 0, 0, 1, 1],
    [STRUCTURE_NUKER]: [0, 0, 0, 0, 0, 0, 0, 0, 1],
    [STRUCTURE_POWER_SPAWN]: [0, 0, 0, 0, 0, 0, 0, 0, 1],
};

// ─── BUNKER STAMP ──────────────────────────────────────────────────

/**
 * The Bunker Stamp — a diamond layout radiating from center.
 *
 * Legend (visual):
 *   S = Spawn, E = Extension, T = Tower, G = Storage
 *   L = Link,  M = Terminal, B = Lab, O = Observer
 *   R = Road,  . = Empty
 *
 * Approximate layout (11×11):
 *
 *            E E E
 *          E R E R E
 *        E R T R T R E
 *      E R E R E R E R E
 *    E R E R S R G R E R E
 *      E R E R E R E R E
 *        E R L R M R E
 *          E R E R E
 *            E E E
 */

export const BUNKER_STAMP: StampEntry[] = [
    // ─── CENTER (Spawn) ─────────────────────────────
    { dx: 0, dy: 0, structureType: STRUCTURE_SPAWN, minRCL: 1 },

    // ─── STORAGE & TERMINAL (adjacent to spawn) ─────
    { dx: 2, dy: 0, structureType: STRUCTURE_STORAGE, minRCL: 4 },
    { dx: 2, dy: 2, structureType: STRUCTURE_TERMINAL, minRCL: 6 },

    // ─── TOWERS (defensive ring) ────────────────────
    { dx: -2, dy: -2, structureType: STRUCTURE_TOWER, minRCL: 3 },
    { dx: 2, dy: -2, structureType: STRUCTURE_TOWER, minRCL: 5 },
    { dx: -2, dy: 2, structureType: STRUCTURE_TOWER, minRCL: 7 },
    { dx: -4, dy: 0, structureType: STRUCTURE_TOWER, minRCL: 8 },
    { dx: 4, dy: 0, structureType: STRUCTURE_TOWER, minRCL: 8 },
    { dx: 0, dy: -4, structureType: STRUCTURE_TOWER, minRCL: 8 },

    // ─── LINKS ──────────────────────────────────────
    { dx: -2, dy: 2, structureType: STRUCTURE_LINK, minRCL: 5 },
    { dx: 0, dy: 2, structureType: STRUCTURE_LINK, minRCL: 6 },

    // ─── SPAWNS 2 & 3 ──────────────────────────────
    { dx: -2, dy: 0, structureType: STRUCTURE_SPAWN, minRCL: 7 },
    { dx: 0, dy: -2, structureType: STRUCTURE_SPAWN, minRCL: 8 },

    // ─── LABS (cluster) ─────────────────────────────
    { dx: 3, dy: -1, structureType: STRUCTURE_LAB, minRCL: 6 },
    { dx: 4, dy: -1, structureType: STRUCTURE_LAB, minRCL: 6 },
    { dx: 3, dy: -2, structureType: STRUCTURE_LAB, minRCL: 6 },
    { dx: 4, dy: -2, structureType: STRUCTURE_LAB, minRCL: 7 },
    { dx: 5, dy: -1, structureType: STRUCTURE_LAB, minRCL: 7 },
    { dx: 5, dy: -2, structureType: STRUCTURE_LAB, minRCL: 7 },
    { dx: 3, dy: -3, structureType: STRUCTURE_LAB, minRCL: 8 },
    { dx: 4, dy: -3, structureType: STRUCTURE_LAB, minRCL: 8 },
    { dx: 5, dy: -3, structureType: STRUCTURE_LAB, minRCL: 8 },
    { dx: 5, dy: 0, structureType: STRUCTURE_LAB, minRCL: 8 },

    // ─── OBSERVER, FACTORY, NUKER, POWER SPAWN ─────
    { dx: 0, dy: 4, structureType: STRUCTURE_OBSERVER, minRCL: 8 },
    { dx: -4, dy: 2, structureType: STRUCTURE_FACTORY, minRCL: 7 },
    { dx: 0, dy: -5, structureType: STRUCTURE_NUKER, minRCL: 8 },
    { dx: -4, dy: -2, structureType: STRUCTURE_POWER_SPAWN, minRCL: 8 },

    // ─── EXTENSIONS (60 total, RCL 2-8) ─────────────
    // Ring 1 (RCL 2): 5 extensions
    { dx: 1, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 2 },
    { dx: -1, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 2 },
    { dx: 1, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 2 },
    { dx: -1, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 2 },
    { dx: 0, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 2 },

    // Ring 2 (RCL 3): +5 = 10 total
    { dx: -1, dy: 0, structureType: STRUCTURE_EXTENSION, minRCL: 3 },
    { dx: 1, dy: 0, structureType: STRUCTURE_EXTENSION, minRCL: 3 },
    { dx: 0, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 3 },
    { dx: 2, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 3 },
    { dx: -2, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 3 },

    // Ring 3 (RCL 4): +10 = 20 total
    { dx: -2, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: 2, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: -1, dy: -2, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: 1, dy: -2, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: -3, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: 3, dy: 0, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: -3, dy: 0, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: 3, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: -1, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 4 },
    { dx: 1, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 4 },

    // Ring 4 (RCL 5): +10 = 30 total
    { dx: -3, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: 3, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: -1, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: 1, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: -3, dy: -2, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: 3, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: -1, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: 1, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: -3, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 5 },
    { dx: 0, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 5 },

    // Ring 5 (RCL 6): +10 = 40 total
    { dx: -4, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: 4, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: -4, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: 4, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: 0, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: 2, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: -2, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: 2, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: -2, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 6 },
    { dx: -3, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 6 },

    // Ring 6 (RCL 7): +10 = 50 total
    { dx: 3, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: 4, dy: -3, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: -3, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: 3, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: -4, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: 4, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: -5, dy: 0, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: 5, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: -5, dy: 1, structureType: STRUCTURE_EXTENSION, minRCL: 7 },
    { dx: -5, dy: -1, structureType: STRUCTURE_EXTENSION, minRCL: 7 },

    // Ring 7 (RCL 8): +10 = 60 total
    { dx: 5, dy: -4, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: -5, dy: -2, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: 5, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: -5, dy: 2, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: 5, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: -5, dy: 3, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: 0, dy: -6, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: -1, dy: -5, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: 1, dy: -5, structureType: STRUCTURE_EXTENSION, minRCL: 8 },
    { dx: 0, dy: 5, structureType: STRUCTURE_EXTENSION, minRCL: 8 },

    // ─── INTERNAL ROADS ─────────────────────────────
    // Cross roads through center
    { dx: -1, dy: 0, structureType: STRUCTURE_ROAD, minRCL: 3 },
    { dx: 1, dy: 0, structureType: STRUCTURE_ROAD, minRCL: 3 },
    { dx: 0, dy: -1, structureType: STRUCTURE_ROAD, minRCL: 3 },
    { dx: 0, dy: 1, structureType: STRUCTURE_ROAD, minRCL: 3 },
    { dx: 0, dy: 0, structureType: STRUCTURE_ROAD, minRCL: 3 },
];

// Note: Extensions that share positions with structures at higher RCLs
// will need conflict resolution — handled by the RoomPlanner.

// ─── HELPERS ───────────────────────────────────────────────────────

/**
 * Get all stamp entries that should be built at or before the given RCL.
 * Respects per-type RCL structure limits.
 */
export function getStampForRCL(rcl: number): StampEntry[] {
    // Count how many of each type we're including
    const typeCounts: { [type: string]: number } = {};

    return BUNKER_STAMP.filter(entry => {
        if (entry.minRCL > rcl) return false;

        const limit = STRUCTURE_LIMITS[entry.structureType];
        if (limit) {
            const maxAllowed = limit[rcl] ?? 0;
            const currentCount = typeCounts[entry.structureType] ?? 0;
            if (currentCount >= maxAllowed) return false;
            typeCounts[entry.structureType] = currentCount + 1;
        }

        return true;
    });
}

/**
 * Get the maximum stamp radius (for DT minimum check).
 */
export function getStampRadius(): number {
    let maxR = 0;
    for (const entry of BUNKER_STAMP) {
        maxR = Math.max(maxR, Math.abs(entry.dx), Math.abs(entry.dy));
    }
    return maxR;
}
