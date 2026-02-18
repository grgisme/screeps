// ============================================================================
// Kernel — Process scheduler with load shedding, priority boosting, and panic
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
    /** bucket > 500 — all processes execute */
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
    /** Process names that received a priority boost this tick */
    boosted: string[];
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
 * Advanced features:
 * - Timed sleep: processes auto-wake after N ticks
 * - Priority boosting: starved processes get temporary priority increases
 * - Kernel panic: emergency protocol when bucket is critically low
 * - Stable processId: purpose-derived identifiers for deduplication
 */
export class Kernel {
    /** All active processes keyed by PID. */
    private processTable: Map<number, Process> = new Map();

    /** Monotonically increasing PID counter. */
    private nextPID: number = 1;

    /** Registry of factories used to reconstruct processes after global reset. */
    private static registry: Map<string, ProcessFactory> = new Map();

    /**
     * Per-tick CPU usage by process name.
     * Accumulated during `run()`, reset at the start of each `run()` call.
     */
    private _cpuProfile: Map<string, number> = new Map();

    /** Current scheduler mode, determined at the start of each `run()`. */
    private _schedulerMode: SchedulerModeType = SchedulerMode.NORMAL;

    /** Per-tick scheduler diagnostics. */
    private _schedulerReport: SchedulerReport = Kernel.emptyReport();

    /**
     * Consecutive ticks each process (by PID) has been skipped by the governor.
     * Reset to 0 when the process actually executes.
     */
    private _skipCounter: Map<number, number> = new Map();

