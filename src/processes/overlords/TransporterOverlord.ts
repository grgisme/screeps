import { Overlord } from "../../os/processes/Overlord";
import { Colony } from "../../os/Colony";
import { Transporter } from "../../os/zerg/Transporter";
import { Zerg } from "../../os/infrastructure/Zerg";

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
            // Request spawn
            // We need a way to request spawns. Overlord doesn't have it standard yet in this context?
            // "request a new Transporter spawn from the Hatchery."
            // Assuming we have a Hatchery or SpawnOverlord.
            // For now, console log the intent:
            console.log(`TransporterOverlord: Requesting spawn. Cap: ${transportPower}, Deficit: ${deficit}`);

            // TODO: Hook into Colony.hatchery.enqueue(...)
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
