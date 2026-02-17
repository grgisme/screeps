import { Overlord } from "./Overlord";
import { Colony } from "../colony/Colony";
import { Transporter } from "../zerg/Transporter";
import { Zerg } from "../zerg/Zerg";

export class TransporterOverlord extends Overlord {

    transporters: Transporter[] = [];

    constructor(colony: Colony) {
        super(colony, "transporter");
    }

    init(): void {
        // Register Transporters
        // Zerg are added via addZerg abstractly, but we need to cast or manage them?
        // Overlord.zergs is generic Zerg[].
        // We can wrap them here or assume they are wrapped.

        // Spawn Logic
        // Calculate Haul Potential vs Deficit
        this.wishlistSpawns();
    }

    run(): void {
        for (const transporter of this.transporters) {
            transporter.run();
        }
    }

    addZerg(zerg: Zerg): void {
        // Convert generic Zerg to Transporter
        const transporter = new Transporter(zerg.creep, this);
        this.transporters.push(transporter);
        super.addZerg(transporter);
    }

    private wishlistSpawns(): void {
        const deficit = this.calculateTransportDeficit();
        const transportPower = this.transporters.reduce((sum, zerg) => sum + zerg.creep.store.getCapacity(), 0);

        // Simple threshold: buffer of 2000 or ratio
        if (transportPower < deficit) {
            const template = [CARRY, MOVE];

            this.colony.hatchery.enqueue({
                priority: 1, // Critical
                bodyTemplate: template,
                overlord: this,
                name: `Transporter_${this.colony.name}_${Game.time}` // Optional name
            });

            console.log(`TransporterOverlord: Enqueued spawn request. Cap: ${transportPower}, Deficit: ${deficit}.`);
        }
    }

    private calculateTransportDeficit(): number {
        // Sum of all requests amount?
        // Access colony logistics
        let total = 0;
        for (const req of this.colony.logistics.requesters) {
            total += req.amount;
        }
        return total;
    }
}
