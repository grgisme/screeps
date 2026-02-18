// ============================================================================
// Main Loop — Entry point for the Screeps OS
// ============================================================================

import { ErrorMapper } from "./kernel/ErrorMapper";
import "./utils/RoomPosition";
import { GlobalCache } from "./kernel/GlobalCache";
import { Logger } from "./utils/Logger";
import { Kernel } from "./kernel/Kernel";
import { MiningProcess } from "./os/processes/MiningProcess";
import { UpgradeProcess } from "./os/processes/UpgradeProcess";
import { ProfilerProcess } from "./os/processes/ProfilerProcess";
import { ColonyProcess } from "./os/processes/ColonyProcess";
import { SCRIPT_VERSION, SCRIPT_SUMMARY } from "./version";
import { TrafficManager } from "./os/infrastructure/TrafficManager";
import { GlobalManager } from "./kernel/GlobalManager";
import { SegmentManager } from "./kernel/memory/SegmentManager";

const log = new Logger("OS");

// -------------------------------------------------------------------------
// Console Commands — exposed on global for the Screeps console
// -------------------------------------------------------------------------

(global as any).setLogLevel = (level: string): string => {
    Logger.setLevelByName(level);
    return `Log level set to: ${level}`;
};

/**
 * Force an error from deep inside a process-style call stack.
 * Used to verify source map resolution shows the correct .ts file + line.
 */
(global as any).testError = (): string => {
    function deepNestedCall(): never {
        throw new Error("TEST: Deliberate error from deeply nested code path");
    }
    function middleLayer(): never {
        return deepNestedCall();
    }
    try {
        middleLayer();
    } catch (e: unknown) {
        if (e instanceof Error) {
            const mapped = ErrorMapper.mapTrace(e.stack ?? e.message);
            console.log(
                `❌ [TEST ERROR] ${mapped}`
            );
            return mapped;
        }
    }
    return "No error caught";
};

/**
 * Full bot reset — wipes Memory, heap, and forces a fresh bootstrap.
 * Run from the Screeps console: resetBot()
 */
(global as any).resetBot = (): string => {
    // Nuke Memory
    for (const key in Memory) {
        delete (Memory as any)[key];
    }
    // Nuke heap
    GlobalCache.clear();
    (global as any)._heap = undefined;
    // Fix #2: Removed dead reference to ColonyProcess.colonies (static registry
    // no longer exists — colonies are tracked by the Kernel's process table).
    return "🔄 Bot reset complete. Fresh bootstrap will run next tick.";
};

// -------------------------------------------------------------------------
// Register ALL process factories (must happen before deserialization)
// Fix #5: Colony registration moved here alongside the others.
// All factories MUST be registered before rehydrateKernel() or
// Kernel.deserialize() can reconstruct processes after a global reset.
// -------------------------------------------------------------------------

Kernel.registerProcess(
    "mining",
    (pid, priority, parentPID, data) => {
        return new MiningProcess(
            pid,
            priority,
            parentPID,
            data.sourceId as Id<Source>,
            data.roomName as string,
            (data.targetMiners as number) ?? 1
        );
    }
);

Kernel.registerProcess(
    "upgrade",
    (pid, priority, parentPID, data) => {
        return new UpgradeProcess(
            pid,
            priority,
            parentPID,
            data.roomName as string,
            (data.targetUpgraders as number) ?? 1
        );
    }
);

Kernel.registerProcess(
    "profiler",
    (pid, priority, parentPID, _data) => {
        return new ProfilerProcess(pid, priority, parentPID);
    }
);

Kernel.registerProcess(
    "colony",
    (pid, priority, parentPID, data) => {
        return new ColonyProcess(pid, priority, parentPID, data.colonyName as string);
    }
);

// -------------------------------------------------------------------------
// Foundation Status Report — printed on every global reset
// Fix #1: Removed require("main.js.map") + JSON.stringify CPU bomb.
// Fix #4: Called AFTER kernel.run() so SchedulerMode is accurate.
// -------------------------------------------------------------------------

function printFoundationStatus(kernel: Kernel): void {
    const sourceMapActive = ErrorMapper.isActive();
    const priorityLevels = kernel.getPriorityLevels();
    const mode = kernel.getSchedulerMode();

    const statusLines = [
        `═══════════════════════════════════════════`,
        `  FOUNDATION STATUS (v${SCRIPT_VERSION})`,
        `═══════════════════════════════════════════`,
        `  Source Mapping:  ${sourceMapActive ? "✅ Active" : "❌ Inactive"}`,
        `  Scheduler:       ${priorityLevels.length} priority levels ${JSON.stringify(priorityLevels)}`,
        `  Processes:       ${kernel.processCount} running`,
        `  Bucket:          ${Game.cpu.bucket} / 10000`,
        `  Mode:            ${mode}`,
        `═══════════════════════════════════════════`,
    ];

    console.log(
        statusLines.join("\n")
    );
}

