// ============================================================================
// Kernel — Process scheduler with bucketed priorities, O(1) wake map,
//          generator coroutines, and 3-tier load shedding
// ============================================================================

import { Process } from "./Process";
import { ProcessStatus, ProcessStatusType } from "./ProcessStatus";
import { GlobalCache } from "./GlobalCache";
import { ErrorMapper } from "./ErrorMapper";
import { Logger } from "../utils/Logger";

const log = new Logger("Kernel");

/** Factory function signature for restoring a process from a descriptor. */
export type ProcessFactory = (
    pid: number,
    priority: number,
    parentPID: number | null,
    data: Record<string, unknown>
) => Process;

// ---------------------------------------------------------------------------
// Scheduler Mode — 3-tier CPU governor
// ---------------------------------------------------------------------------

export const SchedulerMode = {
    /** bucket > 500 — all processes execute, burst CPU allowed */
    NORMAL: "NORMAL",
    /** bucket < 500 — skip processes with priority > 2 */
    SAFE: "SAFE",
    /** bucket < 100 — only priority 0 + kernel core */
    EMERGENCY: "EMERGENCY",
} as const;

export type SchedulerModeType = (typeof SchedulerMode)[keyof typeof SchedulerMode];

// ---------------------------------------------------------------------------
// Scheduler Report — per-tick scheduling diagnostics
// ---------------------------------------------------------------------------

export interface SchedulerReport {
    /** Count of executed processes grouped by raw priority */
    executed: Map<number, number>;
    /** Count of skipped processes grouped by raw priority */
    skipped: Map<number, number>;
    /** Number of sleeping processes (not checked at all) */
    sleeping: number;
    /** Scheduler mode for this tick */
    mode: SchedulerModeType;
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

/**
 * The Kernel is the heart of the OS. It maintains a table of live
 * processes, schedules them by priority, and enforces per-tick CPU
 * budgets with a 3-tier load shedding governor.
 *
 * Performance characteristics (N = number of processes):
 * - Process lookup by PID:        O(1) via processTable
 * - Process lookup by processId:  O(1) via processIdIndex
 * - Process lookup by name:       O(1) via processNameIndex
 * - Scheduling (per tick):        O(P + R) where P = priority levels, R = runnable
 * - Wake from sleep:              O(W) where W = processes waking THIS tick
 *
 * Advanced features:
 * - Generator coroutines: processes can yield across ticks
 * - O(1) wake map: sleeping processes auto-wake without full-table scan
 * - Dynamic CPU bursting: uses tickLimit when bucket is healthy
 * - Bucketed priority queue: O(P) iteration replaces O(N log N) sort
 * - Stable processId: purpose-derived identifiers for deduplication
 */
export class Kernel {
    // -----------------------------------------------------------------------
    // Primary State
    // -----------------------------------------------------------------------

    /** All active processes keyed by PID. */
    private processTable: Map<number, Process> = new Map();

    /** Monotonically increasing PID counter. */
    private nextPID: number = 1;

    // -----------------------------------------------------------------------
    // Secondary Indexes — O(1) Lookups
    // -----------------------------------------------------------------------

    /** processId → Process. Synchronized in addProcess/removeProcess. */
    private processIdIndex: Map<string, Process> = new Map();

    /** processName → Set<Process>. Synchronized in addProcess/removeProcess. */
    private processNameIndex: Map<string, Set<Process>> = new Map();

    // -----------------------------------------------------------------------
    // Bucketed Priority Queue
    // -----------------------------------------------------------------------

    /**
     * Processes grouped by priority level: priorityBuckets.get(priority) = Process[].
     * Iterated in ascending priority order (0 = highest priority).
     * Replaces O(N log N) Array.prototype.sort() with O(P) bucket walk.
     */
    private priorityBuckets: Map<number, Process[]> = new Map();

    // -----------------------------------------------------------------------
    // O(1) Wake Map
    // -----------------------------------------------------------------------

