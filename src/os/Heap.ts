/**
 * Heap - The global volatile/persistent cache layer.
 *
 * This module manages two distinct types of runtime state:
 *
 * PERSISTENT (flushed to Memory every tick via dirty-bit):
 *   - Creep assignments, process PIDs, room plans
 *   - Anything that MUST survive a global reset
 *   - Accessed via heap.persistent, serialized back to Memory
 *
 * VOLATILE (heap-only, lost on global reset):
 *   - Path caches, CostMatrices, find() results, heatmaps
 *   - Object references (Room, Source, Structure instances)
 *   - Accessed via heap.volatile, NEVER serialized
 *
 * Hydration:
 *   On global reset, the Heap reads Memory and "hydrates" rich objects
 *   (e.g., resolving Source IDs to actual Source objects). On subsequent
 *   ticks, these hydrated references live on the V8 heap for free access.
 *
 * Dirty-Bit Flushing:
 *   The heap tracks a dirty flag. Only when markDirty() is called does
 *   the end-of-tick flush actually run JSON.stringify. If nothing changed,
 *   serialization is skipped entirely, saving ~2-10 CPU per tick.
 */

// ─── VOLATILE CACHE (Heap-only, lost on global reset) ──────────────

interface VolatileCache {
    /** Per-tick Room.find() result cache */
    findCache: { [roomName: string]: { [type: number]: any[] } };
    findCacheTick: number;

    /** CostMatrix cache (TTL-based, survives multiple ticks) */
    costMatrices: { [roomName: string]: { cm: CostMatrix, tick: number } };

    /** Path cache keyed by "from|to" */
    pathCache: { [key: string]: { path: PathStep[], tick: number } };

    /** Energy reservation cache (per-tick) */
    reservations: { [roomName: string]: Map<string, number> };
    reservationsTick: number;

    /** Hydrated room object references (Source[], Structure[], etc.) */
    roomObjects: { [roomName: string]: HydratedRoom };

    /** Road heatmap for traffic analysis */
    heatmaps: { [roomName: string]: { [posKey: string]: number } };

    /** Arbitrary process-specific volatile data */
    processData: { [pid: string]: any };
}

interface HydratedRoom {
    sources?: Source[];
    containers?: StructureContainer[];
    extensions?: StructureExtension[];
    spawns?: StructureSpawn[];
    towers?: StructureTower[];
    controller?: StructureController;
    storage?: StructureStorage;
    hydrateTick: number; // Tick when this was last hydrated
}

// ─── PERSISTENT STATE (flushed to Memory.heap) ─────────────────────

interface PersistentState {
    /** Creep-to-target assignments that must survive reset */
    assignments: { [creepName: string]: string };

    /** Room-level persistent flags */
    roomFlags: { [roomName: string]: Record<string, any> };

    /** Custom persistent data keyed by process PID */
    processData: { [pid: string]: Record<string, any> };
}

// ─── HEAP SINGLETON ────────────────────────────────────────────────

class HeapManager {
    /** Volatile data — lost on global reset, never serialized */
    volatile: VolatileCache;

    /** Persistent data — flushed to Memory when dirty */
    persistent: PersistentState;

    /** Dirty bit — set to true when persistent state changes */
    private _dirty: boolean = false;

    /** Whether hydration has run this global lifecycle */
    private _hydrated: boolean = false;

    /** Tick of last flush */
    private _lastFlushTick: number = -1;

    constructor() {
        this.volatile = this.createVolatile();
        this.persistent = this.createPersistent();
    }

    // ─── INITIALIZATION ────────────────────────────────────────────

