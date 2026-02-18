import { Zerg } from "./Zerg";
import { MatchedRequest } from "../colony/LogisticsNetwork";
import { Overlord } from "../overlords/Overlord";

export class Transporter extends Zerg {

    // Heap-resident task cache (not Memory)
    request: MatchedRequest | null = null;
    overlord: Overlord;

    constructor(creepName: string, overlord: Overlord) {
        super(creepName);
        this.overlord = overlord;
    }

    run(): void {
        if (!this.isAlive()) return;

        if (!this.request) {
            this.idle();
        }

        if (this.request) {
            this.handleRequest();
        }
    }

    private idle(): void {
        const creep = this.creep;
        if (!creep) return;
        const network = this.overlord.colony.logistics;
        const request = network.requestTask(this);
        if (request) {
            this.request = request;
            creep.say("🚛" + request.amount);
            console.log(`Transporter ${this.name} dispatched to ${request.target} (Priority ${request.priority}).`);
        }
    }

    private handleRequest(): void {
        if (!this.request) return;
        const creep = this.creep;
        if (!creep) return;

        // "Repair-on-Transit": Check for road maintenance opportunities
        this.repairRoad();

        // Determine phase based on carry state
        const amountCarried = creep.store[this.request.resourceType];
        const amountNeeded = this.request.amount;

        // State: Picking Up
        if (amountCarried < amountNeeded && creep.store.getFreeCapacity() > 0) {
            const provider = this.request.provider as Structure | Resource;

            // Check visibility
            if (!provider.pos.roomName) {
                this.travelTo(provider.pos);
                return;
            }

            // Action
            if (this.pos!.isNearTo(provider.pos)) {
                if ('store' in provider) {
                    creep.withdraw(provider as Structure, this.request.resourceType, amountNeeded - amountCarried);
                } else if ('amount' in provider) {
                    creep.pickup(provider as Resource);
                }
            } else {
                this.travelTo(provider.pos);
            }
        }
        // State: Delivering
        else {
            const target = this.request.target as Structure;

            if (this.pos!.isNearTo(target.pos)) {
                creep.transfer(target, this.request.resourceType, amountCarried);
                this.request = null;
            } else {
                this.travelTo(target.pos);
            }
        }
    }

    /**
     * Repair road underfoot if damaged.
     * Costs 0 extra CPU for movement, just the repair call check.
     * Requires WORK part and Energy.
     */
    private repairRoad(): void {
        const creep = this.creep;
        if (!creep) return;
        // 1. Check if we have energy and WORK parts
        if (creep.store.energy === 0) return;
        const workParts = creep.body.filter(b => b.type === WORK).length;
        if (workParts === 0) return;

        // 2. Check structure underfoot
        const road = this.pos!.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD);
        if (road && road.hits < road.hitsMax) {
            creep.repair(road);
        }
    }
}
