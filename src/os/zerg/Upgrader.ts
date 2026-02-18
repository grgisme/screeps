import { Zerg } from "./Zerg";

export class Upgrader extends Zerg {
    constructor(creepName: string) {
        super(creepName);
    }

    run(): void {
        if (!this.isAlive()) return;
        const creep = this.creep!;
        const mem = this.memory!;

        // State: Harvest/Refuel <-> Upgrade
        if (creep.store.energy === 0) {
            mem.working = false;
        } else if (creep.store.getFreeCapacity() === 0) {
            mem.working = true;
        }

        if (mem.working) {
            this.upgrade();
        } else {
            this.refuel();
        }
    }

    private refuel(): void {
        const creep = this.creep!;
        const room = creep.room;

        // 1. Link (Future optimization)
        // const link = ... if (link) withdraw(link); return;

        // 2. Storage / Containers
        // Prioritize Storage
        if (room.storage && room.storage.store.energy > 0) {
            if (creep.withdraw(room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.travelTo(room.storage);
            }
            return;
        }

        // Containers
        const container = this.pos!.findClosestByRange(FIND_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.energy > 0
        });
        if (container) {
            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.travelTo(container);
            }
            return;
        }

        // 3. Emergency Harvest — "Peasant Mode"
        // If no logistics infrastructure exists, degrade to a harvester
        // rather than standing idle consuming CPU and blocking space.
        const source = this.pos!.findClosestByRange(FIND_SOURCES_ACTIVE);
        if (source) {
            creep.say("🌾 Pzn");
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                this.travelTo(source);
            }
            return;
        }

        creep.say("💤");
    }

    private upgrade(): void {
        const creep = this.creep!;
        const controller = creep.room.controller;
        if (controller) {
            if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                this.travelTo(controller, 3);
            }
        }
    }
}