    /**
     * Called once per global reset from Kernel.boot().
     * Reads Memory.heap and hydrates persistent state.
     * Also hydrates room object references from the game world.
     */
    hydrate(): void {
        if (this._hydrated) return;

        // Restore persistent state from Memory
        const saved = (Memory as any).heap as PersistentState | undefined;
        if (saved) {
            this.persistent = {
                assignments: saved.assignments || {},
                roomFlags: saved.roomFlags || {},
                processData: saved.processData || {},
            };
            console.log(`💧 HEAP: Hydrated persistent state from Memory.heap`);
        } else {
            this.persistent = this.createPersistent();
            console.log(`💧 HEAP: Fresh persistent state (no saved heap in Memory)`);
        }

        // Reset volatile (always fresh on global reset)
        this.volatile = this.createVolatile();

        // Hydrate room objects for all visible rooms
        this.hydrateRooms();

        this._hydrated = true;
        this._dirty = false;
    }

    /**
     * Hydrate rich object references from the game world.
     * These live on the heap as volatile data (re-built on reset).
     */
    private hydrateRooms(): void {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;

            this.volatile.roomObjects[roomName] = {
                sources: room.find(FIND_SOURCES),
                containers: room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER
                }) as StructureContainer[],
                extensions: room.find(FIND_MY_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_EXTENSION
                }) as StructureExtension[],
                spawns: room.find(FIND_MY_SPAWNS),
                towers: room.find(FIND_MY_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_TOWER
                }) as StructureTower[],
                controller: room.controller,
                storage: room.storage,
                hydrateTick: Game.time,
            };
        }

        const roomCount = Object.keys(this.volatile.roomObjects).length;
        console.log(`💧 HEAP: Hydrated ${roomCount} room(s) into volatile cache`);
    }

    // ─── PER-TICK CACHE ────────────────────────────────────────────

    /**
     * Cached Room.find() — results cached per-tick per-room per-type.
     * Falls through to room.find() for filtered queries.
     */
    find<T extends FindConstant>(room: Room, type: T, opts?: FilterOptions<T>): Array<any> {
        if (this.volatile.findCacheTick !== Game.time) {
            this.volatile.findCache = {};
            this.volatile.findCacheTick = Game.time;
        }

        // Filtered finds bypass cache
        if (opts) return room.find(type, opts);

        if (!this.volatile.findCache[room.name]) {
            this.volatile.findCache[room.name] = {};
        }

        if (!this.volatile.findCache[room.name][type]) {
            this.volatile.findCache[room.name][type] = room.find(type);
        }

        return this.volatile.findCache[room.name][type];
    }

    /**
     * Cached CostMatrix — TTL-based, survives across ticks.
     */
    getCostMatrix(roomName: string, ttl: number, builder: () => CostMatrix): CostMatrix {
        const cached = this.volatile.costMatrices[roomName];
        if (cached && Game.time - cached.tick < ttl) {
            return cached.cm;
        }

        const cm = builder();
        this.volatile.costMatrices[roomName] = { cm, tick: Game.time };
        return cm;
    }

    /**
     * Get hydrated room objects (sources, containers, etc.)
     * Re-hydrates if stale (older than 50 ticks) or missing.
     */
    getRoomObjects(roomName: string): HydratedRoom | undefined {
        const cached = this.volatile.roomObjects[roomName];
        if (cached && Game.time - cached.hydrateTick < 50) {
            return cached;
        }

        // Re-hydrate
        const room = Game.rooms[roomName];
        if (!room) return undefined;

        this.volatile.roomObjects[roomName] = {
            sources: room.find(FIND_SOURCES),
            containers: room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            }) as StructureContainer[],
            extensions: room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_EXTENSION
            }) as StructureExtension[],
            spawns: room.find(FIND_MY_SPAWNS),
            towers: room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_TOWER
            }) as StructureTower[],
            controller: room.controller,
            storage: room.storage,
            hydrateTick: Game.time,
        };

        return this.volatile.roomObjects[roomName];
    }

    // ─── DIRTY-BIT PERSISTENT STATE ────────────────────────────────

    /** Mark the persistent state as modified — forces flush at end of tick */
    markDirty(): void {
        this._dirty = true;
    }

    /** Check if persistent state has been modified this tick */
    isDirty(): boolean {
        return this._dirty;
    }

    /**
     * Set a persistent value and automatically mark dirty.
     */
    setPersistent(namespace: string, key: string, value: any): void {
        if (!this.persistent.processData[namespace]) {
            this.persistent.processData[namespace] = {};
        }
        this.persistent.processData[namespace][key] = value;
        this._dirty = true;
    }

    /**
     * Get a persistent value.
     */
    getPersistent(namespace: string, key: string): any {
        return this.persistent.processData[namespace]?.[key];
    }

    /**
     * Flush persistent state to Memory — ONLY if dirty.
     * Called at end of every tick by Kernel.
     *
     * Returns true if flush occurred, false if skipped.
     */
    flush(): boolean {
        if (!this._dirty) return false;
        if (this._lastFlushTick === Game.time) return false;

        (Memory as any).heap = this.persistent;
        this._dirty = false;
        this._lastFlushTick = Game.time;
        return true;
    }

    // ─── GARBAGE COLLECTION ────────────────────────────────────────

    /**
     * Remove all heap references for a terminated process.
     * Called by Kernel.terminate() to prevent memory leaks.
     */
    gcProcess(pid: string): void {
        delete this.volatile.processData[pid];
        delete this.persistent.processData[pid];
        this._dirty = true;
    }

    /**
     * Remove all heap references for a dead creep.
     * Called during memory cleanup to prevent stale references.
     */
    gcCreep(creepName: string): void {
        delete this.persistent.assignments[creepName];
        this._dirty = true;
    }

    /**
     * Run full garbage collection — clean up dead creeps and stale data.
     * Called periodically (e.g., every 50 ticks) by the Kernel.
     */
    gc(): void {
        let cleaned = 0;

        // Clean dead creep assignments
        for (const name in this.persistent.assignments) {
            if (!Game.creeps[name]) {
                delete this.persistent.assignments[name];
                cleaned++;
            }
        }

        // Clean stale path cache (older than 100 ticks)
        for (const key in this.volatile.pathCache) {
            if (Game.time - this.volatile.pathCache[key].tick > 100) {
                delete this.volatile.pathCache[key];
            }
        }

        // Clean stale CostMatrices (older than 50 ticks)
        for (const roomName in this.volatile.costMatrices) {
            if (Game.time - this.volatile.costMatrices[roomName].tick > 50) {
                delete this.volatile.costMatrices[roomName];
            }
        }

        // Clean room objects for rooms we no longer have visibility into
        for (const roomName in this.volatile.roomObjects) {
            if (!Game.rooms[roomName]) {
                delete this.volatile.roomObjects[roomName];
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this._dirty = true;
            if (Game.time % 100 === 0) {
                console.log(`♻️ HEAP GC: Cleaned ${cleaned} stale entries`);
            }
        }
    }

    // ─── DIAGNOSTICS ───────────────────────────────────────────────

    stats(): string {
        const pathCount = Object.keys(this.volatile.pathCache).length;
        const cmCount = Object.keys(this.volatile.costMatrices).length;
        const roomCount = Object.keys(this.volatile.roomObjects).length;
        const assignCount = Object.keys(this.persistent.assignments).length;
        const procDataCount = Object.keys(this.persistent.processData).length;

        return [
            `--- 🧠 HEAP STATS (Tick ${Game.time}) ---`,
            `Volatile: ${pathCount} paths, ${cmCount} CMs, ${roomCount} rooms`,
            `Persistent: ${assignCount} assignments, ${procDataCount} process data`,
            `Dirty: ${this._dirty}`,
        ].join('\n');
    }

    // ─── FACTORY ───────────────────────────────────────────────────

    private createVolatile(): VolatileCache {
        return {
            findCache: {},
            findCacheTick: -1,
            costMatrices: {},
            pathCache: {},
            reservations: {},
            reservationsTick: -1,
            roomObjects: {},
            heatmaps: {},
            processData: {},
        };
    }

    private createPersistent(): PersistentState {
        return {
            assignments: {},
            roomFlags: {},
            processData: {},
        };
    }
}

/** Global singleton — import and use everywhere */
export const heap = new HeapManager();
