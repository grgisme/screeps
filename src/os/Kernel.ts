/**
 * Kernel - The core OS that manages the process lifecycle.
 *
 * Responsibilities:
 *   1. Boot: Detect global reset, hydrate Heap, restore process table
 *   2. Run: Delegate to Scheduler for priority-based execution
 *   3. Persist: Serialize process table + flush Heap (dirty-bit only)
 *   4. Lifecycle: suspend(), terminate(), spawn()
 *   5. GC: Clean dead creep refs + stale heap data
 *
 * Tick Flow:
 *   memoryManager.init() → heap.hydrate() → kernel.boot()
 *   → scheduler.run() → kernel.persist() → heap.flush()
 */
import { Scheduler } from "./Scheduler";
import { Process, ProcessEntry } from "./Process";
import { memoryManager } from "./memory";
import { heap } from "./Heap";

/** Process factory registry: maps processType → factory function */
type ProcessFactory = (entry?: ProcessEntry) => Process;

/** OS memory structure stored at Memory.os */
interface OSMemory {
    processTable: ProcessEntry[];
    bootTick: number;
    resetCount: number;
}

export class Kernel {
    scheduler: Scheduler;

    /** Registry of factory functions keyed by processType */
    private factories: Map<string, ProcessFactory> = new Map();

    /** Whether the kernel has booted this global lifecycle */
    private booted: boolean = false;

    constructor() {
        this.scheduler = new Scheduler();
    }

    // ─── FACTORY REGISTRATION ──────────────────────────────────────────

    /**
     * Register a process factory by its processType key.
     * The factory receives an optional ProcessEntry for restoration on global reset.
     */
    registerProcess(processType: string, factory: ProcessFactory): void {
        this.factories.set(processType, factory);
    }

    // ─── LIFECYCLE METHODS ─────────────────────────────────────────────

    /**
     * Spawn a new process and register it with the scheduler.
     * If a process with the same PID exists, it is replaced.
     */
    spawn(processType: string, pid?: string, overrideEntry?: Partial<ProcessEntry>): Process | null {
        const factory = this.factories.get(processType);
        if (!factory) {
            console.log(`❌ KERNEL: Unknown processType '${processType}'`);
            return null;
        }

        const entry: ProcessEntry = {
            pid: pid || processType,
            processType,
            priority: 5,
            cpuLimit: 0,
            sleepUntil: 0,
            active: true,
            data: {},
            ...overrideEntry,
        };

        const process = factory(entry);
        this.scheduler.register(process);
        memoryManager.markDirty();
        return process;
    }

    /**
     * Suspend a process for N ticks.
     */
    suspend(pid: string, ticks: number): boolean {
        const process = this.scheduler.get(pid);
        if (!process) {
            console.log(`⚠️ KERNEL: Cannot suspend unknown PID '${pid}'`);
            return false;
        }
        process.suspend(ticks);
        memoryManager.markDirty();
        if (Game.time % 50 === 0) {
            console.log(`💤 KERNEL: Suspended ${process.toString()} for ${ticks} ticks`);
        }
        return true;
    }

    /**
     * Terminate a process, removing it from the scheduler.
     * Also runs GC to clean heap references.
     */
    terminate(pid: string): boolean {
        const process = this.scheduler.get(pid);
        if (!process) {
            console.log(`⚠️ KERNEL: Cannot terminate unknown PID '${pid}'`);
            return false;
        }
        process.active = false;
        this.scheduler.unregister(pid);

        // GC: Clean heap references for this process
        heap.gcProcess(pid);
        memoryManager.markDirty();

        console.log(`🗑️ KERNEL: Terminated ${process.toString()}`);
        return true;
    }

    // ─── BOOT ──────────────────────────────────────────────────────────

