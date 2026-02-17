// ============================================================================
// Kernel — Process scheduler with 3-tier CPU governor and profiling
// ============================================================================

import { Process } from "./Process";
import { ProcessStatus, ProcessStatusType } from "./ProcessStatus";
import { GlobalCache } from "../utils/GlobalCache";
import { ErrorMapper } from "../utils/ErrorMapper";
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
// Kernel
// ---------------------------------------------------------------------------

/**
 * The Kernel is the heart of the OS. It maintains a table of live
 * processes, schedules them by priority, and enforces per-tick CPU
 * budgets with a 3-tier load shedding governor.
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

    // -----------------------------------------------------------------------
    // Priority thresholds for load shedding
    // -----------------------------------------------------------------------

    /** Bucket above which all processes run. */
    private static readonly BUCKET_NORMAL = 500;
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
        return pid;
    }

    removeProcess(pid: number): void {
        this.processTable.delete(pid);
    }

    getProcess(pid: number): Process | undefined {
        return this.processTable.get(pid);
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
    // Scheduler — 3-tier CPU Governor
    // -----------------------------------------------------------------------

    /**
     * Run processes in priority order with load shedding.
     *
     * Governor modes:
     * - NORMAL  (bucket ≥ 500): All processes, soft ceiling = cpu.limit * 0.9
     * - SAFE    (bucket < 500): Only priority ≤ 2, soft ceiling = cpu.limit * 0.9
     * - EMERGENCY (bucket < 100): Only priority 0, minimal work
     *
     * Hard ceiling: Game.cpu.tickLimit * 0.95 — never exceed burst limit.
     */
    run(): void {
        // Reset CPU profile for this tick
        this._cpuProfile = new Map();

        // Determine scheduler mode based on bucket level
        const bucket = Game.cpu.bucket;
        const prevMode = this._schedulerMode;

        if (bucket < Kernel.BUCKET_EMERGENCY) {
            this._schedulerMode = SchedulerMode.EMERGENCY;
        } else if (bucket < Kernel.BUCKET_NORMAL) {
            this._schedulerMode = SchedulerMode.SAFE;
        } else {
            this._schedulerMode = SchedulerMode.NORMAL;
        }

        // Log mode transitions
        if (this._schedulerMode !== prevMode) {
            log.warning(
                `Scheduler mode: ${prevMode} → ${this._schedulerMode} (bucket: ${bucket})`
            );
        }

        // Sort processes: lowest priority number first
        const sorted = this.getSortedProcesses();

        // CPU ceilings
        const softLimit = Game.cpu.limit * 0.9;
        const hardLimit = Game.cpu.tickLimit * 0.95;

        let skippedCount = 0;

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

            if (!process.isAlive()) {
                continue;
            }

            // Load shedding — filter by priority based on mode
            if (this._schedulerMode === SchedulerMode.EMERGENCY) {
                if (process.priority > 0) {
                    skippedCount++;
                    continue;
                }
            } else if (this._schedulerMode === SchedulerMode.SAFE) {
                if (process.priority > Kernel.SAFE_MODE_MAX_PRIORITY) {
                    skippedCount++;
                    continue;
                }
            }

            // Profile: record CPU before and after
            const cpuBefore = Game.cpu.getUsed();
            try {
                process.run();
            } catch (e: unknown) {
                const raw = e instanceof Error ? e.stack ?? e.message : String(e);
                const mapped = ErrorMapper.mapTrace(raw);
                console.log(
                    `<span style='color:#e74c3c'>[Kernel] Process ${process.processName} (PID ${process.pid}) crashed:</span>\n${mapped}`
                );
                process.terminate();
            }
            const cpuAfter = Game.cpu.getUsed();
            const delta = cpuAfter - cpuBefore;

            // Accumulate per process name
            const existing = this._cpuProfile.get(process.processName) ?? 0;
            this._cpuProfile.set(process.processName, existing + delta);
        }

        if (skippedCount > 0) {
            log.warning(
                `Load shedding: skipped ${skippedCount} processes (mode: ${this._schedulerMode})`
            );
        }

        // Sweep dead processes
        this.sweepDead();
    }

    /** Returns processes sorted by priority (ascending). */
    private getSortedProcesses(): Process[] {
        const procs: Process[] = [];
        for (const process of this.processTable.values()) {
            procs.push(process);
        }
        procs.sort((a, b) => a.priority - b.priority);
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
        }
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
