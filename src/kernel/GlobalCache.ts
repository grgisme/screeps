// ============================================================================
// GlobalCache — Heap-first state management with global reset detection
// ============================================================================

/**
 * Screeps can reset the global object at any time. This module detects
 * those resets, records them in Memory, and provides cache primitives
 * for heap-persistent storage.
 *
 * All heap data lives under the global `_heap` variable declared in types.d.ts.
 */

import { Logger } from "../utils/Logger";

const log = new Logger("GlobalCache");

function ensureHeap(): HeapCache {
    if (typeof _heap === "undefined" || !_heap) {
        (global as any)._heap = {
            _initialized: false,
            _kernelInstance: undefined,
            _cache: new Map<string, unknown>(),
            _pathCache: new Map<string, { path: string; tick: number }>(),
        };
    }
    return _heap;
}

export class GlobalCache {
    /**
     * Returns `true` the first time it is called after a global reset.
     * Subsequent calls in the same global lifecycle return `false`.
     *
     * Also records `Memory.kernel.lastGlobalReset = Game.time`.
     */
    static isGlobalReset(): boolean {
        const heap = ensureHeap();
        if (heap._initialized) {
            return false;
        }
        // First tick after a global reset
        heap._initialized = true;
        heap._cache = new Map<string, unknown>();
        heap._pathCache = new Map<string, { path: string; tick: number }>();

        // Record timestamp in Memory
        if (Memory.kernel) {
            Memory.kernel.lastGlobalReset = Game.time;
        }

        log.info(`Global reset detected at tick ${Game.time}`);
        return true;
    }

    // Track keys that have changed and need serialization
    private static getDirty(): Set<string> {
        const heap = ensureHeap();
        if (!heap._dirty) {
            heap._dirty = new Set<string>();
        }
        return heap._dirty;
    }

    /**
     * Restore a value from global heap if available, otherwise generate it
     * and persist to heap.
     *
     * @param key Unique key for the object (e.g., 'RoomManager:E1S1')
     * @param generator Function to create the object if not in heap
     * @param serializer Optional function to return a serializable version for Memory
     */
    static rehydrate<T>(key: string, generator: () => T, serializer?: (obj: T) => unknown): T {
        const heap = ensureHeap();
        if (heap._cache.has(key)) {
            return heap._cache.get(key) as T;
        }

        // Not in heap - generate it
        const value = generator();
        heap._cache.set(key, value);

        // If a serializer is provided, future commits will save this key
        if (serializer) {
            this.setSerializer(key, () => serializer(value));
        }

        return value;
    }

    /** Register a serializer for a key without changing the value */
    static setSerializer(key: string, serializer: () => unknown): void {
        const heap = ensureHeap();
        if (!heap._serializers) {
            heap._serializers = new Map();
        }
        heap._serializers.set(key, serializer);
        // Do NOT mark dirty here. Serializer registration doesn't imply data change.
    }

    /** Mark a key as needing serialization at end of tick */
    static markDirty(key: string): void {
        this.getDirty().add(key);
    }

    /** Write all dirty keys to Memory */
    static commit(): void {
        const heap = ensureHeap();
        const dirty = this.getDirty();

        if (dirty.size === 0) {
            return;
        }

        if (!Memory.heap) {
            Memory.heap = {};
        }

        let savedCount = 0;
        for (const key of dirty) {
            const serializer = heap._serializers?.get(key);
            if (serializer) {
                try {
                    Memory.heap[key] = serializer();
                    savedCount++;
                } catch (e) {
                    log.error(`Failed to serialize ${key}: ${e}`);
                }
            }
        }

        if (savedCount > 0) {
            log.info(`Committed ${savedCount} dirty objects to Memory`);
        }
        dirty.clear();
    }

    /** Retrieve a value from the heap cache. */
    static get<T>(key: string): T | undefined {
        const heap = ensureHeap();
        return heap._cache.get(key) as T | undefined;
    }

    /** Store a value in the heap cache. */
    static set<T>(key: string, value: T): void {
        const heap = ensureHeap();
        heap._cache.set(key, value);
    }

    /** Delete a value from the heap cache. */
    static delete(key: string): boolean {
        const heap = ensureHeap();
        return heap._cache.delete(key);
    }

    /** Clear all cached values. */
    static clear(): void {
        const heap = ensureHeap();
        heap._cache.clear();
        heap._pathCache.clear();
    }

    /** Direct access to the path cache (used by Zerg). */
    static getPathCache(): Map<string, { path: string; tick: number }> {
        const heap = ensureHeap();
        return heap._pathCache;
    }
}
