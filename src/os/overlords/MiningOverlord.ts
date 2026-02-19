// ============================================================================
// MiningOverlord — Manages local mining sites and static miners
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Miner } from "../zerg/Miner";
import { HarvestTask } from "../tasks/HarvestTask";
import { RepairTask } from "../tasks/RepairTask";



export class MiningOverlord extends Overlord {
    sites: MiningSite[] = [];
    miners: Miner[] = [];
    // ── FIX 1: Local haulers removed. Handled by TransporterOverlord via LogisticsNetwork.

    constructor(colony: Colony) {
        super(colony, "mining");
    }

    init(): void {
        if (this.sites.length === 0) {
            const room = this.colony.room;
            if (room) {
                const sources = room.find(FIND_SOURCES) as Source[];
                for (const source of sources) {
                    this.sites.push(new MiningSite(this.colony, source.id));
                }
            }
        }

        for (const site of this.sites) {
            site.refreshStructureIds();
            // ── FIX 1: Expose site to Logistics Broker ──
            if (site.source?.pos?.roomName === this.colony.name) {
                site.registerOutputRequests();
            }
        }

        this.miners = this.zergs.filter(z => (z.memory as any)?.role === "miner") as Miner[];

        for (const site of this.sites) {
            this.handleSpawning(site);
        }
    }

    get isSuspended(): boolean {
        const room = this.colony.room;
        return this.sites.every(s => !s.container && !s.link) && !(room?.storage);
    }

    private handleSpawning(site: MiningSite): void {
        const room = this.colony.room;
        if (!room) return;
        if (!site.container && !site.link && !room.storage) return;

        const siteMiners = this.miners.filter(m => (m.memory as any)?.state?.siteId === site.sourceId);
        if (siteMiners.length < 1) {
            // ── FIX 2: 5-WORK Math + 1 CARRY for Static Repair ──
            const capacity = room.energyCapacityAvailable;
            const body = capacity >= 700
                ? [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE] // Optimal Static Miner (700e)
                : (capacity >= 350 ? [WORK, WORK, CARRY, MOVE, MOVE] : [WORK, CARRY, MOVE]); // RCL 1 Fallback (200e)

            this.colony.hatchery.enqueue({
                priority: 100,
                bodyTemplate: body,
                overlord: this,
                name: `miner_${site.sourceId.slice(-4)}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.sourceId } }
            });
        }
    }

    run(): void {
        for (const miner of this.miners) {
            if (!miner.isAlive()) continue;

            const siteId = (miner.memory as any)?.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);
            if (!site) continue;

            // ── FIX 3: Static In-Place Container Repair ──
            const needsRepair = site.container && site.container.hits < site.container.hitsMax - 1000;
            const hasEnergy = (miner.store?.energy ?? 0) > 0;

            if (needsRepair && hasEnergy) {
                miner.setTask(new RepairTask(site.container!.id));
            } else if (!miner.task || miner.task.name === "Repair") {
                if (site.source) miner.setTask(new HarvestTask(site.source.id));
            }
        }
    }
}
