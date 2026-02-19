// ============================================================================
// TransporterOverlord — Manages hauler creeps via the LogisticsNetwork
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Transporter } from "../zerg/Transporter";
import { Zerg } from "../zerg/Zerg";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("TransporterOverlord");

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

            const mem = transporter.memory as any;

            // ── Fix 5: State Machine transitions ──
            if (transporter.store?.getUsedCapacity() === 0) mem.collecting = true;
            if (transporter.store?.getFreeCapacity() === 0) mem.collecting = false;

            if (mem.collecting) {
                const targetId = this.colony.logistics.matchWithdraw(transporter);
                if (targetId) {
                    const target = Game.getObjectById(targetId);
                    if (target && 'amount' in target) {
                        transporter.setTask(new PickupTask(targetId as Id<Resource>));
                    } else {
                        transporter.setTask(new WithdrawTask(targetId as Id<Structure | Tombstone | Ruin>));
                    }
                } else if ((transporter.store?.getUsedCapacity() ?? 0) > 0) {
                    mem.collecting = false; // Nothing to withdraw, go deliver what we have
                }
            }

            // Separate if, not else, so it can pivot in the same tick
            if (!mem.collecting) {
                const targetId = this.colony.logistics.matchTransfer(transporter);
                if (targetId) {
                    transporter.setTask(new TransferTask(targetId as Id<Structure | Creep>));
                } else if ((transporter.store?.getFreeCapacity() ?? 0) > 0) {
                    mem.collecting = true; // Nothing to deliver, go collect more
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

        // Cap max transporters to prevent a queue death-spiral
        const maxTransporters = 3;

        if (transportPower < deficit && this.transporters.length < maxTransporters) {
            // [CARRY, CARRY, MOVE] is optimal 2:1 ratio for moving on roads 
            const template = [CARRY, CARRY, MOVE];

            this.colony.hatchery.enqueue({
                priority: 4,
                bodyTemplate: template,
                overlord: this,
                name: `Transporter_${this.colony.name}_${Game.time}`
            });

            log.info(`Enqueued spawn request. Cap: ${transportPower}, Deficit: ${deficit}.`);
        }
    }

    private calculateTransportDeficit(): number {
        // 1. Calculate Sink Deficit
        let sinkDeficit = 0;
        for (const req of this.colony.logistics.requesters) {
            const target = Game.getObjectById(req.targetId);
            const isBuffer = target && 'structureType' in target &&
                ((target as Structure).structureType === STRUCTURE_STORAGE ||
                    (target as Structure).structureType === STRUCTURE_TERMINAL);

            if (isBuffer) continue; // Ignore infinite sinks

            const incoming = this.colony.logistics.incomingReservations.get(req.targetId) || 0;
            sinkDeficit += Math.max(0, req.amount - incoming);
        }

        // 2. Calculate Source Surplus so haulers spawn for dropped energy
        let sourceSurplus = 0;
        for (const offerId of this.colony.logistics.offerIds) {
            const target = Game.getObjectById(offerId);
            const isBuffer = target && 'structureType' in target &&
                ((target as Structure).structureType === STRUCTURE_STORAGE ||
                    (target as Structure).structureType === STRUCTURE_TERMINAL);

            if (isBuffer) continue; // Ignore infinite sources

            const effectiveAmount = this.colony.logistics.getEffectiveAmount(offerId);
            sourceSurplus += Math.max(0, effectiveAmount);
        }

        // Return whichever demand is higher
        return Math.max(sinkDeficit, sourceSurplus);
    }
}
