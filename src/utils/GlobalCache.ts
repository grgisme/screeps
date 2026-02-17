// ============================================================================
// GlobalCache — Heap-first state management with global reset detection
// ============================================================================

/**
 * Screeps can reset the global object at any time. This module detects
 * those resets and provides typed cache get/set helpers that live on the
 * heap, avoiding costly `Memory` serialization on every tick.
 *
 * All heap data lives under the global `_heap` variable declared in types.d.ts.
 */

function ensureHeap(): HeapCache {
    if (typeof _heap === "undefined" || !_heap) {
        (globalThis as any)._heap = {
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
        return true;
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
