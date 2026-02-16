import { utilsTargeting } from "./utils.targeting";
import { utilsEnergy } from "./utils.energy";
import { managerSigning } from "./manager.signing";
import { trafficManager } from "./movement/TrafficManager";
import { micro } from "./MicroOptimizations";

export const roleUpgrader = {
    run: function (creep: Creep) {
        // --- EMERGENCY PIVOT (v2.15) ---
        const safeMode = creep.room.controller?.safeMode || 0;
        if (safeMode > 0 && safeMode < 1500) {
            const urgentSites = micro.find(creep.room, FIND_MY_CONSTRUCTION_SITES).filter(s =>
                s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_RAMPART
            );

            if (urgentSites.length > 0) {
                creep.memory.role = 'builder';
                delete creep.memory.targetId;
                creep.say('🧱 Pivot!');
                return;
            }
        }

        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false;
            delete creep.memory.targetId; // Clear target
            creep.say('🔄 harvest');
        }
        if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            delete creep.memory.targetId; // Clear target
            creep.say('⚡ upgrade');
        }

        if (creep.memory.working) {
            managerSigning.run(creep); // Opportunistic signing
            if (creep.room.controller) {
                if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, creep.room.controller.pos, { range: 3 });
                }
            }
        } else {
            // Upgraders should NOT harvest if possible. They are "white collar" workers.

            // Check existing target
            if (creep.memory.targetId) {
                const target = Game.getObjectById(creep.memory.targetId) as Structure | null;
                if (target && (target as any).store && (target as any).store[RESOURCE_ENERGY] > 0) {
                    if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        trafficManager.travelTo(creep, target.pos, { range: 1 });
                    }
                    return;
                } else {
                    delete creep.memory.targetId;
                }
            }

            // 1. Controller Container (Nearby)
            if (creep.room.controller) {
                const controllerContainer = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
                })[0] as StructureContainer;

                if (controllerContainer) {
                    creep.memory.targetId = controllerContainer.id;
                    if (creep.withdraw(controllerContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        trafficManager.travelTo(creep, controllerContainer.pos, { range: 1 });
                    }
                    return;
                }
            }

            // 2. Storage (Unreserved)
            if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 100) {
                creep.memory.targetId = creep.room.storage.id;
                if (creep.withdraw(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, creep.room.storage.pos, { range: 1 });
                }
                return;
            }

            // 3. Other Non-Source Containers (With Energy Throttle)
            const sources = creep.room.find(FIND_SOURCES);
            const energyFullPct = creep.room.energyAvailable / creep.room.energyCapacityAvailable;
            const hasUrgentBuild = micro.find(creep.room, FIND_MY_CONSTRUCTION_SITES).length > 0;

            // ENERGY THROTTLE (v2.15): Yield to builders if < 80% energy and things need building
            if (energyFullPct < 0.8 && hasUrgentBuild) {
                if (Game.time % 10 === 0) creep.say('⏳ Throttle');
                return;
            }

            const container = utilsTargeting.findUnreserved(creep, FIND_STRUCTURES,
                s => s.structureType === STRUCTURE_CONTAINER &&
                    s.store[RESOURCE_ENERGY] > 50 &&
                    sources.every(source => !s.pos.isNearTo(source.pos))
            ) as StructureContainer;

            if (container) {
                creep.memory.targetId = container.id;
                if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, container.pos, { range: 1 });
                }
                return;
            }

            // 4. Spawn & Extensions (Surplus)
            if (utilsEnergy.isSurplus(creep.room)) {
                const structures = utilsEnergy.getSurplusStructures(creep.room);
                const closest = creep.pos.findClosestByPath(structures);
                if (closest) {
                    creep.memory.targetId = closest.id;
                    if (creep.withdraw(closest, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        trafficManager.travelTo(creep, closest.pos, { range: 1 });
                    }
                    return;
                }
            }

            // 5. Harvest (Emergency Fallback)
            const source = sources[0];
            if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
                trafficManager.travelTo(creep, source.pos, { range: 1 });
            }
        }
    }
};
