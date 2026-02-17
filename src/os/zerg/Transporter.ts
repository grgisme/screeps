import { Zerg } from "./Zerg";
import { MatchedRequest } from "../colony/LogisticsNetwork";
import { Overlord } from "../overlords/Overlord";

export class Transporter extends Zerg {

    // Heap-resident task cache (not Memory)
    request: MatchedRequest | null = null;
    overlord: Overlord;

    constructor(creep: Creep, overlord: Overlord) {
        super(creep);
        this.overlord = overlord;
    }

    refresh(): void {
        super.refresh();
        if (this.request) {
            // Check if provider/target still exist
            if (!this.request.target || !this.request.provider) {
                this.request = null;
            }
        }
    }

    run(): void {
        if (!this.request) {
            this.idle();
        }

        if (this.request) {
            this.handleRequest();
        }
    }

    private idle(): void {
        const network = this.overlord.colony.logistics;
        const request = network.requestTask(this);
        if (request) {
            this.request = request;
            this.creep.say("🚛" + request.amount);
            console.log(`Transporter ${this.name} dispatched to ${request.target} (Priority ${request.priority}).`);
        }
    }

    private handleRequest(): void {
        if (!this.request) return;

        // "Repair-on-Transit": Check for road maintenance opportunities
        this.repairRoad();

        // Determine phase based on carry state
        // If we are empty, go to provider.
        // If we are full (or have the amount), go to target.

        const amountCarried = this.creep.store[this.request.resourceType];
        const amountNeeded = this.request.amount;

        // State: Picking Up
        // Condition: We have less than needed AND we are not "full" (conceptual)
        // Actually, simple logic: if we don't have enough to satisfy the request (or capacity), go get it.
        // If we have some, we might deliver partial? 
        // For now, strict: if amountCarried < amountNeeded, go get it.

        if (amountCarried < amountNeeded && this.creep.store.getFreeCapacity() > 0) {
            const provider = this.request.provider as Structure | Resource;

            // Check visibility
            if (!provider.pos.roomName) {
                // Should not happen for local logistics usually, but just travel there
                this.travelTo(provider.pos);
                return;
            }

            // Action
            if (this.pos.isNearTo(provider.pos)) {
                if ('store' in provider) {
                    this.creep.withdraw(provider as Structure, this.request.resourceType, amountNeeded - amountCarried);
                } else if ('amount' in provider) {
                    this.creep.pickup(provider as Resource);
                }
            } else {
                this.travelTo(provider.pos);
            }
        }
        // State: Delivering
        else {
            const target = this.request.target as Structure;

            if (this.pos.isNearTo(target.pos)) {
                this.creep.transfer(target, this.request.resourceType, amountCarried);
                this.request = null; // Assume success for now, or check return code next tick?
                // Ideally, we clear request and ask for new one immediately if CPU allows?
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
        // 1. Check if we have energy and WORK parts
        if (this.creep.store.energy === 0) return;
        const workParts = this.creep.body.filter(b => b.type === WORK).length;
        if (workParts === 0) return;

        // 2. Check structure underfoot
        const road = this.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD);
        if (road && road.hits < road.hitsMax) {
            // Repair it
            // Repair power: 100 hits/tick per WORK part
            // But we only repair if it needs it.
            // Also, we can repair ANY structure in range 3, but "Repair-on-Transit" usually implies
            // the road we are standing on or moving to.
            // Repairing the one we are standing on is safest (range 0).
            const result = this.creep.repair(road);
            if (result === OK) {
                // console.log(`Transporter ${this.name} repaired road at ${this.pos}`);
            }
        }
    }
}
