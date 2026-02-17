// ============================================================================
// Kernel — Process scheduler with CPU-aware execution and profiling
// ============================================================================

import { Process } from "./Process";
import { ProcessStatus, ProcessStatusType } from "./ProcessStatus";
import { GlobalCache } from "../utils/GlobalCache";
import { ErrorMapper } from "../utils/ErrorMapper";

/** Factory function signature for restoring a process from a descriptor. */
export type ProcessFactory = (
    pid: number,
    priority: number,
    parentPID: number | null,
    data: Record<string, unknown>
) => Process;

/**
 * The Kernel is the heart of the OS. It maintains a table of live
 * processes, schedules them by priority, and enforces per-tick CPU
 * budgets so the bucket never drains.
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

    // -----------------------------------------------------------------------
    // Process Registration (static)
    // -----------------------------------------------------------------------

    /**
     * Register a factory so the Kernel can reconstruct a process by name
     * after a global reset.
     */
    static registerProcess(name: string, factory: ProcessFactory): void {
        Kernel.registry.set(name, factory);
    }

    // -----------------------------------------------------------------------
    // Process Management
    // -----------------------------------------------------------------------

    /** Add a process to the table and assign it a PID. Returns the new PID. */
    addProcess(process: Process): number {
        const pid = this.nextPID++;
        process.pid = pid;
        this.processTable.set(pid, process);
        return pid;
    }

    /** Remove a process (immediate). */
    removeProcess(pid: number): void {
        this.processTable.delete(pid);
    }

    /** Look up a process by PID. */
    getProcess(pid: number): Process | undefined {
        return this.processTable.get(pid);
    }

    /** Get all processes matching a given name. */
    getProcessesByName(name: string): Process[] {
        const results: Process[] = [];
        for (const proc of this.processTable.values()) {
            if (proc.processName === name) {
                results.push(proc);
            }
        }
        return results;
    }

    /** Returns the number of live processes. */
    get processCount(): number {
        return this.processTable.size;
    }

    // -----------------------------------------------------------------------
    // CPU Profiling
    // -----------------------------------------------------------------------

    /**
     * Returns the per-process CPU profile from the most recent `run()` call.
     * Keys are process names, values are cumulative CPU milliseconds.
     */
    getCpuProfile(): Map<string, number> {
        return this._cpuProfile;
    }

    // -----------------------------------------------------------------------
    // Scheduler
    // -----------------------------------------------------------------------

    /** CPU usage fraction at which the scheduler stops executing processes. */
    private static readonly CPU_CEILING = 0.9;
    /** Bucket threshold below which we skip non-critical work. */
    private static readonly BUCKET_FLOOR = 500;

    /**
     * Run all alive processes in priority order.
     *
     * - Lower `priority` value = executed first.
     * - Each process is wrapped in try/catch so failures are isolated.
     * - Execution halts when CPU usage exceeds the ceiling or bucket is low.
     * - CPU deltas are recorded per process name for the profiler.
     */
    run(): void {
        // Reset CPU profile for this tick
        this._cpuProfile = new Map();

        // Sort processes: lowest priority number first
        const sorted = this.getSortedProcesses();

        // Pre-compute CPU budget for this tick
        const cpuLimit = Game.cpu.limit * Kernel.CPU_CEILING;

        for (const process of sorted) {
            // CPU guard
            if (Game.cpu.getUsed() >= cpuLimit) {
                console.log(
                    `[Kernel] CPU ceiling reached (${Game.cpu.getUsed().toFixed(1)}/${cpuLimit.toFixed(1)}), deferring remaining processes`
                );
                break;
            }

            // Bucket guard
            if (Game.cpu.bucket < Kernel.BUCKET_FLOOR) {
                console.log(
                    `[Kernel] Bucket low (${Game.cpu.bucket}), suspending non-critical work`
                );
                break;
            }

            if (!process.isAlive()) {
                continue;
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

    /** Save the minimal kernel state into `Memory.kernel`. */
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

    /**
     * Restore kernel state from `Memory.kernel`.
     * Requires that all process types have been registered via
     * `Kernel.registerProcess()` before calling this method.
     */
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

    /** Store this kernel instance in the global heap. */
    saveToHeap(): void {
        GlobalCache.set("kernel", this);
    }

    /** Retrieve the cached kernel from the global heap, if available. */
    static loadFromHeap(): Kernel | undefined {
        return GlobalCache.get<Kernel>("kernel");
    }
}
