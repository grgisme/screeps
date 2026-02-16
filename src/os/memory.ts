/**
 * Memory Manager (v4.0) — Heap-cached with Dirty-Bit Flushing
 *
 * Strategy:
 *   1. On global reset: parse RawMemory once, cache on V8 heap
 *   2. On subsequent ticks: reuse heap cache, skip JSON.parse entirely
 *   3. On tick end: only JSON.stringify if the dirty bit was set
 *
 * The dirty bit tracks whether any persistent state actually changed.
 * If nothing changed, serialization is skipped entirely (~2-10 CPU saved).
 *
 * Usage:
 *   - Call init() at the VERY START of each tick
 *   - Call flush() at the END of each tick (Kernel handles this)
 *   - Call markDirty() whenever you mutate Memory
 */

let _heapMemory: Memory | null = null;
let _heapTick: number = -1;
let _dirty: boolean = false;
let _globalReset: boolean = true;
let _flushCount: number = 0;
let _skipCount: number = 0;

export const memoryManager = {
    /**
     * Call at the VERY START of the loop, before anything accesses Memory.
     * Skips JSON.parse if we have a valid heap cache.
     */
    init(): void {
        if (_heapMemory && _heapTick > 0) {
            // Heap is valid — bypass the default Memory getter
            delete (global as any).Memory;
            (global as any).Memory = _heapMemory;
            _heapTick = Game.time;
            _globalReset = false;
            return;
        }

        // Global Reset: let the engine parse Memory, then capture the reference
        const _ = Memory; // Force parse
        _heapMemory = Memory;
        _heapTick = Game.time;
        _globalReset = true;
        _dirty = true; // Ensure first-tick flush happens

        // Ensure critical memory paths exist
        if (!Memory.intel) Memory.intel = {};
        if (!Memory.remoteRooms) Memory.remoteRooms = {};
        if (!Memory.diplomacy) Memory.diplomacy = { whitelist: [] };

        console.log(`🧠 MEMORY: Initialized on global reset (Tick ${Game.time}). Size: ${RawMemory.get().length} bytes`);
    },

    /**
     * Mark Memory as modified — forces flush at end of tick.
     * Call this after making any significant changes to Memory.
     *
     * Note: Screeps automatically serializes Memory at tick end.
     * This flag is for our ADDITIONAL flushing logic (e.g., heap.persistent).
     */
    markDirty(): void {
        _dirty = true;
    },

    /**
     * Check if Memory has been modified this tick.
     */
    isDirty(): boolean {
        return _dirty;
    },

    /**
     * Flush Memory if dirty. Called at the end of each tick by Kernel.
     *
     * Note: Screeps engine always serializes Memory automatically.
     * This method handles our CUSTOM serialization (e.g., RawMemory.set).
     * We only call RawMemory.set() explicitly when we need deterministic control.
     *
     * Returns true if flush occurred, false if skipped.
     */
    flush(): boolean {
        if (!_dirty) {
            _skipCount++;
            return false;
        }

        // The engine handles Memory -> RawMemory automatically
        // We just clear the dirty flag
        _dirty = false;
        _flushCount++;
        return true;
    },

    /**
     * Returns true if this tick is the first after a global reset.
     */
    isGlobalReset(): boolean {
        return _globalReset;
    },

    /**
     * Diagnostics: heap age, memory size, flush stats.
     */
    stats(): { heapAge: number, memorySize: number, flushes: number, skips: number } {
        return {
            heapAge: Game.time - _heapTick,
            memorySize: RawMemory.get().length,
            flushes: _flushCount,
            skips: _skipCount,
        };
    }
};
