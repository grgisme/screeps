// ============================================================================
// Main Loop — Entry point for the Screeps OS
// ============================================================================

import { ErrorMapper } from "./utils/ErrorMapper";
import { GlobalCache } from "./utils/GlobalCache";
import { Kernel } from "./kernel/Kernel";
import { Process } from "./kernel/Process";
import { MiningProcess } from "./processes/MiningProcess";
import { UpgradeProcess } from "./processes/UpgradeProcess";
import { SCRIPT_VERSION, SCRIPT_SUMMARY } from "./version";

// -------------------------------------------------------------------------
// Register all process factories (must happen before deserialization)
// -------------------------------------------------------------------------

Kernel.registerProcess(
    "mining",
    (pid, priority, parentPID, data) => {
        const proc = new MiningProcess(
            pid,
            priority,
            parentPID,
            data.sourceId as Id<Source>,
            data.roomName as string,
            (data.targetMiners as number) ?? 1
        );
        return proc;
    }
);

Kernel.registerProcess(
    "upgrade",
    (pid, priority, parentPID, data) => {
        const proc = new UpgradeProcess(
            pid,
            priority,
            parentPID,
            data.roomName as string,
            (data.targetUpgraders as number) ?? 1
        );
        return proc;
    }
);

// -------------------------------------------------------------------------
// Main Loop
// -------------------------------------------------------------------------

export const loop = ErrorMapper.wrapLoop(() => {
    // --- 1. Clean dead creep memory ---
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    // --- 2. Kernel init / restore ---
    const isReset = GlobalCache.isGlobalReset();
    let kernel: Kernel;

    if (isReset) {
        console.log(
            `[OS] Global reset detected — rehydrating kernel (v${SCRIPT_VERSION}: ${SCRIPT_SUMMARY})`
        );
        kernel = Kernel.deserialize();
        kernel.saveToHeap();
    } else {
        const cached = Kernel.loadFromHeap();
        if (cached) {
            kernel = cached;
        } else {
            // Shouldn't normally happen, but recover gracefully
            console.log("[OS] Kernel not in heap — deserializing from Memory");
            kernel = Kernel.deserialize();
            kernel.saveToHeap();
        }
    }

    // --- 3. Bootstrap initial processes if the table is empty ---
    if (kernel.processCount === 0) {
        bootstrapProcesses(kernel);
    }

    // --- 4. Run the scheduler ---
    kernel.run();

    // --- 5. Persist minimal state to Memory ---
    kernel.serialize();
});

// -------------------------------------------------------------------------
// Bootstrap — create initial processes for each owned room
// -------------------------------------------------------------------------

function bootstrapProcesses(kernel: Kernel): void {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) {
            continue;
        }

        console.log(`[OS] Bootstrapping processes for room ${roomName}`);

        // One MiningProcess per source
        const sources = room.find(FIND_SOURCES);
        for (const source of sources) {
            const proc = new MiningProcess(
                0, // PID will be assigned by kernel
                10, // Priority: mining is critical
                null,
                source.id,
                roomName,
                1 // 1 miner per source to start
            );
            kernel.addProcess(proc);
            console.log(
                `[OS]   → MiningProcess for source ${source.id} (PID ${proc.pid})`
            );
        }

        // One UpgradeProcess per room
        const upgrader = new UpgradeProcess(
            0,
            20, // Priority: upgrading is secondary to mining
            null,
            roomName,
            1
        );
        kernel.addProcess(upgrader);
        console.log(`[OS]   → UpgradeProcess (PID ${upgrader.pid})`);
    }
}
