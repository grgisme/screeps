import { pathing } from "./pathing";
import { utilsTargeting } from "./utils.targeting";
import { utilsEnergy } from "./utils.energy";
import { micro } from "./MicroOptimizations";

export const roleBuilder = {
    run: function (creep: Creep) {
        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false;
            delete creep.memory.targetId; // Clear target on state change
            creep.say('🔄 harvest');
        }
        if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            delete creep.memory.targetId; // Clear target on state change
            creep.say('🚧 build');
        }

        if (creep.memory.working) {
            // Use cached find for construction sites
            const targets = micro.find(creep.room, FIND_CONSTRUCTION_SITES);
            if (targets.length) {
                // Dynamic Priority
                const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
                const isWar = hostiles.length > 0 && !creep.room.controller?.safeMode;

                targets.sort((a, b) => {
                    const priority = (s: ConstructionSite) => {
                        // WAR MODE
                        if (isWar) {
                            if (s.structureType === STRUCTURE_TOWER) return 0;
                            if (s.structureType === STRUCTURE_RAMPART) return 1;
                            if (s.structureType === STRUCTURE_WALL) return 2;
                            if (s.structureType === STRUCTURE_SPAWN) return 3;
                            return 20;
                        }
                        // PEACE MODE
                        if (s.structureType === STRUCTURE_SPAWN) return 0;
                        if (s.structureType === STRUCTURE_EXTENSION) return 1;
                        if (s.structureType === STRUCTURE_CONTAINER) return 2;
                        if (s.structureType === STRUCTURE_STORAGE) return 3;
                        if (s.structureType === STRUCTURE_ROAD) return 4;
                        if (s.structureType === STRUCTURE_TOWER) return 10;
                        return 20;
                    };
                    return priority(a) - priority(b);
                });

                if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, targets[0].pos, 3);
                }
            } else {
                // Idle State: No Construction Sites
                // 1. Repair critical decay (Roads, Containers)
                // Note: Standard find here because of complex filter, but we could cache the list and filter locally
                const structures = micro.find(creep.room, FIND_STRUCTURES);
                const repairs = structures.filter(s =>
                    (s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.8) ||
                    (s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.5)
                );

                if (repairs.length > 0) {
                    // Prioritize lowest health
                    repairs.sort((a, b) => a.hits - b.hits);
                    if (creep.repair(repairs[0]) === ERR_NOT_IN_RANGE) {
                        pathing.run(creep, repairs[0].pos, 2);
                    }
                } else {
                    // 2. Auxiliary Upgrader
                    if (creep.room.controller) {
                        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                            pathing.run(creep, creep.room.controller.pos, 3);
                        }
                    }
                }
            }
        } else {
            // Get Energy - WITH LOCKING

            if (creep.memory.targetId) {
                const target = Game.getObjectById(creep.memory.targetId) as RoomObject | null;
                let valid = false;
                if (target) {
                    if (target instanceof Resource && target.amount > 0) valid = true;
                    else if ((target as any).store && (target as any).store[RESOURCE_ENERGY] > 0) valid = true;
                    // Note: Source also valid if not empty? 
                    else if (target instanceof Source && target.energy > 0) valid = true;
                }

                if (valid && target) {
                    if (target instanceof Resource) {
                        if (creep.pickup(target) === ERR_NOT_IN_RANGE) pathing.run(creep, target.pos, 1);
                    } else if (target instanceof Source) {
                        if (creep.harvest(target) === ERR_NOT_IN_RANGE) pathing.run(creep, target.pos, 1);
                    } else {
                        if (creep.withdraw(target as Structure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) pathing.run(creep, target.pos, 1);
                    }
                    return;
                } else {
                    delete creep.memory.targetId;
                }
            }

            // 1. Dropped
            const dropped = utilsTargeting.findUnreserved(creep, FIND_DROPPED_RESOURCES, filter => filter.resourceType === RESOURCE_ENERGY && filter.amount > 50) as Resource;
            if (dropped) {
                creep.memory.targetId = dropped.id;
                if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) pathing.run(creep, dropped.pos, 1);
                return;
            }
            // 2. Tombstones
            const tomb = utilsTargeting.findUnreserved(creep, FIND_TOMBSTONES, filter => filter.store[RESOURCE_ENERGY] > 0) as Tombstone;
            if (tomb) {
                creep.memory.targetId = tomb.id as any;
                if (creep.withdraw(tomb, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) pathing.run(creep, tomb.pos, 1);
                return;
            }
            // 3. Ruins (Low prio)

            // 1. Storage (Unreserved)
            if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                creep.memory.targetId = creep.room.storage.id;
                if (creep.withdraw(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, creep.room.storage.pos, 1);
                }
                return;
            }

            // 2. Containers (Non-Source)
            const sources = creep.room.find(FIND_SOURCES);
            const container = utilsTargeting.findUnreserved(creep, FIND_STRUCTURES, filter =>
                (filter.structureType === STRUCTURE_CONTAINER) &&
                filter.store[RESOURCE_ENERGY] > 50 &&
                sources.every(source => !filter.pos.isNearTo(source.pos))
            ) as StructureContainer;

            if (container) {
                creep.memory.targetId = container.id;
                if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, container.pos, 1);
                }
                return;
            }

            // 4. Any available Container including Source containers (Fallback)
            const anyContainer = utilsTargeting.findUnreserved(creep, FIND_STRUCTURES, filter =>
                filter.structureType === STRUCTURE_CONTAINER && filter.store[RESOURCE_ENERGY] > 50
            ) as StructureContainer;
            if (anyContainer) {
                creep.memory.targetId = anyContainer.id;
                if (creep.withdraw(anyContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, anyContainer.pos, 1);
                }
                return;
            }

            // 5. Spawn & Extensions (If Surplus)
            if (utilsEnergy.isSurplus(creep.room)) {
                const targets = utilsEnergy.getSurplusStructures(creep.room);
                const closest = creep.pos.findClosestByPath(targets);
                if (closest) {
                    creep.memory.targetId = closest.id;
                    if (creep.withdraw(closest, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        pathing.run(creep, closest.pos, 1);
                    }
                    return;
                }
            }

            // 6. Spawn (Emergency Fallback - when not surplus but we are desperate)
            const spawn = creep.room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN && s.store[RESOURCE_ENERGY] > 250 })[0];
            if (spawn) {
                if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) pathing.run(creep, spawn.pos, 1);
                return;
            }

            // 6. Harvest (Fallback)
            // 6. Harvest (Fallback)
            const source = creep.pos.findClosestByPath(sources) || sources[0];
            // No strict locking on sources? Or yes? 
            // Usually multiple creeps can harvest source. So NO locking on sources.
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                pathing.run(creep, source.pos, 1);
            } else if (creep.harvest(source) === ERR_NOT_ENOUGH_RESOURCES) {
                const otherSource = sources.find(s => s.energy > 0);
                if (otherSource) pathing.run(creep, otherSource.pos, 1);
            }
        }
    }
};