    /** Whether the kernel is in panic state (bucket < 100). */
    private _panicActive: boolean = false;

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /** Bucket above which all processes run. */
    private static readonly BUCKET_NORMAL = 500;
    /** Bucket below which only emergency processes run. */
    private static readonly BUCKET_EMERGENCY = 100;
    /** Maximum priority value allowed in Safe Mode (load shedding). */
    private static readonly SAFE_MODE_MAX_PRIORITY = 2;
    /** Consecutive skips before a process gets priority boosted. */
    private static readonly BOOST_THRESHOLD = 50;

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
        return pid;
    }

    removeProcess(pid: number): void {
        this.processTable.delete(pid);
        this._skipCounter.delete(pid);
    }

    getProcess(pid: number): Process | undefined {
        return this.processTable.get(pid);
    }

    /**
     * Lookup a process by its stable, purpose-derived processId.
     */
    getProcessById(id: string): Process | undefined {
        for (const proc of this.processTable.values()) {
            if (proc.processId === id) {
                return proc;
            }
        }
        return undefined;
    }

    /**
     * Check if a process with the given stable processId exists.
     * Useful for deduplication before spawning a new process.
     */
    hasProcessId(id: string): boolean {
        return this.getProcessById(id) !== undefined;
    }

    getProcessesByName(name: string): Process[] {
        const results: Process[] = [];
        for (const proc of this.processTable.values()) {
            if (proc.processName === name) {
                results.push(proc);
            }
        }
        return results;
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

    /**
     * Returns the set of distinct priority values across all processes.
     */
    getPriorityLevels(): number[] {
        const levels = new Set<number>();
        for (const proc of this.processTable.values()) {
            levels.add(proc.priority);
        }
        return Array.from(levels).sort((a, b) => a - b);
    }

    // -----------------------------------------------------------------------
    // Priority Boosting
    // -----------------------------------------------------------------------

    /**
     * Calculate the effective priority of a process, accounting for
     * starvation prevention. After BOOST_THRESHOLD consecutive skips,
     * the process's effective priority decreases (becomes more urgent)
     * by 1 per threshold interval, clamped to 0.
     */
    getEffectivePriority(process: Process): number {
        const skipCount = this._skipCounter.get(process.pid) ?? 0;
        const boost = Math.floor(skipCount / Kernel.BOOST_THRESHOLD);
        return Math.max(0, process.priority - boost);
    }

    // -----------------------------------------------------------------------
    // Scheduler — 3-tier CPU Governor with boosting and sleep
    // -----------------------------------------------------------------------

    /**
     * Run processes in priority order with load shedding, timed sleep,
     * and priority boosting.
     */
    run(): void {
        // Reset per-tick state
        this._cpuProfile = new Map();
        this._schedulerReport = Kernel.emptyReport();

        // --- 1. Determine scheduler mode ---
        const bucket = Game.cpu.bucket;
        const prevMode = this._schedulerMode;

        if (bucket < Kernel.BUCKET_EMERGENCY) {
            this._schedulerMode = SchedulerMode.EMERGENCY;
        } else if (bucket < Kernel.BUCKET_NORMAL) {
            this._schedulerMode = SchedulerMode.SAFE;
        } else {
            this._schedulerMode = SchedulerMode.NORMAL;
        }

        this._schedulerReport.mode = this._schedulerMode;

        // Log mode transitions
        if (this._schedulerMode !== prevMode) {
            log.warning(
                `Scheduler mode: ${prevMode} → ${this._schedulerMode} (bucket: ${bucket})`
            );
        }

        // --- 2. Kernel panic protocol ---
        if (this._schedulerMode === SchedulerMode.EMERGENCY && !this._panicActive) {
            this.onKernelPanic();
        } else if (this._schedulerMode !== SchedulerMode.EMERGENCY && this._panicActive) {
            this._panicActive = false;
            log.info("Kernel panic cleared — bucket recovering");
        }

        // --- 3. Auto-wake sleeping processes ---
        for (const process of this.processTable.values()) {
            if (process.shouldWake()) {
                process.resume();
                log.info(
                    `Process ${process.processName} (PID ${process.pid}) woke up after sleep`
                );
            }
        }

        // --- 4. Build sorted list using effective priority ---
        const sorted = this.getSortedProcesses();

        // CPU ceilings
        const softLimit = Game.cpu.limit * 0.9;
        const hardLimit = Game.cpu.tickLimit * 0.95;

        for (const process of sorted) {
            // Hard ceiling — never exceed tickLimit (burst)
            if (Game.cpu.getUsed() >= hardLimit) {
                log.error(
                    `HARD CPU ceiling hit (${Game.cpu.getUsed().toFixed(1)}/${hardLimit.toFixed(1)}), aborting tick`
                );
                break;
            }

            // Soft ceiling — normal operations
            if (Game.cpu.getUsed() >= softLimit) {
                log.warning(
                    `CPU ceiling reached (${Game.cpu.getUsed().toFixed(1)}/${softLimit.toFixed(1)}), deferring remaining`
                );
                break;
            }

            // Skip sleeping processes (zero CPU cost)
            if (!process.isAlive()) {
                if (process.status === ProcessStatus.SLEEP) {
                    this._schedulerReport.sleeping++;
                }
                continue;
            }

            // Load shedding — filter by effective priority based on mode
            const effectivePriority = this.getEffectivePriority(process);

            if (this._schedulerMode === SchedulerMode.EMERGENCY) {
                if (effectivePriority > 0) {
                    this.recordSkip(process);
                    continue;
                }
            } else if (this._schedulerMode === SchedulerMode.SAFE) {
                if (effectivePriority > Kernel.SAFE_MODE_MAX_PRIORITY) {
                    this.recordSkip(process);
                    continue;
                }
            }

            // Track if this process was boosted
            if (effectivePriority < process.priority) {
                this._schedulerReport.boosted.push(
                    `${process.processName}:${process.pid} (${process.priority}→${effectivePriority})`
                );
            }

            // Profile: record CPU before and after
            const cpuBefore = Game.cpu.getUsed();
            try {
                process.run();
            } catch (e: unknown) {
                const raw = e instanceof Error ? e.stack ?? e.message : String(e);
                const mapped = ErrorMapper.mapTrace(raw);
                console.log(
                    `<font color='#e74c3c'>[Kernel] Process ${process.processName} (PID ${process.pid}) crashed:</font>\n${mapped}`
                );
                process.terminate();
            }
            const cpuAfter = Game.cpu.getUsed();
            const delta = cpuAfter - cpuBefore;

            // Record execution in report + CPU profile
            this.recordExec(process);

            const existing = this._cpuProfile.get(process.processName) ?? 0;
            this._cpuProfile.set(process.processName, existing + delta);
        }

        // Sweep dead processes
        this.sweepDead();
    }

    // -----------------------------------------------------------------------
    // Scheduler helpers
    // -----------------------------------------------------------------------

    /** Record that a process was skipped (load shedding). */
    private recordSkip(process: Process): void {
        const count = (this._skipCounter.get(process.pid) ?? 0) + 1;
        this._skipCounter.set(process.pid, count);

        const existing = this._schedulerReport.skipped.get(process.priority) ?? 0;
        this._schedulerReport.skipped.set(process.priority, existing + 1);
    }

    /** Record that a process was executed (reset skip counter). */
    private recordExec(process: Process): void {
        this._skipCounter.set(process.pid, 0);

        const existing = this._schedulerReport.executed.get(process.priority) ?? 0;
        this._schedulerReport.executed.set(process.priority, existing + 1);
    }

    /** Returns processes sorted by effective priority (ascending). */
    private getSortedProcesses(): Process[] {
        const procs: Process[] = [];
        for (const process of this.processTable.values()) {
            procs.push(process);
        }
        procs.sort((a, b) => this.getEffectivePriority(a) - this.getEffectivePriority(b));
        return procs;
    }

    /** Remove all processes marked DEAD. */
    private sweepDead(): void {
        const toRemove: number[] = [];
        for (const [pid, process] of this.processTable) {
            if (process.status === ProcessStatus.DEAD) {
                toRemove.push(pid);
            }
        }
        for (const pid of toRemove) {
            this.processTable.delete(pid);
            this._skipCounter.delete(pid);
        }
    }

    /** Create an empty scheduler report. */
    private static emptyReport(): SchedulerReport {
        return {
            executed: new Map(),
            skipped: new Map(),
            sleeping: 0,
            boosted: [],
            mode: SchedulerMode.NORMAL,
        };
    }

    // -----------------------------------------------------------------------
    // Kernel Panic Protocol
    // -----------------------------------------------------------------------

    /**
     * Triggered when bucket drops below BUCKET_EMERGENCY.
     * Logs a critical error and sets the panic flag so the main loop
     * can force non-essential creeps to idle.
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
            kernel.processTable.set(desc.pid, process);
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
