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
            // Request spawn via Hatchery
            // Priority: High (Logistics is critical) -> Let's say 5? 
            // "Tiers: 1=Critical (Miners/Queens)..." -> Wait, 1 is Highest?
            // "Tiers: 1=Critical (Miners/Queens), 2=Defensive, 3=Economic, 4=Strategic."
            // Logistics is likely Tier 3 (Economic) or 1 (Critical)?
            // Transporters are critical for the colony to function. Let's use Priority 1 or 2.
            // Let's go with 1 for now as without transporters everything dies.

            // Template: [CARRY, CARRY, MOVE] or similar.
            // "Standard 1:1 CARRY:MOVE ratio"
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

    // private generateTransporterBody(): BodyPartConstant[] {
    //     return [];
    // }

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