    /**
     * Maps Game.time tick → Set of PIDs to wake on that tick.
     * Replaces the O(N) shouldWake() full-table scan.
     * Entries are deleted after processing. Stale PIDs (from terminated
     * processes) are harmlessly ignored at wake time.
     */
    private wakeMap: Map<number, Set<number>> = new Map();

    // -----------------------------------------------------------------------
    // Static Registry
    // -----------------------------------------------------------------------

    /** Registry of factories used to reconstruct processes after global reset. */
    private static registry: Map<string, ProcessFactory> = new Map();

    // -----------------------------------------------------------------------
    // Per-Tick State (reused to reduce GC pressure)
    // -----------------------------------------------------------------------

    /**
     * Per-tick CPU usage by process name.
     * Cleared (never reallocated) at the start of each run() call.
     */
    private _cpuProfile: Map<string, number> = new Map();

    /** Current scheduler mode, determined at the start of each run(). */
    private _schedulerMode: SchedulerModeType = SchedulerMode.NORMAL;

    /** Per-tick scheduler diagnostics. Maps are cleared, not reallocated. */
    private _schedulerReport: SchedulerReport = {
        executed: new Map(),
        skipped: new Map(),
        sleeping: 0,
        mode: SchedulerMode.NORMAL,
    };

    /** Whether the kernel is in panic state (bucket < 100). */
    private _panicActive: boolean = false;

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /** Bucket above which burst CPU is allowed (softLimit = tickLimit * 0.95). */
    static readonly BUCKET_NORMAL = 500;

    /** Bucket below which only emergency processes run. */
    private static readonly BUCKET_EMERGENCY = 100;

    /** Maximum priority value allowed in Safe Mode (load shedding). */
    private static readonly SAFE_MODE_MAX_PRIORITY = 2;

    // -----------------------------------------------------------------------
    // Process Registration (static)
    // -----------------------------------------------------------------------

    static registerProcess(name: string, factory: ProcessFactory): void {
        Kernel.registry.set(name, factory);
    }

    // -----------------------------------------------------------------------
    // Process Management
    // -----------------------------------------------------------------------

    addProcess(process: Process): number {
        const pid = this.nextPID++;
        process.pid = pid;
        this.processTable.set(pid, process);

        // --- Secondary indexes ---
        if (process.processId) {
            this.processIdIndex.set(process.processId, process);
        }

        let nameSet = this.processNameIndex.get(process.processName);
        if (!nameSet) {
            nameSet = new Set();
            this.processNameIndex.set(process.processName, nameSet);
        }
        nameSet.add(process);

        // --- Priority bucket ---
        let bucket = this.priorityBuckets.get(process.priority);
        if (!bucket) {
            bucket = [];
            this.priorityBuckets.set(process.priority, bucket);
        }
        bucket.push(process);

        // --- Wake map (if process is sleeping with a timed wake) ---
        if (process.sleepUntil !== null && process.status === ProcessStatus.SLEEP) {
            this.registerWake(pid, process.sleepUntil);
        }

        return pid;
    }

    removeProcess(pid: number): void {
        const process = this.processTable.get(pid);
        if (!process) return;

        this.processTable.delete(pid);

        // --- Secondary indexes ---
        if (process.processId) {
            this.processIdIndex.delete(process.processId);
        }

        const nameSet = this.processNameIndex.get(process.processName);
        if (nameSet) {
            nameSet.delete(process);
            if (nameSet.size === 0) {
                this.processNameIndex.delete(process.processName);
            }
        }

        // --- Priority bucket ---
        const bucket = this.priorityBuckets.get(process.priority);
        if (bucket) {
            const idx = bucket.indexOf(process);
            if (idx !== -1) bucket.splice(idx, 1);
            if (bucket.length === 0) {
                this.priorityBuckets.delete(process.priority);
            }
        }

        // Note: wakeMap entries are NOT cleaned here. Stale PIDs are
        // harmlessly ignored at wake time since we verify processTable membership.
    }

    getProcess(pid: number): Process | undefined {
        return this.processTable.get(pid);
    }

