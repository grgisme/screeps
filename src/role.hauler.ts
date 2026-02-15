import { pathing } from "./pathing";
import { micro } from "./MicroOptimizations";
import { utilsTargeting } from "./utils.targeting";

export const roleHauler = {
    run: function (creep: Creep) {
        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false;
            delete creep.memory.targetId; // Clear target when switching state
            creep.say('🔄 pickup');
        }
        if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            delete creep.memory.targetId; // Clear target when switching state
            creep.say('🚚 deliver');
        }

        if (creep.memory.working) {
            // Priority delivery targets
            const structures = micro.find(creep.room, FIND_STRUCTURES, {
                filter: (s) => {
                    return (s.structureType === STRUCTURE_SPAWN ||
                        s.structureType === STRUCTURE_EXTENSION ||
                        s.structureType === STRUCTURE_TOWER ||
                        s.structureType === STRUCTURE_STORAGE) &&
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                }
            });

            if (structures.length > 0) {
                // Priority: Spawn > Extension > Tower > Storage
                structures.sort((a, b) => {
                    const weight = (s: Structure) => {
                        if (s.structureType === STRUCTURE_SPAWN) return 1;
                        if (s.structureType === STRUCTURE_EXTENSION) return 2;
                        if (s.structureType === STRUCTURE_TOWER) {
                            return (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 400 ? 3 : 10;
                        }
                        if (s.structureType === STRUCTURE_STORAGE) return 20;
                        return 100;
                    };
                    return weight(a) - weight(b);
                });

                if (creep.transfer(structures[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, structures[0].pos, 1);
                }
            } else {
                // FALLBACK: Deliver to Workers (Upgraders and Builders)
                const workers = micro.find(creep.room, FIND_MY_CREEPS).filter(c =>
                    (c.memory.role === 'upgrader' || c.memory.role === 'builder') &&
                    c.store.getFreeCapacity(RESOURCE_ENERGY) > 20 // At least 20 free space
                );

                if (workers.length > 0) {
                    // Deliver to closest worker
                    const target = creep.pos.findClosestByRange(workers);
                    if (target) {
                        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                            pathing.run(creep, target.pos, 1);
                        }
                    }
                }
            }
        } else {
            // Withdraw Logic - TARGET LOCKING APPLIES HERE

            // Check if we already have a valid target
            if (creep.memory.targetId) {
                const target = Game.getObjectById(creep.memory.targetId) as RoomObject | null;
                // Validate target exists and (if resource/structure) has energy
                let valid = false;
                if (target) {
                    if (target instanceof Resource && target.amount > 0) valid = true;
                    // For container/storage/tombstone check store
                    else if ((target as any).store && (target as any).store[RESOURCE_ENERGY] > 0) valid = true;
                }

                if (valid && target) {
                    if (target instanceof Resource) {
                        if (creep.pickup(target) === ERR_NOT_IN_RANGE) pathing.run(creep, target.pos, 1);
                    } else {
                        if (creep.withdraw(target as Structure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) pathing.run(creep, target.pos, 1);
                    }
                    return; // Continue pursuing this target
                } else {
                    delete creep.memory.targetId; // Target invalid, find new one
                }
            }

            // Find New Target (Unreserved)
            // 1. Dropped Resources (if big enough)
            const dropped = utilsTargeting.findUnreserved(creep, FIND_DROPPED_RESOURCES,
                r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
            ) as Resource;

            if (dropped) {
                creep.memory.targetId = dropped.id;
                if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) pathing.run(creep, dropped.pos, 1);
                return;
            }

            // 2. Containers (Source containers)
            const container = utilsTargeting.findUnreserved(creep, FIND_STRUCTURES,
                s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
            ) as StructureContainer;

            if (container) {
                creep.memory.targetId = container.id;
                if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) pathing.run(creep, container.pos, 1);
                return;
            }

            // Fallback (Idle)
            delete creep.memory.targetId;
            const centerPos = (creep.room.memory as any).planning?.bunkerCenter;
            if (centerPos) {
                pathing.run(creep, new RoomPosition(centerPos.x, centerPos.y, creep.room.name), 3);
            }
        }
    }
};
