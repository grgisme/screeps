import { pathing } from "./pathing";
import { utilsTargeting } from "./utils.targeting";
import { utilsEnergy } from "./utils.energy";
import { managerSigning } from "./manager.signing";
import { micro } from "./MicroOptimizations";

export const roleUpgrader = {
    run: function (creep: Creep) {
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
                    pathing.run(creep, creep.room.controller.pos, 3);
                }
            }
        } else {
            // Upgraders should NOT harvest if possible. They are "white collar" workers.

            // Check existing target
            if (creep.memory.targetId) {
                const target = Game.getObjectById(creep.memory.targetId) as Structure | null;
                if (target && (target as any).store && (target as any).store[RESOURCE_ENERGY] > 0) {
                    if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        pathing.run(creep, target.pos, 1);
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
                        pathing.run(creep, controllerContainer.pos, 1);
                    }
                    return;
                }
            }

            // 2. Storage (Unreserved)
            if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 100) {
                creep.memory.targetId = creep.room.storage.id;
                if (creep.withdraw(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, creep.room.storage.pos, 1);
                }
                return;
            }

            // 3. Other Non-Source Containers
            const sources = creep.room.find(FIND_SOURCES);
            const container = utilsTargeting.findUnreserved(creep, FIND_STRUCTURES,
                s => s.structureType === STRUCTURE_CONTAINER &&
                    s.store[RESOURCE_ENERGY] > 50 &&
                    sources.every(source => !s.pos.isNearTo(source.pos))
            ) as StructureContainer;

            if (container) {
                creep.memory.targetId = container.id;
                if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, container.pos, 1);
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
                        pathing.run(creep, closest.pos, 1);
                    }
                    return;
                }
            }

            // 5. Harvest (Emergency Fallback)
            const source = sources[0];
            if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
                pathing.run(creep, source.pos, 1);
            }
        }
    }
};
