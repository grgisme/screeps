// ============================================================================
// TransporterOverlord — Manages hauler creeps via the LogisticsNetwork
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Transporter } from "../zerg/Transporter";
import { Zerg } from "../zerg/Zerg";

export class TransporterOverlord extends Overlord {

    transporters: Transporter[] = [];

    constructor(colony: Colony) {
        super(colony, "transporter");
    }

    init(): void {
        // Cast existing zergs — no re-wrapping (prevents wrapper thrashing)
        this.transporters = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "transporter") as Transporter[];

        // Spawn Logic
        this.wishlistSpawns();
    }

    run(): void {
        // IoC: Colony.run() calls zerg.run() on all zergs.
        // Overlord only assigns tasks here (no direct run calls).
        for (const transporter of this.transporters) {
            if (!transporter.task) {
                // Task assignment will be handled by LogisticsNetwork integration
                // Placeholder: transporters get tasks from the logistics layer
            }
        }
    }

    addZerg(zerg: Zerg): void {
        // Just add to the base zergs array — no re-wrapping
        super.addZerg(zerg);
    }

    private wishlistSpawns(): void {
        const deficit = this.calculateTransportDeficit();
        const transportPower = this.transporters.reduce(
            (sum, z) => sum + (z.store?.getCapacity() ?? 0), 0
        );

        if (transportPower < deficit) {
            const template = [CARRY, MOVE];

            this.colony.hatchery.enqueue({
                priority: 1,
                bodyTemplate: template,
                overlord: this,
                name: `Transporter_${this.colony.name}_${Game.time}`
            });

            console.log(`TransporterOverlord: Enqueued spawn request. Cap: ${transportPower}, Deficit: ${deficit}.`);
        }
    }

    private calculateTransportDeficit(): number {
        let total = 0;
        for (const req of this.colony.logistics.requesters) {
            total += req.amount;
        }
        return total;
    }
}