    /** O(1) lookup by stable, purpose-derived processId. */
    getProcessById(id: string): Process | undefined {
        return this.processIdIndex.get(id);
    }

    /** O(1) existence check by stable processId. */
    hasProcessId(id: string): boolean {
        return this.processIdIndex.has(id);
    }

    /** O(1) lookup of all processes with the given name. */
    getProcessesByName(name: string): Process[] {
        const set = this.processNameIndex.get(name);
        return set ? Array.from(set) : [];
    }

    get processCount(): number {
        return this.processTable.size;
    }

    // -----------------------------------------------------------------------
    // CPU Profiling & Mode Inspection
    // -----------------------------------------------------------------------

    getCpuProfile(): Map<string, number> {
        return this._cpuProfile;
    }

    getSchedulerMode(): SchedulerModeType {
        return this._schedulerMode;
    }

    getSchedulerReport(): SchedulerReport {
        return this._schedulerReport;
    }

    isPanicActive(): boolean {
        return this._panicActive;
    }

    /** Returns the sorted distinct priority levels from the bucketed queue. */
    getPriorityLevels(): number[] {
        return Array.from(this.priorityBuckets.keys()).sort((a, b) => a - b);
    }

    // -----------------------------------------------------------------------
    // Wake Map Management
    // -----------------------------------------------------------------------

    /** Register a PID to be woken at the given Game.time tick. */
    private registerWake(pid: number, tick: number): void {
        let set = this.wakeMap.get(tick);
        if (!set) {
            set = new Set();
            this.wakeMap.set(tick, set);
        }
        set.add(pid);
    }

    // -----------------------------------------------------------------------
    // Scheduler — 3-tier CPU Governor with coroutines
    // -----------------------------------------------------------------------

