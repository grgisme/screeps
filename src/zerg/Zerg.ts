// ============================================================================
// Zerg — Creep wrapper with heap-cached pathing
// ============================================================================

import { GlobalCache } from "../utils/GlobalCache";

/**
 * A thin wrapper around `Creep` that provides:
 *
 *  - **Path caching** — serialized paths are stored on the heap (not Memory)
 *    and reused across ticks until they expire or the creep reaches its target.
 *
 *  - **Lazy resolution** — can be constructed with just a name and will
 *    resolve the `Creep` game object on demand.
 *
 * Design constraints:
 *  - No `forEach` — all iteration uses `for` / `for...of`.
 *  - Paths are cached as `Room.serializePath` strings for minimal heap usage.
 */
export class Zerg {
    private _creep: Creep | null;
    private _name: string;

    /** Number of ticks before a cached path is considered stale. */
    private static readonly PATH_TTL = 15;

    constructor(creepOrName: Creep | string) {
        if (typeof creepOrName === "string") {
            this._name = creepOrName;
            this._creep = null;
        } else {
            this._name = creepOrName.name;
            this._creep = creepOrName;
        }
    }

    // -----------------------------------------------------------------------
    // Accessors
    // -----------------------------------------------------------------------

    /** The underlying Creep, resolved lazily from `Game.creeps`. */
    get creep(): Creep {
        if (!this._creep || this._creep.ticksToLive === undefined) {
            const c = Game.creeps[this._name];
            if (!c) {
                throw new Error(`[Zerg] Creep "${this._name}" not found in Game.creeps`);
            }
            this._creep = c;
        }
        return this._creep;
    }

    get name(): string {
        return this._name;
    }

    get pos(): RoomPosition {
        return this.creep.pos;
    }

    // -----------------------------------------------------------------------
    // Path Cache (heap-backed via GlobalCache)
    // -----------------------------------------------------------------------

    private static getCache(): Map<string, { path: string; tick: number }> {
        return GlobalCache.getPathCache();
    }

    private static cacheKey(creepName: string, target: RoomPosition): string {
        return `${creepName}:${target.x}:${target.y}:${target.roomName}`;
    }

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------

    /**
     * Move toward a target position, caching the path on the heap.
     *
     * - If a valid cached path exists and hasn't expired, follow it.
     * - Otherwise, compute a new path, cache it, and start following.
     *
     * @returns The result code from `Creep.moveByPath` or `Creep.moveTo`.
     */
    travelTo(target: RoomPosition): ScreepsReturnCode {
        const cache = Zerg.getCache();
        const key = Zerg.cacheKey(this._name, target);
        const cached = cache.get(key);

        // If we're already at the target, clean up cache and stop
        if (this.creep.pos.isEqualTo(target)) {
            cache.delete(key);
            return OK;
        }

        // Try to use cached path
        if (cached && Game.time - cached.tick < Zerg.PATH_TTL) {
            const path = Room.deserializePath(cached.path);
            const result = this.creep.moveByPath(path);
            if (result === OK) {
                return OK;
            }
            // Path is no longer valid — fall through to recompute
        }

        // Compute fresh path
        const path = this.creep.pos.findPathTo(target, {
            ignoreCreeps: true,
            maxRooms: 1,
        });

        if (path.length === 0) {
            // Can't find a path — fall back to plain moveTo
            return this.creep.moveTo(target);
        }

        // Cache the serialized path
        const serialized = Room.serializePath(path);
        cache.set(key, { path: serialized, tick: Game.time });

        // Start following
        return this.creep.moveByPath(path);
    }

    /**
     * Clears this creep's cached paths (e.g. when reassigning to a new target).
     */
    clearPathCache(): void {
        const cache = Zerg.getCache();
        // Remove all keys for this creep
        const prefix = `${this._name}:`;
        const toDelete: string[] = [];
        for (const key of cache.keys()) {
            if (key.startsWith(prefix)) {
                toDelete.push(key);
            }
        }
        for (const key of toDelete) {
            cache.delete(key);
        }
    }
}
