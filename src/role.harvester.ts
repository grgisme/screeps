import { pathing } from "./pathing";

export const roleHarvester = {
    run: function (creep: Creep) {
        // Static Mining Check
        // If we are a "miner" type (mostly WORK), we just find a source and sit there.
        // Even if role is 'harvester', if we have a container, we act like a miner.

        if (creep.memory.targetId) {
            // Periodic Reassignment (Every 100 ticks)
            if (Game.time % 100 === 0) {
                delete creep.memory.targetId;
            }
        }

        if (!creep.memory.targetId) {
            const sources = creep.room.find(FIND_SOURCES);
            // Distribute: find source with least creeps assigned
            const creeps = creep.room.find(FIND_MY_CREEPS, {
                filter: c => c.memory.role === 'harvester' || c.memory.role === 'miner'
            });

            // Count assignments
            const sourceCounts: { [id: string]: number } = {};
            sources.forEach(s => sourceCounts[s.id] = 0);

            creeps.forEach(c => {
                if (c.memory.targetId && sourceCounts[c.memory.targetId] !== undefined) {
                    sourceCounts[c.memory.targetId]++;
                }
            });

            // Sort sources by count (ascending), then by distance to spawn/controller?
            // Just count is enough for 1-1 split.
            sources.sort((a, b) => sourceCounts[a.id] - sourceCounts[b.id]);

            const source = sources[0];
            creep.memory.targetId = source.id;
        }

        const source = Game.getObjectById(creep.memory.targetId as Id<Source>);
        if (!source) return;

        // Check for container
        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });

        const container = containers.length > 0 ? containers[0] : null;

        if (container) {
            // Static Mining Logic (Container)
            if (!creep.pos.isEqualTo(container.pos)) {
                pathing.run(creep, container.pos, 0);
            } else {
                creep.harvest(source);
                if (creep.store.getFreeCapacity() === 0 && creep.store.getCapacity() > 0) {
                    creep.transfer(container, RESOURCE_ENERGY);
                }
            }
        } else if (creep.memory.role === 'miner') {
            // Static Mining Logic (Drop Mining - No Container yet)
            if (!creep.pos.isNearTo(source.pos)) {
                pathing.run(creep, source.pos, 1);
            } else {
                creep.harvest(source);
                // Drop if full to keep harvesting
                if (creep.store.getFreeCapacity() === 0 && creep.store.getCapacity() > 0) {
                    creep.drop(RESOURCE_ENERGY);
                }
            }
        } else {
            // Old Mobile Logic (RCL 1 Harvester)
            if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
                creep.memory.working = false;
                creep.say('🔄 harvest');
            }
            if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
                creep.memory.working = true;
                creep.say('🚧 deliver');
            }

            if (creep.memory.working) {
                // Delivering
                const targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType === STRUCTURE_EXTENSION ||
                            structure.structureType === STRUCTURE_SPAWN ||
                            structure.structureType === STRUCTURE_TOWER) &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (targets.length > 0) {
                    const res = creep.transfer(targets[0], RESOURCE_ENERGY);
                    if (res === ERR_NOT_IN_RANGE) {
                        pathing.run(creep, targets[0].pos, 1);
                    } else if (res === OK || res === ERR_FULL) {
                        const storeStruct = targets[0] as AnyStoreStructure;
                        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 || (storeStruct.store && storeStruct.store.getFreeCapacity(RESOURCE_ENERGY) === 0)) {
                            creep.memory.working = false;
                            delete creep.memory.targetId; // Re-target after delivery to balance
                        }
                    }
                } else {
                    if (creep.room.controller) {
                        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                            pathing.run(creep, creep.room.controller.pos, 3);
                        }
                    }
                }
            } else {
                // Harvesting
                if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    pathing.run(creep, source.pos, 1);
                }
            }
        }
    }
};
