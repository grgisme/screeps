// ============================================================================
// Process — Abstract base class for all OS processes
// ============================================================================

import { ProcessStatus, ProcessStatusType } from "./ProcessStatus";

/**
 * Every unit of work in the Screeps OS is modelled as a Process.
 * Concrete subclasses implement `run()` to perform their tick logic.
 *
 * Processes are managed by the Kernel's scheduler and executed in
 * priority order (lower number = higher priority).
 *
 * ## Generator Coroutines
 * `run()` may return a `Generator` to split work across multiple ticks.
 * The Kernel stores the generator as `this.thread` and calls `.next()`
 * on subsequent ticks until the generator completes.
 *
 * ## ⚠️ GETTER PATTERN RULE — V8 Memory Leak Prevention ⚠️
 *
 * **NEVER** store live Game objects (`Creep`, `Room`, `Structure`, etc.)
 * directly as class properties on heap-persisted Process instances.
 * The V8 VM creates new Game objects every tick; storing old references
 * prevents garbage collection of the ENTIRE previous tick's game state,
 * causing a fatal memory leak that crashes the isolate.
 *
 * **CORRECT:** Store the string `name` or `Id<T>` and use a getter:
 * ```typescript
 * private _creepName: string;
 * get creep(): Creep | undefined {
 *     return Game.creeps[this._creepName];
 * }
 * ```
 *
 * **WRONG:** `this.creep = Game.creeps['Alice'];` on a heap-cached object.
 */
export abstract class Process {
    public pid: number;
    public priority: number;
    public parentPID: number | null;
    public status: ProcessStatusType;

    /**
     * Stable, purpose-derived identifier for deduplication and lookup.
     * Examples: "mining:E1S1:src123", "upgrade:E1S1", "profiler:global"
     * Set by subclasses in their constructor.
     */
    public processId: string = "";

    /**
     * Game.time at which this process should auto-wake from sleep.
     * `null` means the process is not on a timed sleep.
     */
    public sleepUntil: number | null = null;

    /**
     * Active generator coroutine. When set, the Kernel calls `.next()`
     * each tick instead of `run()`. Cleared when the generator completes.
     */
    public thread?: Generator<void, void, unknown>;

    /** Human-readable identifier used for serialization / logging */
    public abstract readonly processName: string;

    constructor(pid: number, priority: number, parentPID: number | null = null) {
        this.pid = pid;
        this.priority = priority;
        this.parentPID = parentPID;
        this.status = ProcessStatus.ALIVE;
    }

    // -------------------------------------------------------------------------
    // Lifecycle helpers
    // -------------------------------------------------------------------------

    /** Pause this process — the scheduler will skip it. */
    suspend(): void {
        this.status = ProcessStatus.SLEEP;
    }

    /** Resume a sleeping process, clearing any timed sleep. */
    resume(): void {
        if (this.status === ProcessStatus.SLEEP) {
            this.status = ProcessStatus.ALIVE;
            this.sleepUntil = null;
        }
    }

    /**
     * Put this process to sleep for a specified number of ticks.
     * The Kernel will automatically wake it when `Game.time >= sleepUntil`.
     * This is far cheaper than running a process that does nothing — the
     * Kernel skips sleeping processes entirely without any CPU overhead.
     */
    sleep(ticks: number): void {
        this.sleepUntil = Game.time + ticks;
        this.status = ProcessStatus.SLEEP;
    }

    /** Mark this process for removal on the next scheduler sweep. */
    terminate(): void {
        this.status = ProcessStatus.DEAD;
    }

    /** Returns `true` when the process should be executed this tick. */
    isAlive(): boolean {
        return this.status === ProcessStatus.ALIVE;
    }

    /**
     * Returns `true` if this process is sleeping and should be woken up.
     * Called by the Kernel before the main scheduler loop.
     */
    shouldWake(): boolean {
        return (
            this.status === ProcessStatus.SLEEP &&
            this.sleepUntil !== null &&
            Game.time >= this.sleepUntil
        );
    }

    // -------------------------------------------------------------------------
    // Serialization (for Memory persistence across global resets)
    // -------------------------------------------------------------------------

    /**
     * Override this in subclasses to persist process-specific state.
     * Only return data that is absolutely required to survive a global reset.
     */
    serialize(): Record<string, unknown> {
        return {};
    }

    /**
     * Override this to restore process-specific state after a global reset.
     */
    deserialize(_data: Record<string, unknown>): void {
        // default: no-op
    }

    /**
     * Produce the full descriptor for the Kernel to store in Memory.
     */
    toDescriptor(): ProcessDescriptor {
        return {
            pid: this.pid,
            priority: this.priority,
            parentPID: this.parentPID,
            processName: this.processName,
            processId: this.processId,
            status: this.status,
            sleepUntil: this.sleepUntil ?? undefined,
            data: this.serialize(),
        };
    }

    // -------------------------------------------------------------------------
    // Core — implemented by every concrete process
    // -------------------------------------------------------------------------

    /**
     * Execute one tick of work for this process.
     *
     * May return a Generator to split work across multiple ticks.
     * The Kernel will store the generator and call `.next()` each tick
     * until it completes (`.done === true`).
     */
    abstract run(): void | Generator<void, void, unknown>;
}
