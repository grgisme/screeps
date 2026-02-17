// ============================================================================
// Main Loop — Entry point for the Screeps OS
// ============================================================================

import { ErrorMapper } from "./utils/ErrorMapper";
import { GlobalCache } from "./utils/GlobalCache";
import { Logger } from "./utils/Logger";
import { Kernel } from "./kernel/Kernel";
import { MiningProcess } from "./processes/MiningProcess";
import { UpgradeProcess } from "./processes/UpgradeProcess";
import { ProfilerProcess } from "./processes/ProfilerProcess";
import { ColonyProcess } from "./os/processes/ColonyProcess";
import { SCRIPT_VERSION, SCRIPT_SUMMARY } from "./version";

const log = new Logger("OS");

// -------------------------------------------------------------------------
// Console Commands — exposed on global for the Screeps console
// -------------------------------------------------------------------------

(globalThis as any).setLogLevel = (level: string): string => {
    Logger.setLevelByName(level);
    return `Log level set to: ${level}`;
};

/**
 * Force an error from deep inside a process-style call stack.
 * Used to verify source map resolution shows the correct .ts file + line.
 */
(globalThis as any).testError = (): string => {
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
                `<span style='color:#e74c3c'>[TEST ERROR]</span> ${mapped}`
            );
            return mapped;
        }
    }
    return "No error caught";
};

// -------------------------------------------------------------------------
// Register all process factories (must happen before deserialization)
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

// -------------------------------------------------------------------------
// Foundation Status Report — printed on every global reset
// -------------------------------------------------------------------------

function printFoundationStatus(kernel: Kernel): void {
    const sourceMapActive = ErrorMapper.isActive();
    const priorityLevels = kernel.getPriorityLevels();
    const mode = kernel.getSchedulerMode();

    // Bundle size: try to read main.js module length
    let bundleSizeKB = "unknown";
    try {
        const mapData = require("main.js.map");
        if (mapData && mapData.mappings) {
            bundleSizeKB = `~${(JSON.stringify(mapData).length / 1024).toFixed(1)}`;
        }
    } catch {
        bundleSizeKB = "N/A";
    }

    const statusLines = [
        `═══════════════════════════════════════════`,
        `  FOUNDATION STATUS (v${SCRIPT_VERSION})`,
        `═══════════════════════════════════════════`,
        `  Source Mapping:  ${sourceMapActive ? "✅ Active" : "❌ Inactive"}`,
        `  Bundle Size:     ${bundleSizeKB} KB`,
        `  Scheduler:       ${priorityLevels.length} priority levels ${JSON.stringify(priorityLevels)}`,
        `  Processes:       ${kernel.processCount} running`,
        `  Bucket:          ${Game.cpu.bucket} / 10000`,
        `  Mode:            ${mode}`,
        `═══════════════════════════════════════════`,
    ];

    console.log(
        `<span style='color:#2ecc71'>${statusLines.join("\n")}</span>`
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

// -------------------------------------------------------------------------
// Kernel Panic — force non-essential creeps to idle
// -------------------------------------------------------------------------

function handleKernelPanic(): void {
    log.error("Kernel panic active — forcing all non-essential creeps to idle");
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        // Only idle non-essential roles (not harvesters/defenders)
        const role = creep.memory.role;
        if (role !== "miner" && role !== "defender") {
            // Clear any movement intent — just sit still
            creep.say("⚠️ IDLE");
        }
    }
}

// -------------------------------------------------------------------------
// Main Loop
// -------------------------------------------------------------------------

import { GlobalManager } from "./core/GlobalManager";
import { SegmentManager } from "./core/memory/SegmentManager";

// ... (existing imports)

export const loop = ErrorMapper.wrapLoop(() => {
    // --- 1. Clean dead creep memory ---
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    // --- 2. Global Manager Init (Warm Start) ---
    GlobalManager.init();

    // --- 3. Kernel init / restore ---
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

    // --- 4. Bootstrap initial processes if the table is empty ---
    if (kernel.processCount === 0) {
        bootstrapProcesses(kernel);
    }

    // --- 5. Ensure profiler process exists ---
    ensureProfiler(kernel);

    // --- 6. Foundation Status on global reset ---
    if (isReset) {
        printFoundationStatus(kernel);
    }

    // --- 7. Run the scheduler ---
    kernel.run();

    // --- 8. Handle kernel panic ---
    if (kernel.isPanicActive()) {
        handleKernelPanic();
    }

    // --- 9. Persist state (Heap-First) ---
    kernel.serialize(); // Updates Kernel memory structure (but implies heap modification)

    // Commit all heap-first managers
    GlobalManager.run();
    SegmentManager.commit(); // Set active segments for next tick

    // Memory Usage Report (Console)
    if (Game.time % 100 === 0) {
        const heapUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const bucket = Game.cpu.bucket;
        console.log(`<span style='color:#a6a6a6'>[System] Heap: ${heapUsed} MB | Bucket: ${bucket}</span>`);
    }
});

// -------------------------------------------------------------------------
// Bootstrap — create initial processes for each owned room
// -------------------------------------------------------------------------

Kernel.registerProcess(
    "colony",
    (pid, priority, parentPID, data) => {
        return new ColonyProcess(pid, priority, parentPID, data.colonyName as string);
    }
);

// ... (existing profiler registration)

// -------------------------------------------------------------------------
// Bootstrap — create initial processes for each owned room
// -------------------------------------------------------------------------

function bootstrapProcesses(kernel: Kernel): void {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) {
            continue;
        }

        const procId = `colony:${roomName}`;
        if (kernel.hasProcessId(procId)) {
            continue;
        }

        const proc = new ColonyProcess(0, 5, null, roomName);
        kernel.addProcess(proc);
        log.info(`→ Bootstrapped ColonyProcess for ${roomName} (PID ${proc.pid})`);
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
