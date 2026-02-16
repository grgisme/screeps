/**
 * Process - Abstract base class for all kernel processes.
 *
 * A Process represents a long-running task (room management, mining, hauling, etc.)
 * that the Kernel executes each tick according to its priority.
 *
 * Lifecycle:
 *   - Processes are created by factories on boot or dynamically via Kernel.spawn()
 *   - Each tick, the Scheduler calls run() on eligible processes (sorted by priority)
 *   - Processes can be suspended for N ticks (e.g., waiting for spawn)
 *   - Processes can be terminated (removed from the process table)
 *   - The process table is serialized to Memory for global reset resilience
 *
 * Priority Bands:
 *   0  = CRITICAL  (Defense, Towers — always runs, even under CPU pressure)
 *   1  = HIGH      (Spawning, Mining, Hauling — core economy)
 *   3  = NORMAL    (Building, Upgrading)
 *   5  = LOW       (Market, Reporting)
 *   8  = DEFERRED  (Scouting, Expansion — first to be shed)
 *  10  = IDLE      (Pixel generation, diagnostics)
 */

/** Serializable process state stored in Memory.os.processTable */
export interface ProcessEntry {
    pid: string;
    processType: string;       // Class name / factory key for re-instantiation
    priority: number;
    cpuLimit: number;
    sleepUntil: number;
    active: boolean;
    data: Record<string, any>; // Process-specific state to persist
}

export abstract class Process {
    /** Unique process identifier */
    pid: string;

    /** Factory key used to re-instantiate this process on global reset */
    processType: string;

    /** Execution priority. 0 = Critical, higher = more deferrable */
    priority: number;

    /** Maximum CPU this process may consume per tick (0 = unlimited) */
    cpuLimit: number;

    /** If set, the process will not run until this tick */
    sleepUntil: number;

    /** Whether this process is currently active */
    active: boolean;

    /** CPU used by this process on the current tick (set by Scheduler) */
    lastCpuUsed: number;

    constructor(pid: string, processType: string, priority: number = 5, cpuLimit: number = 0) {
        this.pid = pid;
        this.processType = processType;
        this.priority = priority;
        this.cpuLimit = cpuLimit;
        this.sleepUntil = 0;
        this.active = true;
        this.lastCpuUsed = 0;
    }

    /** Called every tick by the Scheduler (unless sleeping or inactive) */
    abstract run(): void;

    /**
     * Called on global reset to restore heap state from the process entry.
     * Override to restore process-specific data from entry.data.
     */
    init(entry?: ProcessEntry): void {
        if (entry) {
            this.priority = entry.priority;
            this.cpuLimit = entry.cpuLimit;
            this.sleepUntil = entry.sleepUntil;
            this.active = entry.active;
        }
    }

    /** Human-readable identifier for logs */
    abstract toString(): string;

    /** Put this process to sleep for N ticks */
    suspend(ticks: number): void {
        this.sleepUntil = Game.time + ticks;
    }

    /** Check if this process should run this tick */
    shouldRun(): boolean {
        if (!this.active) return false;
        if (this.sleepUntil > Game.time) return false;
        return true;
    }

    /**
     * Serialize this process into a Memory-safe entry.
     * Override getData() to persist process-specific state.
     */
    serialize(): ProcessEntry {
        return {
            pid: this.pid,
            processType: this.processType,
            priority: this.priority,
            cpuLimit: this.cpuLimit,
            sleepUntil: this.sleepUntil,
            active: this.active,
            data: this.getData(),
        };
    }

    /**
     * Override in subclasses to return process-specific data to persist.
     * Must return a plain JSON-serializable object.
     */
    getData(): Record<string, any> {
        return {};
    }
}

/** Standard priority bands */
export const PRIORITY = {
    CRITICAL: 0,
    HIGH: 1,
    NORMAL: 3,
    LOW: 5,
    DEFERRED: 8,
    IDLE: 10,
} as const;
