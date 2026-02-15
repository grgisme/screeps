import { pathing } from "./pathing";
import { utilsTargeting } from "./utils.targeting";

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

            // 1. Withdraw from Containers/Storage (Unreserved)
            const container = utilsTargeting.findUnreserved(creep, FIND_STRUCTURES,
                s => (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
                    s.store[RESOURCE_ENERGY] > 50
            ) as StructureContainer;

            if (container) {
                creep.memory.targetId = container.id;
                if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, container.pos, 1);
                }
                return;
            }

            // 2. Harvest (Emergency Fallback) - No locking needed for sources usually
            const sources = creep.room.find(FIND_SOURCES);
            const source = sources[0]; // Simplistic fallback
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                pathing.run(creep, source.pos, 1);
            }
        }
    }
};
