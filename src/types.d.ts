// ============================================================================
// Screeps OS — Global Type Declarations
// ============================================================================

// ---------------------------------------------------------------------------
// Process System Types
// ---------------------------------------------------------------------------

/**
 * Using a plain object of constants instead of `const enum` so that
 * values survive ts-node compilation and remain available at runtime
 * in both the Rollup bundle and the mocha test runner.
 */

interface ProcessDescriptor {
    pid: number;
    priority: number;
    parentPID: number | null;
    processName: string;
    /** Stable, purpose-derived identifier (e.g., "mining:E1S1:src123") */
    processId?: string;
    status: number;
    /** Game.time at which a sleeping process should auto-wake */
    sleepUntil?: number;
    /** Minimal serializable state for Memory persistence */
    data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Kernel Memory Contract
// ---------------------------------------------------------------------------

interface KernelMemory {
    processTable: ProcessDescriptor[];
    nextPID: number;
    /** Game.time when the last global reset was detected */
    lastGlobalReset?: number;
}

// ---------------------------------------------------------------------------
// Screeps Memory Augmentation (minimal — heap-first philosophy)
// ---------------------------------------------------------------------------

interface CreepMemory {
    /** The role determines which process spawned this creep */
    role: string;
    /** PID of the owning process */
    pid: number;
    /** Optional target ID (source, controller, etc.) */
    targetId?: string;
    /** Room the creep was spawned for */
    homeRoom?: string;
}

interface RoomPosition {
    getPositionAtDirection(direction: DirectionConstant): RoomPosition | null;
}

interface RoomMemory {
    isDangerous?: boolean;
    dangerUntil?: number;
    [key: string]: any;
}

interface Memory {
    kernel: KernelMemory;
    creeps: { [name: string]: CreepMemory };
    /** Log verbosity level (0=DEBUG, 1=INFO, 2=WARNING, 3=ERROR) */
    logLevel?: number;
    /** Arbitrary heap-persistent data storage */
    heap?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Global Heap Cache
// ---------------------------------------------------------------------------

interface HeapCache {
    _initialized: boolean;
    _kernelInstance: any;
    _cache: Map<string, unknown>;
    _pathCache: Map<string, { path: string; tick: number }>;
    _dirty?: Set<string>; // Keys that need saving to Memory
    _serializers?: Map<string, () => unknown>; // How to save each key
}

/**
 * Extend the global scope so we can store heap-persistent data.
 * Uses an explicit `_heap` container to avoid `global.X` implicit any issues.
 */
declare let _heap: HeapCache;
