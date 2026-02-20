// ============================================================================
// TransporterOverlord — Manages hauler creeps via the LogisticsNetwork
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningOverlord } from "./MiningOverlord";
import { Zerg } from "../zerg/Zerg"; // ── FIX: Import base Zerg
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("TransporterOverlord");

export class TransporterOverlord extends Overlord {

    transporters: Zerg[] = []; // ── FIX: Use base Zerg

    constructor(colony: Colony) {
        super(colony, "transporter");
    }

    init(): void {
        // Cast existing zergs — no re-wrapping (prevents wrapper thrashing)
        this.transporters = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "transporter");

        // Spawn Logic
        this.wishlistSpawns();
    }

    run(): void {
        for (const transporter of this.transporters) {
            if (!transporter.isAlive()) continue;

            // Road Repair-on-Transit
            if (transporter.store?.energy && transporter.store.energy > 0 && transporter.creep?.getActiveBodyparts(WORK)) {
                const road = transporter.pos?.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax);
                if (road) transporter.repair(road);
            }

            if (transporter.task) continue;

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
        const room = this.colony.room;
        if (!room) return;

        // ── Part-Count Balancing (Research-backed) ─────────────────────────
        // Total CARRY parts = Σ(energyPerTick × 2 × distance) / 50
        // per source, summed across all mining sites.
        const miningOverlord = this.colony.overlords
            .find((o: Overlord) => o instanceof MiningOverlord) as MiningOverlord | undefined;

        if (!miningOverlord || miningOverlord.sites.length === 0) return;

        // Only count sites that are actively mined (have container/link)
        const activeSites = miningOverlord.sites.filter(s => s.container || s.link);
        if (activeSites.length === 0) return;

        let totalCarryNeeded = 0;
        for (const site of activeSites) {
            totalCarryNeeded += Math.ceil(site.calculateHaulingPowerNeeded() / 50);
        }

        // Current CARRY capacity across all transporters
        const currentCarry = this.transporters.reduce(
            (sum, z) => sum + (z.creep?.getActiveBodyparts(CARRY) ?? 0), 0
        );

        if (currentCarry >= totalCarryNeeded) return; // Fully staffed

        // ── Road-Aware Body Template ───────────────────────────────────────
        const body = this.buildTransporterBody(room);

        if (body.length === 0) return; // Can't afford minimum body

        // Dynamic cap: how many of this body size fill the CARRY requirement?
        const carryPerCreep = body.filter(p => p === CARRY).length;
        const maxTransporters = Math.ceil(totalCarryNeeded / Math.max(carryPerCreep, 1));

        if (this.transporters.length >= maxTransporters) return;

        this.colony.hatchery.enqueue({
            priority: 90,
            bodyTemplate: body,
            overlord: this,
            name: `Transporter_${this.colony.name}_${Game.time}`,
            memory: { role: "transporter" }
        });

        log.debug(() => `Hauler deficit: ${currentCarry}/${totalCarryNeeded} CARRY. Spawning (${body.length} parts).`);
    }

    /**
     * Build a route-aware transporter body using MiningSite terrain data.
     *
     * Uses cached `roadCoverage` and `hasSwamp` from each MiningSite's
     * actual hauling route (containerPos → spawn/storage), NOT a naive
     * room-wide road count. Data lives in heap, recalculated every 50 ticks.
     *
     * - ≥75% road coverage: [CARRY, CARRY, MOVE] × N + 1 WORK (2:1 ratio + repair)
     * - <75% (plains/swamp): [CARRY, MOVE] × N (1:1 ratio, no WORK)
     */
    private buildTransporterBody(room: Room): BodyPartConstant[] {
        const capacity = room.energyCapacityAvailable;

        // Read route terrain from MiningSite cache (0 CPU — heap data)
        const miningOverlord = this.colony.overlords
            .find((o: Overlord) => o instanceof MiningOverlord) as MiningOverlord | undefined;

        let avgRoadCoverage = 0;
        if (miningOverlord) {
            const activeSites = miningOverlord.sites.filter(s => s.container || s.link);
            if (activeSites.length > 0) {
                const validSites = activeSites.filter(s => s.roadCoverage >= 0);
                if (validSites.length > 0) {
                    avgRoadCoverage = validSites.reduce((sum, s) => sum + s.roadCoverage, 0) / validSites.length;
                }
            }
        }

        const hasGoodRoads = avgRoadCoverage >= 0.75;
        const body: BodyPartConstant[] = [];

        if (hasGoodRoads) {
            // Road mode: 2:1 CARRY:MOVE ratio + 1 WORK for repair-on-transit
            const remaining = capacity - 100; // Reserve 100e for WORK
            const segmentCost = 150; // CARRY(50) + CARRY(50) + MOVE(50)
            const segments = Math.min(Math.floor(remaining / segmentCost), 16);
            if (segments < 1) return [];

            for (let i = 0; i < segments; i++) {
                body.push(CARRY, CARRY, MOVE);
            }
            body.push(WORK); // Single WORK for road repair
        } else {
            // Plains/swamp mode: 1:1 ratio for full speed, no WORK (nothing to repair)
            const segmentCost = 100; // CARRY(50) + MOVE(50)
            const segments = Math.min(Math.floor(capacity / segmentCost), 25);
            if (segments < 1) return [];

            for (let i = 0; i < segments; i++) {
                body.push(CARRY, MOVE);
            }
        }

        return body;
    }
}