    /**
     * Boot the kernel. Called once per global reset.
     * Hydrates the Heap and restores the process table.
     */
    boot(): void {
        if (this.booted) return;

        // Initialize memory (heap-cached)
        memoryManager.init();

        // Hydrate the Heap (volatile caches + persistent state)
        heap.hydrate();

        // Initialize OS memory namespace
        if (!(Memory as any).os) {
            (Memory as any).os = {
                processTable: [],
                bootTick: Game.time,
                resetCount: 0,
            } as OSMemory;
        }
        const osMem: OSMemory = (Memory as any).os;
        osMem.resetCount++;

        console.log(`\n🔧 KERNEL BOOT (Reset #${osMem.resetCount}, Tick ${Game.time})`);

        // Restore from saved process table
        if (osMem.processTable && osMem.processTable.length > 0) {
            console.log(`  📋 Restoring ${osMem.processTable.length} processes from Memory...`);
            let restored = 0;
            let orphaned = 0;

            for (const entry of osMem.processTable) {
                const factory = this.factories.get(entry.processType);
                if (factory) {
                    const process = factory(entry);
                    this.scheduler.register(process);
                    restored++;
                } else {
                    console.log(`  ⚠️ No factory for '${entry.processType}' (PID: ${entry.pid}) — orphaned`);
                    orphaned++;
                }
            }

            console.log(`  ✅ Restored: ${restored}, Orphaned: ${orphaned}`);
        } else {
            // Fresh boot
            console.log(`  🌱 Fresh boot — instantiating ${this.factories.size} processes...`);
            for (const [_processType, factory] of this.factories) {
                const process = factory();
                this.scheduler.register(process);
            }
        }

        this.booted = true;
        console.log(`  📊 Kernel ready. ${this.scheduler.getAll().length} processes.\n`);
    }

    // ─── PERSIST ───────────────────────────────────────────────────────

    /**
     * Serialize process table and flush Heap persistent state.
     * Process table is always updated. Heap flushes only if dirty.
     */
    persist(): void {
        const osMem: OSMemory = (Memory as any).os;
        if (!osMem) return;

        // Always serialize process table (lightweight)
        osMem.processTable = this.scheduler.getAll().map(p => p.serialize());

        // Flush Heap persistent state (dirty-bit gated)
        const heapFlushed = heap.flush();

        // Mark memory dirty so the engine serializes it
        memoryManager.markDirty();
        memoryManager.flush();
    }

    // ─── MAIN TICK ─────────────────────────────────────────────────────

    /**
     * Main tick execution. Called from main.ts inside ErrorMapper + profiler.
     *
     * Flow:
     *   1. Memory init (heap cache, skip JSON.parse)
     *   2. Boot on global reset (hydrate, restore)
     *   3. Execute processes via Scheduler
     *   4. Garbage collection (periodic)
     *   5. Persist (process table + heap flush)
     *   6. Reporting + pixel generation
     */
    run(): void {
        // 1. Memory
        memoryManager.init();

        // 2. Boot (first tick after global reset)
        this.boot();

        // 3. Execute processes
        const stats = this.scheduler.run();

        // 4. Garbage Collection (every 50 ticks)
        if (Game.time % 50 === 0) {
            this.gc();
        }

        // 5. Persist process table + flush Heap
        this.persist();

        // 6. Periodic Scheduler Report (every 100 ticks)
        if (Game.time % 100 === 0) {
            console.log(this.scheduler.getReport());
        }

        // 7. Pixel Generation (Burst Mode)
        if (Game.cpu.bucket >= 10000) {
            Game.cpu.generatePixel();
        }
    }

    // ─── GARBAGE COLLECTION ────────────────────────────────────────────

    /**
     * Run garbage collection:
     *   - Clean dead creep references from the Heap
     *   - Clean stale volatile caches
     */
    private gc(): void {
        // Clean dead creep references
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
                heap.gcCreep(name);
            }
        }

        // Run Heap's internal GC (stale paths, CostMatrices, room objects)
        heap.gc();
    }

    // ─── UTILITIES ─────────────────────────────────────────────────────

    /** Get a process by PID */
    getProcess(pid: string): Process | undefined {
        return this.scheduler.get(pid);
    }

    /** Check if a process exists */
    hasProcess(pid: string): boolean {
        return this.scheduler.has(pid);
    }

    /** Get the Scheduler's last run stats */
    getStats() {
        return this.scheduler.getStats();
    }
}
