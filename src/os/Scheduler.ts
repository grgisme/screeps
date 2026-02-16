/**
 * Scheduler - Priority-based process execution with dynamic CPU budgeting.
 *
 * The scheduler implements:
 *   1. Priority Queue: Processes sorted by priority (lower = runs first)
 *   2. Dynamic CPU Budget: Adjusts based on Game.cpu.bucket health
 *   3. Load Shedding: Skips low-priority processes when budget is exceeded
 *   4. Error Isolation: Each process.run() is wrapped in try/catch (the "Sandwich Pattern")
 *   5. Per-process CPU accounting and overrun warnings
 */
import { Process, ProcessEntry } from "./Process";

/** Bucket-based CPU budget tiers */
interface BudgetTier {
    bucketThreshold: number; // If bucket >= this, use this tier
    budgetPct: number;       // Percentage of Game.cpu.limit to use
    label: string;
}

const BUDGET_TIERS: BudgetTier[] = [
    { bucketThreshold: 9000, budgetPct: 0.95, label: 'BURST' },
    { bucketThreshold: 5000, budgetPct: 0.80, label: 'HEALTHY' },
    { bucketThreshold: 2000, budgetPct: 0.60, label: 'RECOVERING' },
    { bucketThreshold: 0, budgetPct: 0.40, label: 'CRITICAL' },
];

export interface SchedulerStats {
    budgetLabel: string;
    budgetCpu: number;
    totalCpuUsed: number;
    processCount: number;
    processesRun: number;
    processesShed: number;
    cpuByProcess: Map<string, number>;
}

export class Scheduler {
    private processes: Map<string, Process> = new Map();
    private lastStats: SchedulerStats | null = null;

    /** Register a process with the scheduler */
    register(process: Process): void {
        this.processes.set(process.pid, process);
    }

    /** Unregister (terminate) a process */
    unregister(pid: string): void {
        this.processes.delete(pid);
    }

    /** Get a process by PID */
    get(pid: string): Process | undefined {
        return this.processes.get(pid);
    }

    /** Get all registered processes */
    getAll(): Process[] {
        return Array.from(this.processes.values());
    }

    /** Check if a process exists */
    has(pid: string): boolean {
        return this.processes.has(pid);
    }

    /**
     * Calculate the CPU budget for this tick based on bucket health.
     * Higher bucket → more aggressive CPU usage.
     */
    private calculateBudget(): { budget: number, label: string } {
        const bucket = Game.cpu.bucket;
        for (const tier of BUDGET_TIERS) {
            if (bucket >= tier.bucketThreshold) {
                return {
                    budget: Game.cpu.limit * tier.budgetPct,
                    label: tier.label,
                };
            }
        }
        // Fallback (should never reach here)
        return { budget: Game.cpu.limit * 0.40, label: 'EMERGENCY' };
    }

    /**
     * Execute all eligible processes in priority order with CPU budgeting.
     *
     * The "Sandwich Pattern":
     *   For each process → measure CPU before → try { run() } catch { log } → measure after
     *
     * Load Shedding:
     *   If total CPU exceeds the dynamic budget, processes with priority > 0 are skipped.
     *   Priority 0 (CRITICAL) processes ALWAYS run regardless of budget.
     */
    run(): SchedulerStats {
        const { budget, label } = this.calculateBudget();
        const tickStart = Game.cpu.getUsed();
        const cpuByProcess = new Map<string, number>();
        let processesRun = 0;
        let processesShed = 0;

        // Sort by priority (lower number = higher priority = runs first)
        const eligible = this.getAll()
            .filter(p => p.shouldRun())
            .sort((a, b) => a.priority - b.priority);

        for (const process of eligible) {
            const cpuSoFar = Game.cpu.getUsed() - tickStart;

            // --- LOAD SHEDDING ---
            // Critical processes (priority 0) ALWAYS run.
            // Everything else gets shed if we've exceeded the budget.
            if (cpuSoFar >= budget && process.priority > 0) {
                processesShed++;
                if (Game.time % 50 === 0) {
                    console.log(`⏭️ SHED: ${process.toString()} [P${process.priority}] (${cpuSoFar.toFixed(1)}/${budget.toFixed(0)} CPU)`);
                }
                continue;
            }

            // --- THE SANDWICH: Error Isolation ---
            const cpuBefore = Game.cpu.getUsed();

            try {
                process.run();
            } catch (e: any) {
                // Error is caught and logged. The process survives.
                // The exception does NOT bubble up to the Kernel.
                const errMsg = e instanceof Error ? (e.stack || e.message) : String(e);
                console.log(`<span style='color:red'>❌ PROCESS CRASH [${process.pid}] ${process.toString()}: ${errMsg}</span>`);
            }

            const cpuAfter = Game.cpu.getUsed();
            const cpuUsed = cpuAfter - cpuBefore;

            process.lastCpuUsed = cpuUsed;
            cpuByProcess.set(process.pid, cpuUsed);
            processesRun++;

            // Per-process CPU limit warning
            if (process.cpuLimit > 0 && cpuUsed > process.cpuLimit) {
                console.log(`⚠️ CPU OVERRUN: ${process.toString()} used ${cpuUsed.toFixed(1)} (limit: ${process.cpuLimit})`);
            }
        }

        this.lastStats = {
            budgetLabel: label,
            budgetCpu: budget,
            totalCpuUsed: Game.cpu.getUsed() - tickStart,
            processCount: this.processes.size,
            processesRun,
            processesShed,
            cpuByProcess,
        };

        return this.lastStats;
    }

    /**
     * Get a formatted CPU usage report for console output.
     */
    getReport(): string {
        if (!this.lastStats) return '--- No scheduler data ---';
        const s = this.lastStats;

        let msg = `\n--- ⚙️ SCHEDULER (Tick ${Game.time}) [${s.budgetLabel}] ---\n`;
        msg += `Budget: ${s.budgetCpu.toFixed(0)} CPU | Used: ${s.totalCpuUsed.toFixed(1)} | Bucket: ${Game.cpu.bucket}\n`;
        msg += `Processes: ${s.processesRun}/${s.processCount} run, ${s.processesShed} shed\n`;

        // Sort by CPU usage descending
        const sorted = Array.from(s.cpuByProcess.entries())
            .sort((a, b) => b[1] - a[1]);

        for (const [pid, cpu] of sorted) {
            const process = this.processes.get(pid);
            const barLen = Math.min(Math.ceil(cpu * 2), 30);
            const bar = '█'.repeat(barLen);
            const pLabel = process ? `[P${process.priority}] ${process.toString()}` : pid;
            msg += `  ${bar} ${cpu.toFixed(1)} CPU — ${pLabel}\n`;
        }

        return msg;
    }

    /** Get the stats from the last run */
    getStats(): SchedulerStats | null {
        return this.lastStats;
    }
}
