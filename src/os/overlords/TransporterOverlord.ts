// ============================================================================
// TransporterOverlord — Manages hauler creeps via the LogisticsNetwork
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Transporter } from "../zerg/Transporter";
import { Zerg } from "../zerg/Zerg";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";

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
        for (const transporter of this.transporters) {
            if (!transporter.isAlive() || transporter.task) continue;

            if (transporter.store?.getUsedCapacity() === 0) {
                // Empty hauler — find something to withdraw from
                const targetId = this.colony.logistics.matchWithdraw(transporter);
                if (targetId) {
                    transporter.setTask(new WithdrawTask(targetId as Id<Structure | Tombstone | Ruin>));
                }
            } else {
                // Loaded hauler — find somewhere to deliver to
                const targetId = this.colony.logistics.matchTransfer(transporter);
                if (targetId) {
                    transporter.setTask(new TransferTask(targetId as Id<Structure | Creep>));
                }
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
            const target = Game.getObjectById(req.targetId);
            const isBuffer = target && 'structureType' in target &&
                ((target as Structure).structureType === STRUCTURE_STORAGE ||
                    (target as Structure).structureType === STRUCTURE_TERMINAL);

            if (isBuffer) continue; // Ignore infinite sinks for spawn calculations

            const incoming = this.colony.logistics.incomingReservations.get(req.targetId) || 0;
            total += Math.max(0, req.amount - incoming);
        }
        return total;
    }
}