    /**
     * Run processes by priority bucket with load shedding, O(1) wake map,
     * dynamic CPU bursting, and generator coroutine support.
     */
    run(): void {
        // --- Reset per-tick state (reuse maps, don't reallocate) ---
        this._cpuProfile.clear();
        this._schedulerReport.executed.clear();
        this._schedulerReport.skipped.clear();
        this._schedulerReport.sleeping = 0;

        // --- 1. Determine scheduler mode ---
        const cpuBucket = Game.cpu.bucket;
        const prevMode = this._schedulerMode;

        if (cpuBucket < Kernel.BUCKET_EMERGENCY) {
            this._schedulerMode = SchedulerMode.EMERGENCY;
        } else if (cpuBucket < Kernel.BUCKET_NORMAL) {
            this._schedulerMode = SchedulerMode.SAFE;
        } else {
            this._schedulerMode = SchedulerMode.NORMAL;
        }

        this._schedulerReport.mode = this._schedulerMode;

        // Log mode transitions
        if (this._schedulerMode !== prevMode) {
            log.warning(
                `Scheduler mode: ${prevMode} → ${this._schedulerMode} (bucket: ${cpuBucket})`
            );
        }

        // --- 2. Kernel panic protocol ---
        if (this._schedulerMode === SchedulerMode.EMERGENCY && !this._panicActive) {
            this.onKernelPanic();
        } else if (this._schedulerMode !== SchedulerMode.EMERGENCY && this._panicActive) {
            this._panicActive = false;
            log.info("Kernel panic cleared — bucket recovering");
        }

        // --- 3. O(1) Wake Map — only process PIDs scheduled to wake NOW ---
        const waking = this.wakeMap.get(Game.time);
        if (waking) {
            for (const pid of waking) {
                const proc = this.processTable.get(pid);
                if (proc && proc.status === ProcessStatus.SLEEP &&
                    proc.sleepUntil !== null && Game.time >= proc.sleepUntil) {
                    proc.resume();
                    log.debug(
                        () => `Process ${proc.processName} (PID ${pid}) woke from timed sleep`
                    );
                }
            }
            this.wakeMap.delete(Game.time);
        }

        // --- 4. Dynamic CPU limits ---
        // When bucket is healthy, burst up to tickLimit. Otherwise clamp to base rate.
        const softLimit = cpuBucket > Kernel.BUCKET_NORMAL
            ? Game.cpu.tickLimit * 0.95   // Burst mode
            : Game.cpu.limit * 0.95;      // Conservative
        const hardLimit = Game.cpu.tickLimit * 0.95; // Absolute safety ceiling

        // --- 5. Execute by priority bucket (ascending order) ---
        const sortedPriorities = Array.from(this.priorityBuckets.keys())
            .sort((a, b) => a - b);

        let aborted = false;

        for (const priority of sortedPriorities) {
            if (aborted) break;

            // Entire-bucket load shedding: skip all processes above threshold
            if (this._schedulerMode === SchedulerMode.EMERGENCY && priority > 0) {
                this.recordBucketSkip(priority);
                continue;
            }
            if (this._schedulerMode === SchedulerMode.SAFE &&
                priority > Kernel.SAFE_MODE_MAX_PRIORITY) {
                this.recordBucketSkip(priority);
                continue;
            }

            const processes = this.priorityBuckets.get(priority);
            if (!processes) continue;

            for (const process of processes) {
                // Hard ceiling — never exceed tickLimit
                if (Game.cpu.getUsed() >= hardLimit) {
                    log.error(
                        `HARD CPU ceiling hit (${Game.cpu.getUsed().toFixed(1)}/${hardLimit.toFixed(1)}), aborting tick`
                    );
                    aborted = true;
                    break;
                }

                // Soft ceiling — normal operations
                if (Game.cpu.getUsed() >= softLimit) {
                    log.warning(
                        `CPU ceiling reached (${Game.cpu.getUsed().toFixed(1)}/${softLimit.toFixed(1)}), deferring remaining`
                    );
                    aborted = true;
                    break;
                }

                // Skip sleeping/dead processes (zero CPU cost)
                if (!process.isAlive()) {
                    if (process.status === ProcessStatus.SLEEP) {
                        this._schedulerReport.sleeping++;
                        // Ensure sleeping processes are registered in the wake map.
                        // This handles processes that called sleep() outside of run()
                        // (e.g., between ticks or during initialization).
                        if (process.sleepUntil !== null) {
                            this.registerWake(process.pid, process.sleepUntil);
                        }
                    }
                    continue;
                }

                // --- Execute with generator coroutine support ---
                const cpuBefore = Game.cpu.getUsed();
                try {
                    if (process.thread) {
                        // Resume existing coroutine
                        const result = process.thread.next();
                        if (result.done) {
                            process.thread = undefined;
                        }
                    } else {
                        // First call — may return void or a Generator
                        const result = process.run();
                        if (result && typeof (result as Generator).next === "function") {
                            process.thread = result as Generator<void, void, unknown>;
                            // Execute first chunk immediately (don't waste a tick)
                            const first = process.thread.next();
                            if (first.done) {
                                process.thread = undefined;
                            }
                        }
                    }
                } catch (e: unknown) {
                    const raw = e instanceof Error ? e.stack ?? e.message : String(e);
                    const mapped = ErrorMapper.mapTrace(raw);
                    console.log(
                        `❌ [Kernel] Process ${process.processName} (PID ${process.pid}) crashed:\n${mapped}`
                    );
                    process.thread = undefined; // Clean up coroutine on crash
                    process.terminate();
                }

                // If the process went to sleep during execution, register wake
                if (process.status === ProcessStatus.SLEEP && process.sleepUntil !== null) {
                    this.registerWake(process.pid, process.sleepUntil);
                }

                const delta = Game.cpu.getUsed() - cpuBefore;
                this.recordExec(process);

                const existing = this._cpuProfile.get(process.processName) ?? 0;
                this._cpuProfile.set(process.processName, existing + delta);
            }
        }

        // Sweep dead processes (cleans all indexes via removeProcess)
        this.sweepDead();
    }

    // -----------------------------------------------------------------------
    // Scheduler helpers
    // -----------------------------------------------------------------------