// -------------------------------------------------------------------------
// Rehydration — restore Kernel from Memory after global reset
// -------------------------------------------------------------------------

function rehydrateKernel(): Kernel {
    log.warning(
        `Rehydrating kernel (v${SCRIPT_VERSION}: ${SCRIPT_SUMMARY})`
    );
    const kernel = Kernel.deserialize();
    kernel.saveToHeap();
    log.info(`Rehydrated ${kernel.processCount} processes from Memory`);
    return kernel;
}

// Fix #3: Deleted handleKernelPanic() entirely.
// The Kernel's 3-tier load shedding already skips all non-critical processes
// in EMERGENCY mode. Skipped processes issue zero intents, so their creeps
// naturally sit still at 0.0 CPU. Manually iterating 100+ creeps to call
// creep.say() during a bucket crisis would actively worsen the death spiral.

// -------------------------------------------------------------------------
// Main Loop
// -------------------------------------------------------------------------

export const loop = ErrorMapper.wrapLoop(() => {
    // --- 1. Clean dead creep memory ---
    // Fix #6: Throttled to once per 100 ticks. Creeps live 1500 ticks;
    // checking every tick wastes CPU on an O(N) iteration that rarely finds
    // anything to clean. 100-tick cadence is more than sufficient.
    if (Game.time % 100 === 0) {
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
            }
        }
    }

    // --- 2. Kernel init / restore ---
    const isReset = GlobalCache.isGlobalReset();
    let kernel: Kernel;

    if (isReset) {
        kernel = rehydrateKernel();
    } else {
        const cached = Kernel.loadFromHeap();
        if (cached) {
            kernel = cached;
        } else {
            log.warning("Kernel not in heap — deserializing from Memory");
            kernel = rehydrateKernel();
        }
    }

    // --- 3. Prune stale colony processes (handles respawn) ---
    pruneStaleColonies(kernel);

    // --- 4. Global Manager — spawn colony processes for owned rooms ---
    GlobalManager.init(kernel);

    // --- 5. Ensure profiler process exists ---
    ensureProfiler(kernel);

    // --- 6. Run the scheduler ---
    kernel.run();

    // --- 7. Foundation Status AFTER kernel.run() ---
    // Fix #4: Moved after kernel.run() so SchedulerMode, processCount,
    // and priority levels reflect the actual state of this tick.
    if (isReset) {
        printFoundationStatus(kernel);
    }

    // --- 8. Run Traffic Manager (Intent Resolution Order) ---
    // Must run AFTER kernel.run() so all process move intents are queued
    // before TrafficManager resolves conflicts and executes moves.
    TrafficManager.run();

    // Fix #3: Removed handleKernelPanic() call. Trust the Kernel's
    // EMERGENCY load shedding — it skips priority > 0 processes, leaving
    // their creeps idle at zero CPU cost.

    // --- 9. Persist state (Heap-First) ---
    kernel.serialize();

    // Commit all heap-first managers
    GlobalManager.run();
    SegmentManager.commit(); // Set active segments for next tick

    // Memory Usage Report (Console)
    if (Game.time % 100 === 0) {
        const heap = Game.cpu.getHeapStatistics?.();
        const heapUsed = heap ? (heap.used_heap_size / 1024 / 1024).toFixed(2) : "N/A";
        const bucket = Game.cpu.bucket;
        console.log(`⚙️ [System] Heap: ${heapUsed} MB | Bucket: ${bucket}`);
    }
});

// -------------------------------------------------------------------------
// Prune Stale Colonies — detect respawn and remove dead colony processes
// Fix #2: Removed dead reference to ColonyProcess.colonies[colonyName].
// -------------------------------------------------------------------------

function pruneStaleColonies(kernel: Kernel): void {
    const colonyProcs = kernel.getProcessesByName("colony");
    let pruned = 0;

    for (const proc of colonyProcs) {
        const colonyName = (proc as ColonyProcess).colonyName;
        const room = Game.rooms[colonyName];

        // If we can see the room but don't own it, or it has no controller, prune it
        if (room && (!room.controller || !room.controller.my)) {
            log.warning(`Pruning stale colony process for ${colonyName} (no longer owned)`);
            kernel.removeProcess(proc.pid);
            pruned++;
        }
        // If we can't see the room at all, it might be a remote — leave it for now
    }

    if (pruned > 0) {
        log.info(`Pruned ${pruned} stale colony processes`);
    }
}

// -------------------------------------------------------------------------
// Ensure the profiler process is always running
// -------------------------------------------------------------------------

function ensureProfiler(kernel: Kernel): void {
    if (kernel.hasProcessId("profiler:global")) {
        return;
    }

    const proc = new ProfilerProcess(0, 0, null);
    kernel.addProcess(proc);
    log.info(`→ ProfilerProcess (PID ${proc.pid}, priority 0)`);
}
