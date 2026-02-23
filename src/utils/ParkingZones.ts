// ============================================================================
// ParkingZones — Distance Transform–based idle parking for domestic creeps
// ============================================================================
//
// Replaces primitive Math.sign * 5 flee vectors with spatially-aware
// "dead-end" parking spots: tiles provably far from all walls/structures
// (DT value ≥ 3) and fully outside the BunkerLayout footprint (radius 7
// from the colony anchor).
//
// CPU amortization: the DT is computed once per structure-count change and
// cached in GlobalCache. Subsequent ticks are O(1) cache hits.
// ============================================================================

import { distanceTransform } from "./Algorithms";
import { GlobalCache } from "../kernel/GlobalCache";

const BUNKER_EXCLUSION_RADIUS = 7; // BunkerLayout extends to radius 6 — +1 margin
const MIN_DT_PRIMARY = 3;          // Spacious open tiles
const MIN_DT_FALLBACK = 2;         // Cramped rooms: allow slightly narrower tiles

// ── Cache entry ──
interface ParkingZoneCache {
    structCount: number;
    zones: { x: number; y: number }[]; // plain coords — RoomPosition is not serializable
}

/**
 * Returns a list of candidate parking positions for this room:
 * walkable tiles that are far from walls/structures AND outside the bunker.
 *
 * Results are cached against structCount so the DT only runs once
 * per structure-change event (same pattern as matrix_static).
 *
 * @param room       The room to compute zones for.
 * @param anchorX    X coordinate of the colony BunkerLayout anchor.
 * @param anchorY    Y coordinate of the colony BunkerLayout anchor.
 */
export function getParkingZones(
    room: Room,
    anchorX: number,
    anchorY: number
): RoomPosition[] {
    const structCount = room.find(FIND_STRUCTURES).length;
    const cacheKey = `parkingZones:${room.name}`;
    const cached = GlobalCache.get<ParkingZoneCache>(cacheKey);

    if (cached && cached.structCount === structCount) {
        return cached.zones.map(c => new RoomPosition(c.x, c.y, room.name));
    }

    // ── Fetch the static cost matrix (structures already cost 255 there) ──
    const staticCached = GlobalCache.get<{ matrix: CostMatrix }>(
        `matrix_static:${room.name}`
    );
    const staticMatrix = staticCached?.matrix; // undefined on first tick — DT still works (terrain-only)

    const dt = distanceTransform(room.name, staticMatrix);

    // Terrain object needed to filter actual wall tiles from the candidate set.
    // The DT treats structures (via staticMatrix) as obstacles but only marks
    // terrain walls implicitly through zero-value DT cells. Computing terrain
    // here is O(1) (cached by the engine) and gives us an explicit bit-mask check
    // inside collectZones, which is cheaper than relying on DT alone.
    const terrain = Game.map.getRoomTerrain(room.name);

    // ── Collect candidates at DT ≥ 3 outside the bunker radius ──
    let zones = collectZones(dt, terrain, anchorX, anchorY, MIN_DT_PRIMARY);

    // ── Cramped room fallback: loosen to DT ≥ 2 ──
    if (zones.length === 0) {
        zones = collectZones(dt, terrain, anchorX, anchorY, MIN_DT_FALLBACK);
    }

    GlobalCache.set<ParkingZoneCache>(cacheKey, { structCount, zones });

    return zones.map(c => new RoomPosition(c.x, c.y, room.name));
}

/**
 * Pick a parking zone for one specific creep.
 *
 * Anti-clumping: instead of all idle creeps converging on the same
 * findClosestByRange tile, we sort by range, slice the top-3 nearest,
 * then pick one at random. Spreading creeps across 3 distinct spots
 * eliminates the "idle pile" that blocks a single corridor tile.
 *
 * Reachability guard: if a static cost matrix is supplied, zones where a
 * structure was built after the last DT cache (matrix value ≥ 255) are
 * filtered out before pool selection, preventing a transporter from
 * heading to a tile that is now blocked.
 *
 * @param pos          The creep's current position.
 * @param zones        The array returned by getParkingZones().
 * @param staticMatrix Optional per-room cost matrix for structure checks.
 */