    /** Record that all alive processes in a priority bucket were skipped. */
    private recordBucketSkip(priority: number): void {
        const bucket = this.priorityBuckets.get(priority);
        if (!bucket) return;
        let count = 0;
        for (const proc of bucket) {
            if (proc.isAlive()) count++;
        }
        if (count > 0) {
            const existing = this._schedulerReport.skipped.get(priority) ?? 0;
            this._schedulerReport.skipped.set(priority, existing + count);
        }
    }

    /** Record that a process was executed. */
    private recordExec(process: Process): void {
        const existing = this._schedulerReport.executed.get(process.priority) ?? 0;
        this._schedulerReport.executed.set(process.priority, existing + 1);
    }

    /** Remove all processes marked DEAD, cleaning up all indexes. */
    private sweepDead(): void {
        const toRemove: number[] = [];
        for (const [pid, process] of this.processTable) {
            if (process.status === ProcessStatus.DEAD) {
                toRemove.push(pid);
            }
        }
        for (const pid of toRemove) {
            this.removeProcess(pid);
        }
    }

    // -----------------------------------------------------------------------
    // Kernel Panic Protocol
    // -----------------------------------------------------------------------

    /**
     * Triggered when bucket drops below BUCKET_EMERGENCY.
     * Sets the panic flag so the main loop can force non-essential creeps to idle.
     */
    private onKernelPanic(): void {
        this._panicActive = true;
        log.error(
            `🚨 KERNEL PANIC — Bucket critically low (${Game.cpu.bucket}). ` +
            `Only priority-0 processes will execute. Non-essential creeps should idle.`
        );
    }

    // -----------------------------------------------------------------------
    // Serialization — persist to Memory across global resets
    // -----------------------------------------------------------------------

    serialize(): void {
        const descriptors: ProcessDescriptor[] = [];
        for (const process of this.processTable.values()) {
            descriptors.push(process.toDescriptor());
        }
        Memory.kernel = {
            ...Memory.kernel,
            processTable: descriptors,
            nextPID: this.nextPID,
        };
    }

    static deserialize(): Kernel {
        const kernel = new Kernel();
        const mem = Memory.kernel;
        if (!mem) {
            return kernel;
        }

        kernel.nextPID = mem.nextPID ?? 1;

        for (const desc of mem.processTable ?? []) {
            const factory = Kernel.registry.get(desc.processName);
            if (!factory) {
                console.log(
                    `[Kernel] Warning: no factory registered for process "${desc.processName}" (PID ${desc.pid}), skipping`
                );
                continue;
            }
            const process = factory(
                desc.pid,
                desc.priority,
                desc.parentPID,
                desc.data
            );
            process.status = desc.status as ProcessStatusType;
            process.processId = desc.processId ?? "";
            process.sleepUntil = desc.sleepUntil ?? null;

            // --- Direct insertion (bypass addProcess to preserve PID) ---
            kernel.processTable.set(desc.pid, process);

            // Secondary indexes
            if (process.processId) {
                kernel.processIdIndex.set(process.processId, process);
            }

            let nameSet = kernel.processNameIndex.get(process.processName);
            if (!nameSet) {
                nameSet = new Set();
                kernel.processNameIndex.set(process.processName, nameSet);
            }
            nameSet.add(process);

            // Priority bucket
            let bucket = kernel.priorityBuckets.get(process.priority);
            if (!bucket) {
                bucket = [];
                kernel.priorityBuckets.set(process.priority, bucket);
            }
            bucket.push(process);

            // Wake map
            if (process.sleepUntil !== null && process.status === ProcessStatus.SLEEP) {
                kernel.registerWake(desc.pid, process.sleepUntil);
            }
        }

        return kernel;
    }

    // -----------------------------------------------------------------------
    // Heap Cache Integration
    // -----------------------------------------------------------------------

    saveToHeap(): void {
        GlobalCache.set("kernel", this);
    }

    static loadFromHeap(): Kernel | undefined {
        return GlobalCache.get<Kernel>("kernel");
    }
}
