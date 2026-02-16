import { roleHarvester } from "./role.harvester";
import { micro } from "./MicroOptimizations";
import { managerQueue } from "./manager.queue";

export const managerSpawn = {
    bodyBuilder: function (energy: number, template: BodyPartConstant[] = [WORK, CARRY, MOVE]): BodyPartConstant[] {
        // Special case for Miner Body (if specific template passed, obey it? No, standard builder tries to scale)
        // But for Miners we want exactly 5 WORK 1 MOVE if possible, or scaled up.
        // Actually, let's keep this generic scaler, but improved.
        // Or if the template is [WORK, WORK, WORK, WORK, WORK, MOVE], we just check if we can afford it.
        // Refactored to be more robust:

        let body: BodyPartConstant[] = [];
        const cost = (p: BodyPartConstant[]) => p.reduce((acc, part) => acc + BODYPART_COST[part], 0);

        // If energy is enough for full template, use it?
        // But what if template is small ([WORK, CARRY, MOVE]) and we have 1000 energy? We want to scale.

        const baseCost = cost(template);
        if (energy < baseCost) {
            // Can't even afford one set. Return minimal functional creep or empty?
            // Fallback for emergency: [WORK, CARRY, MOVE] -> 200. 
            // If energy < 200, we are in trouble.
            return [WORK, CARRY, MOVE];
        }

        const maxParts = 50;
        let count = Math.floor(energy / baseCost);

        if (count * template.length > maxParts) {
            count = Math.floor(maxParts / template.length);
        }

        for (let i = 0; i < count; i++) {
            body.push(...template);
        }
        return body;
    },

    run: function (room: Room) {
        const spawn = micro.find(room, FIND_MY_SPAWNS)[0];
        if (!spawn) return;
        if (spawn.spawning) return;

        const creeps = micro.find(room, FIND_MY_CREEPS);

        // Evolve Logic: Check for Containers
        const sources = micro.find(room, FIND_SOURCES);
        let hasContainers = false;
        // Naive check: does ANY source have a container?
        // Better: count how many sources have containers.
        let sourcesWithContainers = 0;
        sources.forEach(s => {
            const con = s.pos.findInRange(FIND_STRUCTURES, 1, { filter: st => st.structureType === STRUCTURE_CONTAINER });
            if (con.length > 0) sourcesWithContainers++;
        });

        if (sourcesWithContainers > 0) {
            hasContainers = true;
        }

        // Roles Count
        const miners = creeps.filter(c => c.memory.role === 'harvester' && c.getActiveBodyparts(WORK) >= 5); // A "Miner" is a harvester with heavy work?
        // Actually, distinct role name 'miner' is cleaner, but user asked to update 'harvester' for static mining.
        // Let's stick to 'harvester' role but change body if containers exist.
        // OR better: use 'miner' role for clarity? 
        // User said: "Switch to Static Miners ... Update manager.spawn ... RCL 1: Maintain Harvesters ... RCL 2+: Switch to Static Miners"
        // And "Update role.harvester.ts ... logic for Container Awareness"
        // This implies the ROLE is still harvester, or we use a new role?
        // "Stop spawning generic Harvesters. Switch to Static Miners" implies new role or new body.
        // Let's use 'miner' role for the 5W1M creep to avoid confusion.

        // Let's use 'miner' and 'hauler'.
        const roleMiners = creeps.filter(c => c.memory.role === 'miner');
        const roleHaulers = creeps.filter(c => c.memory.role === 'hauler');
        const roleHarvesters = creeps.filter(c => c.memory.role === 'harvester'); // Old school
        const roleUpgraders = creeps.filter(c => c.memory.role === 'upgrader');
        const roleBuilders = creeps.filter(c => c.memory.role === 'builder');
        const roleDefenders = creeps.filter(c => c.memory.role === 'defender');

        // Config
        // MAX_MINERS should be number of sources if we are RCL 2+
        let MAX_MINERS = (room.controller && room.controller.level >= 2) ? sources.length : 0;

        // If we have no containers, we might need MORE haulers for drop mining
        let MAX_HAULERS = Math.max(sources.length * 2, roleMiners.length * 2);
        if (hasContainers) {
            // If we have containers, 1-2 per source is usually enough depending on distance
            MAX_HAULERS = Math.max(sourcesWithContainers * 2, roleMiners.length);
        }

        // Critical: Only phase out Harvesters if we have Miners AND Haulers
        // Reduced max harvesters to save energy. 2 per source is plenty if they are just walking.
        // Actually, if we have 0 miners, we NEED harvesters.
        // But 4 is too many if they are small.
        // Let's say: 2 per source (4 total) is MAX, but we only spawn them if energy is full-ish?
        // No, we need them to mine.
        const MAX_HARVESTERS = (roleMiners.length >= sources.length && roleHaulers.length > 0) ? 0 : 4;

        let MAX_UPGRADERS = 1; // Default to 1 (maintenance)
        if (hasContainers || room.storage) {
            // If we have infrastructure, we can support more
            MAX_UPGRADERS = 2; // Or dynamic based on storage level
        }

        const activeConstruction = micro.find(room, FIND_MY_CONSTRUCTION_SITES).length;
        // Dynamic Builders: 1 per 15 sites (was 5).
        let targetBuilders = 0;
        if (activeConstruction > 0) {
            targetBuilders = Math.min(Math.ceil(activeConstruction / 15), 3); // Max 3
        }

        // Cap builders if struggling
        if (!hasContainers && room.energyCapacityAvailable < 550) {
            targetBuilders = Math.min(targetBuilders, 2);
        }

        const MAX_BUILDERS = targetBuilders;


        // --- FORCE SAVE MODE ---
        // If we are RCL 2+ and have extensions, but NO miners, we MUST save 550 energy.
        // Stop spawning small things.
        let forceSave = false;
        if (room.controller && room.controller.level >= 2 && room.energyCapacityAvailable >= 550 && roleMiners.length === 0) {
            // We need a miner.
            // If we have enough harvesters to function (e.g. 2), stop spawning others until we get 550.
            if (roleHarvesters.length >= 2) {
                forceSave = true;
                console.log(`💰 FORCE SAVE: Saving for first Miner (Need 550). Current: ${room.energyAvailable}`);
            }
        }

        // --- Role Rebalancing ---
        if (roleHarvesters.length > MAX_HARVESTERS) {
            const excess = roleHarvesters[0];
            // Prioritize Haulers first!
            if (roleHaulers.length < MAX_HAULERS) {
                excess.memory.role = 'hauler';
                excess.memory.working = false;
                console.log(`♻️ REBALANCING: Converted ${excess.name} from Harvester to Hauler (Shortage).`);
            } else {
                // Then Upgraders
                excess.memory.role = 'upgrader';
                excess.memory.working = false;
                console.log(`♻️ REBALANCING: Converted ${excess.name} from Harvester to Upgrader.`);
            }
        }

        // --- Register Energy Goal for Workers ---
        // What is the next thing we WANT to spawn?
        let nextPriorityCost = 0;
        if (roleHarvesters.length === 0) {
            nextPriorityCost = 200; // Minimal [W,C,M]
        } else if (roleMiners.length < MAX_MINERS) {
            nextPriorityCost = (room.energyCapacityAvailable >= 550) ? 550 : room.energyCapacityAvailable;
        } else if (roleHaulers.length < MAX_HAULERS) {
            nextPriorityCost = room.energyCapacityAvailable * 0.5; // Rough estimate for scaled hauler
        } else if (roleHarvesters.length < MAX_HARVESTERS) {
            nextPriorityCost = 200;
        } else if (roleUpgraders.length < MAX_UPGRADERS) {
            nextPriorityCost = room.energyCapacityAvailable * 0.5;
        }

        managerQueue.setGoal(room.name, nextPriorityCost);

        // --- ROOM STATUS DATA (Internal) ---
        const roomStatus = {
            energy: `${room.energyAvailable}/${room.energyCapacityAvailable}`,
            creeps: creeps.length,
            harvesters: `${roleHarvesters.length}/${MAX_HARVESTERS}`,
            miners: `${roleMiners.length}/${MAX_MINERS}`,
            haulers: `${roleHaulers.length}/${MAX_HAULERS}`,
            upgraders: `${roleUpgraders.length}/${MAX_UPGRADERS}`,
            builders: `${roleBuilders.length}/${MAX_BUILDERS}`,
            defenders: `${roleDefenders.length}`,
            nextGoal: nextPriorityCost,
            forceSave: forceSave
        };
        (room as any)._spawnStatus = roomStatus;

        // --- EMERGENCY DEFENSE PRIORITY ---
        const hostiles = micro.find(room, FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            // Find threatening hostiles (including claimers)
            const isThreat = hostiles.some(c => c.getActiveBodyparts(ATTACK) > 0 ||
                c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                c.getActiveBodyparts(WORK) > 0 ||
                c.getActiveBodyparts(CLAIM) > 0);

            if (isThreat && roleDefenders.length === 0) {
                // Register Goal
                managerQueue.setGoal(room.name, 130); // [ATTACK, MOVE]

                // Automatic Log on threat if cooldown hit
                if (Game.time % 20 === 0) {
                    console.log(this.getQueueReport(room));
                }

                // We need a defender!
                // But only if we have at least 1 harvester so we don't stall.
                if (roleHarvesters.length >= 1) {
                    if (room.energyAvailable >= 130) {
                        console.log(`🛡️ DEFENSE: Spawning emergency defender in ${room.name}!`);
                        const body = this.bodyBuilder(room.energyAvailable, [ATTACK, MOVE]);
                        this.spawnCreep(spawn, body, 'defender');
                        return;
                    } else {
                        (room as any)._spawnPriority = "DEFENDER (Waiting for Energy 130)";
                        return;
                    }
                }
            }
        }

        // Periodic maintenance log
        if (Game.time % 100 === 0) {
            console.log(this.getQueueReport(room));
        }

        // Spawn Logic Priority

        // 1. Critical Recovery (If 0 creeps, spawn simple harvester)
        if (creeps.length === 0) {
            (room as any)._spawnPriority = "HARVESTER (Critical Recovery)";
            this.spawnCreep(spawn, [WORK, CARRY, MOVE], 'harvester');
            return;
        }

        // 1.5. Remote Spawn Requests (High Priority?)
        // ... (Existing code) ... 

        // 2. Miners (High Priority if containers exist OR Force Save)
        // If Force Save is on, we ONLY spawn if we have 550.
        // Actually, we want to try to spawn Miner if we can afford it.
        // If forceSave is true, we skip other roles if we can't afford Miner.

        if (roleMiners.length < MAX_MINERS || (forceSave && roleMiners.length === 0)) {
            (room as any)._spawnPriority = "MINER";
            // Body: 5 WORK, 1 MOVE (550 Energy)
            if (room.energyCapacityAvailable >= 550) {
                if (room.energyAvailable >= 550) {
                    this.spawnCreep(spawn, [WORK, WORK, WORK, WORK, WORK, MOVE], 'miner');
                    return;
                } else {
                    // We can't afford it yet.
                    if (forceSave) return; // WAIT. Do not spawn anything else.
                }
            } else {
                // Sub-optimal miner?
                // Just spawn best possible
                const body = this.bodyBuilder(room.energyAvailable, [WORK, WORK, MOVE]);
                this.spawnCreep(spawn, body, 'miner');
                return;
            }
        }

        if (forceSave) return; // If we are saving for miner and didn't spawn it, STOP here.

        // 3. Haulers (Needed if Miners exist)
        if (roleMiners.length > 0 && roleHaulers.length < MAX_HAULERS) {
            (room as any)._spawnPriority = "HAULER";
            // ... existing ... 

            // Body: CARRY, CARRY, MOVE, MOVE (Ratio 1:1)
            const body = this.bodyBuilder(room.energyAvailable, [CARRY, CARRY, MOVE, MOVE]);
            // Note: bodyBuilder scales this template
            this.spawnCreep(spawn, body, 'hauler');
            return;
        }

        // 4. Harvesters (Fallback for un-contained sources)
        if (roleHarvesters.length < MAX_HARVESTERS) {
            (room as any)._spawnPriority = "HARVESTER";
            const body = this.bodyBuilder(room.energyAvailable, [WORK, CARRY, MOVE]);
            this.spawnCreep(spawn, body, 'harvester');
            return;
        }

        // 5. Upgraders
        // Burst Mode: If energy full, spawn extra upgrader
        const energyFull = room.energyAvailable === room.energyCapacityAvailable;
        const targetUpgraders = energyFull ? MAX_UPGRADERS + 1 : MAX_UPGRADERS;

        if (roleUpgraders.length < targetUpgraders) {
            (room as any)._spawnPriority = "UPGRADER";
            const body = this.bodyBuilder(room.energyAvailable, [WORK, CARRY, MOVE]);
            this.spawnCreep(spawn, body, 'upgrader');
            return;
        }

        // 6. Builders
        if (roleBuilders.length < MAX_BUILDERS) {
            (room as any)._spawnPriority = "BUILDER";
            const body = this.bodyBuilder(room.energyAvailable, [WORK, CARRY, MOVE]);
            this.spawnCreep(spawn, body, 'builder');
            return;
        }
    },

    cost: function (body: BodyPartConstant[]) {
        return body.reduce((acc, part) => acc + BODYPART_COST[part], 0);
    },

    spawnCreep: function (spawn: StructureSpawn, body: BodyPartConstant[], role: string, memoryOverride: any = {}) {
        const name = role + Game.time;
        spawn.spawnCreep(body, name, {
            memory: { role: role, room: spawn.room.name, working: false, state: 0, ...memoryOverride }
        });
    },

    getQueueReport: function (room: Room): string {
        const status = (room as any)._spawnStatus;
        if (!status) return `❌ No spawn data for ${room.name}. Wait 1 tick.`;

        let msg = `\n--- 🏭 SPAWN REPORT: ${room.name} ---\n`;
        msg += `⚡ Energy: ${status.energy} (Goal: ${status.nextGoal}${status.forceSave ? " - FORCE SAVE" : ""})\n`;
        msg += `👥 Population: ${status.creeps} total\n`;
        msg += `   - Harvesters: ${status.harvesters}\n`;
        msg += `   - Miners:     ${status.miners}\n`;
        msg += `   - Haulers:    ${status.haulers}\n`;
        msg += `   - Defenders:  ${status.defenders}\n`;
        msg += `   - Upgraders:  ${status.upgraders}\n`;
        msg += `   - Builders:   ${status.builders}\n`;
        msg += `🎯 Next Priority: ${(room as any)._spawnPriority || "Maintenance"}\n`;
        return msg;
    }
};


