import { utilsTargeting } from "./utils.targeting";
import { utilsEnergy } from "./utils.energy";
import { trafficManager } from "./movement/TrafficManager";
import { micro } from "./MicroOptimizations";
import { managerSigning } from "./manager.signing";

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
            let targets = micro.find(creep.room, FIND_CONSTRUCTION_SITES);
            if (targets.length) {
                // Dynamic Priority
                const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
                const safeMode = creep.room.controller?.safeMode || 0;
                const towerSite = targets.find(s => s.structureType === STRUCTURE_TOWER);

                // USER REQUEST: Threat Imminent (SafeMode < 2000 + Tower Site exists)
                const isThreatImminent = towerSite && safeMode < 2000;
                const isWar = hostiles.length > 0 && !creep.room.controller?.safeMode;

                if (isThreatImminent && towerSite) {
                    targets = [towerSite]; // FOCUS ALL BUILDERS ON TOWER
                    creep.say('🚨 TOWER!');
                }

                // Center-Out Priority: Structure Type > Distance to Hub (Spawn, Storage, or Controller)
                const hub = creep.room.storage || creep.room.find(FIND_MY_SPAWNS)[0] || creep.room.controller || creep;

                const getPriority = (s: ConstructionSite) => {
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

                targets.sort((a, b) => {
                    const pA = getPriority(a);
                    const pB = getPriority(b);
                    if (pA !== pB) return pA - pB;
                    // Same priority? Closest to hub wins
                    return a.pos.getRangeTo(hub.pos) - b.pos.getRangeTo(hub.pos);
                });

                // STICKY TARGET LOGIC (v2.13 SUPERIOR): 
                // We ONLY switch if our current target is gone or a STRICTLY BETTER priority type appears.
                let target = targets[0];
                if (creep.memory.targetId) {
                    const currentTarget = Game.getObjectById(creep.memory.targetId) as ConstructionSite | null;
                    if (currentTarget && currentTarget instanceof ConstructionSite) {
                        const currentPri = getPriority(currentTarget);
                        const bestPri = getPriority(target);

                        // v2.13 Logic: If current target is HIGHER or EQUAL priority, we KEEP it.
                        // We do NOT switch just because another site of the same priority is closer.
                        if (currentPri <= bestPri) {
                            target = currentTarget;
                        } else {
                            creep.say('📢 Switch!');
                        }
                    }
                }

                creep.memory.targetId = target.id;
                if (creep.build(target) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, target.pos, { range: 3 });
                } else {
                    // Successfully building or in range? Opportunistic sign.
                    managerSigning.run(creep);
                }
            } else {
                // Idle State: No Construction Sites
                // USER REQUEST: Fill newly built Towers if energy is low
                const towers = creep.room.find(FIND_MY_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 200
                }) as StructureTower[];

                if (towers.length > 0) {
                    const target = creep.pos.findClosestByRange(towers);
                    if (target) {
                        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                            trafficManager.travelTo(creep, target.pos, { range: 1 });
                        }
                        return;
                    }
                }

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
                        trafficManager.travelTo(creep, repairs[0].pos, { range: 2 });
                    }
                } else {
                    // 2. Auxiliary Upgrader
                    if (creep.room.controller) {
                        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                            trafficManager.travelTo(creep, creep.room.controller.pos, { range: 3 });
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
                        if (creep.pickup(target) === ERR_NOT_IN_RANGE) trafficManager.travelTo(creep, target.pos, { range: 1 });
                    } else if (target instanceof Source) {
                        if (creep.harvest(target) === ERR_NOT_IN_RANGE) trafficManager.travelTo(creep, target.pos, { range: 1 });
                    } else {
                        if (creep.withdraw(target as Structure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) trafficManager.travelTo(creep, target.pos, { range: 1 });
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
                if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) trafficManager.travelTo(creep, dropped.pos, { range: 1 });
                return;
            }
            // 2. Tombstones
            const tomb = utilsTargeting.findUnreserved(creep, FIND_TOMBSTONES, filter => filter.store[RESOURCE_ENERGY] > 0) as Tombstone;
            if (tomb) {
                creep.memory.targetId = tomb.id as any;
                if (creep.withdraw(tomb, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) trafficManager.travelTo(creep, tomb.pos, { range: 1 });
                return;
            }
            // 3. Ruins (Low prio)

            // 1. Storage (Unreserved)
            if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                creep.memory.targetId = creep.room.storage.id;
                if (creep.withdraw(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, creep.room.storage.pos, { range: 1 });
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
                    trafficManager.travelTo(creep, container.pos, { range: 1 });
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
                    trafficManager.travelTo(creep, anyContainer.pos, { range: 1 });
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
                        trafficManager.travelTo(creep, closest.pos, { range: 1 });
                    }
                    return;
                }
            }

            // 6. Spawn (Emergency Fallback - when not surplus but we are desperate)
            const spawn = creep.room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN && s.store[RESOURCE_ENERGY] > 250 })[0];
            if (spawn) {
                if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) trafficManager.travelTo(creep, spawn.pos, { range: 1 });
                return;
            }

            // 6. Harvest (Fallback)
            // 6. Harvest (Fallback)
            const source = creep.pos.findClosestByPath(sources) || sources[0];
            // No strict locking on sources? Or yes? 
            // Usually multiple creeps can harvest source. So NO locking on sources.
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                trafficManager.travelTo(creep, source.pos, { range: 1 });
            } else if (creep.harvest(source) === ERR_NOT_ENOUGH_RESOURCES) {
                const otherSource = sources.find(s => s.energy > 0);
                if (otherSource) trafficManager.travelTo(creep, otherSource.pos, { range: 1 });
            }
        }
    }
};
