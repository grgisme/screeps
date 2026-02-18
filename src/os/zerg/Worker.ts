import { Zerg } from "./Zerg";
// import { Overlord } from "../overlords/Overlord";

export class Worker extends Zerg {
    constructor(creep: Creep) {
        super(creep);
    }

    run(): void {
        if (this.avoidDanger()) return;

        // State machine: Harvest/Refuel <-> Work
        if (this.creep.store.getUsedCapacity() === 0) {
            this.memory.working = false;
        } else if (this.creep.store.getFreeCapacity() === 0) {
            this.memory.working = true;
        }

        if (this.memory.working) {
            this.work();
        } else {
            this.refuel();
        }
    }

    private refuel(): void {
        const room = this.creep.room;

        // 1. Check for Emergency Mode (Room has no energy in spawns/extensions)
        // If energyAvailable is very low, we might need to harvest to restart the colony
        const emergency = room.energyAvailable < 300 && room.find(FIND_MY_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        }).length === 0;

        // 2. Withdraw from Storage/Containers (Standard Logistics)
        if (!emergency) {
            // Priority: Storage -> Container -> Source
            // Actually, if we have a logistics network, we should use it?
            // But Workers are "Universal", they often work in early RCL where logistics is weak.

            // Target Storage
            if (room.storage && room.storage.store.energy > 0) {
                if (this.creep.withdraw(room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.travelTo(room.storage);
                }
                return;
            }

            // Target Containers
            const container = this.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.energy > 0
            });
            if (container) {
                if (this.creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.travelTo(container);
                }
                return;
            }
        }

        // 3. Harvest from Sources (Fallback / Emergency)
        const source = this.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
        if (source) {
            if (this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                this.travelTo(source);
            }
        } else {
            this.creep.say("No Src");
        }
    }

    private work(): void {
        const room = this.creep.room;

        // 1. Emergency Fill (If spawns are empty and we have energy)
        // Only if we are in RCL 1 or critical situation
        if (room.energyAvailable < room.energyCapacityAvailable) {
            // Find closest spawn/extension
            const target = this.pos.findClosestByRange(FIND_MY_STRUCTURES, {
                filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            });
            if (target) {
                if (this.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.travelTo(target);
                }
                return;
            }
        }

        // 2. Build Construction Sites
        const site = this.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
        if (site) {
            if (this.creep.build(site) === ERR_NOT_IN_RANGE) {
                this.travelTo(site);
            }
            return;
        }

        // 3. Repair Critical Structures (Roads, Containers)
        // We iterate to find something damaged
        // Maintain Roads at 90%, Containers at 100%?
        // Let's say roads > 75% is fine.
        const structure = this.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.75) ||
                (s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax)
        });
        if (structure) {
            if (this.creep.repair(structure) === ERR_NOT_IN_RANGE) {
                this.travelTo(structure);
            }
            return;
        }

        // 4. Upgrade Controller (Default)
        if (room.controller) {
            if (this.creep.upgradeController(room.controller) === ERR_NOT_IN_RANGE) {
                this.travelTo(room.controller, 3);
            }
        }
    }
}
