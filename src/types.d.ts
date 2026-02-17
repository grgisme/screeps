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
    status: number;
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

interface Memory {
    kernel: KernelMemory;
    creeps: { [name: string]: CreepMemory };
    /** Log verbosity level (0=DEBUG, 1=INFO, 2=WARNING, 3=ERROR) */
    logLevel?: number;
}

// ---------------------------------------------------------------------------
// Global Heap Cache
// ---------------------------------------------------------------------------

interface HeapCache {
    _initialized: boolean;
    _kernelInstance: any;
    _cache: Map<string, unknown>;
    _pathCache: Map<string, { path: string; tick: number }>;
}

/**
 * Extend the global scope so we can store heap-persistent data.
 * Uses an explicit `_heap` container to avoid `global.X` implicit any issues.
 */
declare let _heap: HeapCache;