export function pickParkingZone(
    pos: RoomPosition,
    zones: RoomPosition[],
    staticMatrix?: CostMatrix
): RoomPosition | null {
    if (zones.length === 0) return null;

    // Filter out tiles blocked by structures built since the last DT recompute.
    // The DT cache invalidates on structCount change, but on the SAME tick that a
    // structure is placed the old cache is still served. The static matrix is
    // updated immediately (same structCount trigger in TrafficManager/Zerg),
    // so it catches newly blocked tiles that the cached DT would still allow.
    const walkable = staticMatrix
        ? zones.filter(z => staticMatrix.get(z.x, z.y) < 255)
        : zones;

    if (walkable.length === 0) return null;

    // Sort by Chebyshev range (no sqrt, cheap)
    const sorted = walkable
        .map(z => ({ z, d: Math.max(Math.abs(z.x - pos.x), Math.abs(z.y - pos.y)) }))
        .sort((a, b) => a.d - b.d);

    // Pick randomly from the 3 closest candidates
    const pool = sorted.slice(0, Math.min(3, sorted.length));
    return pool[Math.floor(Math.random() * pool.length)].z;
}

/**
 * Fix 3 — Rampart-Aware Defensive Idling.
 *
 * During a DEFCON state (isDangerous), domestic creeps should seek cover
 * under the nearest unoccupied rampart instead of standing in open corridors
 * where they absorb splash damage and block hatchery exits.
 *
 * Returns null if the room has no ramparts (early RCL), so the caller can
 * fall through to normal DT-parking or bootstrap flee logic.
 *
 * @param room The room to check.
 * @param pos  The creep's current position.
 */
export function getRampartTarget(room: Room, pos: RoomPosition): RoomPosition | null {
    // Only relevant during an active threat
    if (!(Memory.rooms as any)?.[room.name]?.isDangerous) return null;

    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: (s: AnyOwnedStructure) => s.structureType === STRUCTURE_RAMPART,
    }) as StructureRampart[];

    if (ramparts.length === 0) return null;

    // Filter to unoccupied ramparts (no friendly creep already on the tile)
    const free = ramparts.filter(r => r.pos.lookFor(LOOK_CREEPS).length === 0);
    const candidates = free.length > 0 ? free : ramparts; // fallback: allow sharing

    // Pick the nearest (Chebyshev)
    let best: StructureRampart | null = null;
    let bestD = Infinity;
    for (const r of candidates) {
        const d = Math.max(Math.abs(r.pos.x - pos.x), Math.abs(r.pos.y - pos.y));
        if (d < bestD) { best = r; bestD = d; }
    }

    return best ? best.pos : null;
}

// ── Internal helper ──
function collectZones(
    dt: CostMatrix,
    terrain: RoomTerrain,
    anchorX: number,
    anchorY: number,
    minDt: number
): { x: number; y: number }[] {
    const zones: { x: number; y: number }[] = [];

    for (let x = 2; x < 48; x++) {
        for (let y = 2; y < 48; y++) {
            // Explicit terrain wall check: the DT treats structures as obstacles
            // but terrain walls may not always map to DT = 0 in every edge case
            // (e.g. DT built from a staticMatrix that didn't include a swamp
            // strip at the edge). A direct bit-mask check is O(1) and definitive.
            if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) continue;

            // Must be genuinely open (far from all walls and structures)
            if (dt.get(x, y) < minDt) continue;

            // Must be outside the BunkerLayout footprint (Chebyshev distance)
            const cheb = Math.max(Math.abs(x - anchorX), Math.abs(y - anchorY));
            if (cheb <= BUNKER_EXCLUSION_RADIUS) continue;

            zones.push({ x, y });
        }
    }

    return zones;
}
