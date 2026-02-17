// ============================================================================
// ProfilerProcess — Real-time CPU & scheduler monitoring
// ============================================================================

import { Process } from "../../kernel/Process";
import { Kernel, SchedulerReport } from "../../kernel/Kernel";
import { GlobalCache } from "../../utils/GlobalCache";

/**
 * Critical process (Priority 0) that tracks cumulative CPU usage per
 * process name over a rolling window and outputs a combined CPU +
 * scheduler report every REPORT_INTERVAL ticks.
 *
 * The Kernel records per-process CPU deltas and scheduler diagnostics
 * during its scheduler run; this process reads and accumulates them.
 */
export class ProfilerProcess extends Process {
    public readonly processName = "profiler";

    /** How often (in ticks) to output a summary. */
    private static readonly REPORT_INTERVAL = 20;

    /** Rolling CPU accumulator by process name (heap-only, not serialized). */
    private cpuAccumulator: Map<string, number> = new Map();

    /** Number of ticks accumulated since last report. */
    private ticksSinceReport: number = 0;

    /** Rolling scheduler report accumulator. */
    private totalSkipped: Map<number, number> = new Map();
    private totalSleeping: number = 0;
    private boostedNames: Set<string> = new Set();

    constructor(
        pid: number,
        priority: number,
        parentPID: number | null = null
    ) {
        super(pid, priority, parentPID);
        this.processId = "profiler:global";
    }

    // -----------------------------------------------------------------------
    // Core Logic
    // -----------------------------------------------------------------------

    run(): void {
        const kernel = GlobalCache.get<Kernel>("kernel");
        if (!kernel) {
            return;
        }

        // Accumulate CPU profile
        const profile = kernel.getCpuProfile();
        for (const [name, cpu] of profile) {
            const existing = this.cpuAccumulator.get(name) ?? 0;
            this.cpuAccumulator.set(name, existing + cpu);
        }

        // Accumulate scheduler report
        const report = kernel.getSchedulerReport();
        this.accumulateSchedulerReport(report);

        this.ticksSinceReport++;

        // Report every N ticks
        if (this.ticksSinceReport >= ProfilerProcess.REPORT_INTERVAL) {
            this.report();
            this.resetAccumulators();
        }
    }

    // -----------------------------------------------------------------------
    // Scheduler Report Accumulation
    // -----------------------------------------------------------------------

    private accumulateSchedulerReport(report: SchedulerReport): void {
        for (const [priority, count] of report.skipped) {
            const existing = this.totalSkipped.get(priority) ?? 0;
            this.totalSkipped.set(priority, existing + count);
        }
        this.totalSleeping += report.sleeping;
        for (const name of report.boosted) {
            this.boostedNames.add(name);
        }
    }

    // -----------------------------------------------------------------------
    // Reporting
    // -----------------------------------------------------------------------

    private report(): void {
        const ticks = this.ticksSinceReport || 1;

        // --- CPU Report ---
        if (this.cpuAccumulator.size > 0) {
            const entries: Array<[string, number]> = [];
            for (const entry of this.cpuAccumulator) {
                entries.push(entry);
            }
            entries.sort((a, b) => b[1] - a[1]);

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

        // --- Scheduler Report ---
        const schedLines: string[] = [];

        if (this.totalSkipped.size > 0) {
            const skippedParts: string[] = [];
            const sortedPriorities = Array.from(this.totalSkipped.keys()).sort((a, b) => a - b);
            for (const priority of sortedPriorities) {
                const count = this.totalSkipped.get(priority)!;
                skippedParts.push(`${count} at priority ${priority}`);
            }
            schedLines.push(`  Skipped: ${skippedParts.join(", ")}`);
        }

        if (this.totalSleeping > 0) {
            schedLines.push(`  Sleeping: ${this.totalSleeping} process-ticks`);
        }

        if (this.boostedNames.size > 0) {
            schedLines.push(`  Boosted: ${Array.from(this.boostedNames).join(", ")}`);
        }

        if (schedLines.length > 0) {
            console.log(
                `<span style='color:#9b59b6'>[Profiler]</span> Scheduler Report (${ticks} ticks):\n` +
                schedLines.join("\n")
            );
        }
    }

    private resetAccumulators(): void {
        this.cpuAccumulator.clear();
        this.totalSkipped.clear();
        this.totalSleeping = 0;
        this.boostedNames.clear();
        this.ticksSinceReport = 0;
    }

    // -----------------------------------------------------------------------
    // Serialization (minimal — accumulators live on heap)
    // -----------------------------------------------------------------------

    serialize(): Record<string, unknown> {
        return {};
    }

    deserialize(_data: Record<string, unknown>): void {
        // No state to restore — accumulators are heap-only
    }
}
