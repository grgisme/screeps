// ============================================================================
// ProfilerProcess — Real-time CPU usage monitoring
// ============================================================================

import { Process } from "../kernel/Process";
import { Kernel } from "../kernel/Kernel";
import { GlobalCache } from "../utils/GlobalCache";

/**
 * Critical process (Priority 0) that tracks cumulative CPU usage per
 * process name over a rolling window and outputs a summary every
 * REPORT_INTERVAL ticks.
 *
 * The Kernel records per-process CPU deltas during its scheduler run;
 * this process reads those deltas and accumulates them.
 */
export class ProfilerProcess extends Process {
    public readonly processName = "profiler";

    /** How often (in ticks) to output a CPU summary. */
    private static readonly REPORT_INTERVAL = 20;

    /** Rolling CPU accumulator by process name (heap-only, not serialized). */
    private cpuAccumulator: Map<string, number> = new Map();

    /** Number of ticks accumulated since last report. */
    private ticksSinceReport: number = 0;

    constructor(
        pid: number,
        priority: number,
        parentPID: number | null = null
    ) {
        super(pid, priority, parentPID);
    }

    // -----------------------------------------------------------------------
    // Core Logic
    // -----------------------------------------------------------------------

    run(): void {
        // Read CPU profile from the kernel (recorded during this tick's run)
        const kernel = GlobalCache.get<Kernel>("kernel");
        if (!kernel) {
            return;
        }

        const profile = kernel.getCpuProfile();

        // Accumulate deltas
        for (const [name, cpu] of profile) {
            const existing = this.cpuAccumulator.get(name) ?? 0;
            this.cpuAccumulator.set(name, existing + cpu);
        }
        this.ticksSinceReport++;

        // Report every N ticks
        if (this.ticksSinceReport >= ProfilerProcess.REPORT_INTERVAL) {
            this.report();
            this.cpuAccumulator.clear();
            this.ticksSinceReport = 0;
        }
    }

    // -----------------------------------------------------------------------
    // Reporting
    // -----------------------------------------------------------------------

    private report(): void {
        if (this.cpuAccumulator.size === 0) {
            return;
        }

        // Sort by CPU usage descending
        const entries: Array<[string, number]> = [];
        for (const entry of this.cpuAccumulator) {
            entries.push(entry);
        }
        entries.sort((a, b) => b[1] - a[1]);

        // Calculate averages
        const ticks = this.ticksSinceReport || 1;
        const lines: string[] = [];

        for (const [name, total] of entries) {
            const avg = total / ticks;
            lines.push(
                `  ${name}: ${total.toFixed(2)}ms total (${avg.toFixed(2)}ms/tick)`
            );
        }

        const totalCpu = entries.reduce((sum, e) => sum + e[1], 0);
        console.log(
            `<span style='color:#9b59b6'>[Profiler]</span> CPU Report (${ticks} ticks, ${totalCpu.toFixed(2)}ms total):\n` +
            `<span style='color:#9b59b6'>[Profiler]</span> Top CPU Consumers:\n` +
            lines.join("\n")
        );
    }

    // -----------------------------------------------------------------------
    // Serialization (minimal — accumulator lives on heap)
    // -----------------------------------------------------------------------

    serialize(): Record<string, unknown> {
        return {};
    }

    deserialize(_data: Record<string, unknown>): void {
        // No state to restore — accumulator is heap-only
    }
}
