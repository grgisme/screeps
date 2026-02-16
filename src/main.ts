import { managerSpawn } from "./manager.spawn";
import { managerBuilding } from "./manager.building";
import { roleHarvester } from "./role.harvester";
import { roleUpgrader } from "./role.upgrader";
import { roleBuilder } from "./role.builder";
import { reporting } from "./reporting";
import { managerDefense } from "./manager.defense";
import { roleHauler } from "./role.hauler";
import { roleScout } from "./role.scout";
import { managerRemote } from "./manager.remote";
import { managerMarket } from "./manager.market";
import { roleDefender } from "./role.defender";
import { roleReserver } from "./role.reserver";
import { roleClaimer } from "./role.claimer";
import { toolsSimulation } from "./tools.simulation";
import { toolsInspector } from "./tools.inspector";
import { toolsPlanner } from "./tools.planner";
import { managerCPU } from "./manager.cpu";
import { managerMemory } from "./manager.memory";
import { SCRIPT_VERSION, SCRIPT_SUMMARY } from "./version";
import * as profiler from "screeps-profiler";

// Enable profiler
profiler.enable();

// Main Loop
let firstRun = true;

// Tools Initialization (Run once on Global Reset)
const tools = {
    Sim: toolsSimulation,
    Inspect: toolsInspector.inspect,
    Plan: toolsPlanner.plan,
    Status: () => {
        const ownedRooms = Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
        if (ownedRooms.length === 0) return "❌ No owned rooms found.";

        for (const room of ownedRooms) {
            console.log(managerSpawn.getQueueReport(room));
        }
        return "Report generated.";
    },
    Replan: (roomName?: string) => {
        if (!roomName) {
            roomName = Object.keys(Game.rooms).find(n => Game.rooms[n].controller && Game.rooms[n].controller!.my);
        }
        if (!roomName) return "❌ No room name provided.";

        const room = Game.rooms[roomName];
        if (!room) {
            console.log(`❌ Room ${roomName} not found.`);
            return;
        }
        delete (room.memory as any).planning;
        delete (room.memory as any).roadsInitialized;
        (room.memory as any).forceBuildingRun = true;
        console.log(`🔄 REPLAN TRIGGERED for ${roomName}. The Building Manager will run IMMEDIATElY next tick.`);
        return "Replan successful.";
    }
};

// Assign to global
for (const [key, value] of Object.entries(tools)) {
    Object.defineProperty(global, key, {
        value: value,
        configurable: true,
        writable: true
    });
}

export const loop = function () {
    profiler.wrap(() => {
        if (firstRun) {
            console.log(`\n\n>>> 🚨 NEW CODE LOADED / GLOBAL RESET (Tick ${Game.time}) [v${SCRIPT_VERSION} - ${SCRIPT_SUMMARY}] 🚨 <<<\n\n`);

            // Strict Re-Classification of ALL creeps on global reset
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                // Analyze Body
                const workParts = creep.getActiveBodyparts(WORK);
                const carryParts = creep.getActiveBodyparts(CARRY);
                const moveParts = creep.getActiveBodyparts(MOVE);

                let oldRole = creep.memory.role;
                let newRole = oldRole;

                if (workParts >= 5) {
                    newRole = 'miner';
                } else if (workParts > 0 && carryParts > 0) {
                    // Genetic Harvester
                    // If it was called 'miner' before, it is NOT a real miner.
                    if (oldRole === 'miner') {
                        newRole = 'harvester';
                    } else if (!oldRole) {
                        newRole = 'harvester';
                    }
                } else if (carryParts > 0 && workParts === 0) {
                    if (oldRole !== 'hauler') newRole = 'hauler';
                }

                if (newRole !== oldRole) {
                    creep.memory.role = newRole;
                    creep.memory.working = false;
                    delete creep.memory.targetId; // Reset target
                    console.log(`♻️ RECLASSIFIED: ${creep.name} (${oldRole} -> ${newRole}) [W${workParts}C${carryParts}M${moveParts}]`);
                }
            }
            firstRun = false;
        }

        // 1. CPU Management
        managerCPU.init();

        // 2. Memory Cleanup & Sanity
        managerMemory.run();

        // 3. Run Rooms (Managers)
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (room.controller && room.controller.my) {
                // High Priority: Spawn, Defense (Harvest handled by creeps)
                if (managerCPU.shouldRun('spawn')) managerSpawn.run(room);
                managerDefense.run(room); // Always defend!

                // Gated Logic
                if (managerCPU.shouldRun('build')) managerBuilding.run(room);

                managerMarket.run(room);
                reporting.run(room);

                // Remote/Expansion Gating
                if (managerCPU.shouldRun('expansion')) {
                    managerRemote.run([room]);
                }
            }
        }

        // 4. Run Creeps
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];

            // Legacy / Manual Creep Adoption
            if (!creep.memory.role) {
                // ... (Adoption logic omitted for brevity, keeping same)
                const mem = creep.memory as any;
                if (mem.type === 'Miner' || creep.name.startsWith('Miner')) {
                    creep.memory.role = 'miner'; creep.memory.working = false; creep.memory.state = 0;
                } else if (creep.getActiveBodyparts(WORK) > 0) {
                    creep.memory.role = 'harvester'; creep.memory.working = false; creep.memory.state = 0;
                } else {
                    creep.memory.role = 'hauler'; creep.memory.working = false; creep.memory.state = 0;
                }
            }

            // Run roles - CPU GATING?
            // Spawning/Harvesting is critical. Upgrading/Building is not.
            // But individual creep gating is micro-optimization. 
            // Better to let them run but maybe pathing yields?
            // Let's run them all but Pathing will throttle.

            if (creep.memory.role === 'harvester' || creep.memory.role === 'miner') {
                roleHarvester.run(creep);
            } else if (creep.memory.role === 'upgrader') {
                if (managerCPU.shouldRun('upgrading')) roleUpgrader.run(creep);
            } else if (creep.memory.role === 'builder') {
                if (managerCPU.shouldRun('build')) roleBuilder.run(creep);
            } else if (creep.memory.role === 'hauler') {
                roleHauler.run(creep);
            } else if (creep.memory.role === 'scout') {
                if (managerCPU.shouldRun('scout')) roleScout.run(creep);
            } else if (creep.memory.role === 'defender') {
                roleDefender.run(creep);
            } else if (creep.memory.role === 'claimer') {
                roleClaimer.run(creep);
            } else if (creep.memory.role === 'reserver') {
                roleReserver.run(creep);
            }
        }

        // 5. Pixel Generation (Burst Mode Only)
        // User requested: "Exactly 10,000" or just burst?
        // "Since I have the Lifetime Unlock... Only call ... when the bucket is at exactly 10,000"
        if (Game.cpu.bucket >= 10000) {
            Game.cpu.generatePixel();
        }
    });

};
