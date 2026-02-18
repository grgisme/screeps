import { Zerg } from "./Zerg";

export class Upgrader extends Zerg {
    constructor(creep: Creep) {
        super(creep);
    }

    run(): void {
        if (this.avoidDanger()) return;

        // State: Harvest/Refuel <-> Upgrade
        if (this.creep.store.energy === 0) {
            this.memory.working = false;
        } else if (this.creep.store.getFreeCapacity() === 0) {
            this.memory.working = true;
        }

        if (this.memory.working) {
            this.upgrade();
        } else {
            this.refuel();
        }
    }

    private refuel(): void {
        const room = this.creep.room;

        // 1. Link (Future optimization)
        // const link = ... if (link) withdraw(link); return;

        // 2. Storage / Containers
        // Prioritize Storage
        if (room.storage && room.storage.store.energy > 0) {
            if (this.creep.withdraw(room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.travelTo(room.storage);
            }
            return;
        }

        // Containers
        const container = this.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.energy > 0
        });
        if (container) {
            if (this.creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.travelTo(container);
            }
            return;
        }

        // 3. Emergency Harvest — "Peasant Mode"
        // If no logistics infrastructure exists, degrade to a harvester
        // rather than standing idle consuming CPU and blocking space.
        const source = this.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
        if (source) {
            this.creep.say("🌾 Pzn");
            if (this.creep.harvest(source) === ERR_NOT_IN_RANGE) {
                this.travelTo(source);
            }
            return;
        }

        this.creep.say("💤");
    }

    private upgrade(): void {
        const controller = this.creep.room.controller;
        if (controller) {
            if (this.creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                this.travelTo(controller, 3);
            }
        }
    }
}
