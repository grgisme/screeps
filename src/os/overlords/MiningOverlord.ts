// ============================================================================
// MiningOverlord — Manages local mining sites and static miners
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Miner } from "../zerg/Miner";
import { HarvestTask } from "../tasks/HarvestTask";
import { RepairTask } from "../tasks/RepairTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("MiningOverlord");


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

        // ── Pre-Spawn TTL Replacement ──
        // If a miner exists but its TTL is running low, enqueue replacement early
        // so the new miner arrives exactly when the old one expires.
        // Formula: TTL ≤ SpawnTime + TravelDistance
        let needsSpawn = siteMiners.length < 1;

        if (!needsSpawn && siteMiners.length === 1) {
            const miner = siteMiners[0];
            const ttl = miner.creep?.ticksToLive ?? Infinity;
            const bodySize = miner.creep?.body?.length ?? 6;
            const spawnTime = bodySize * 3; // 3 ticks per body part
            const travelTime = site.distance || 20; // fallback 20 if distance unknown
            const preSpawnThreshold = spawnTime + travelTime;

            if (ttl <= preSpawnThreshold) {
                needsSpawn = true;
                log.debug(() => `Pre-spawn: Miner at ${site.sourceId.slice(-4)} TTL=${ttl}, threshold=${preSpawnThreshold}`);
            }
        }

        if (needsSpawn) {
            // Bootstrap cap: if NO miners alive at all, cap to spawn-only energy (300)
            // so the Hatchery doesn't wait for unfilled extensions.
            const isBootstrap = this.miners.length === 0;
            const capacity = room.energyCapacityAvailable;

            // Miner body tiers (research-backed optimal morphologies):
            // ≥700: Self-Repair Miner — 5W+1C+3M (700e) — 10e/tick + container repair
            // ≥550: Dedicated Miner  — 5W+1M   (550e) — 10e/tick, full saturation
            // ≥300: Starter Miner    — 2W+1M   (250e) — 4e/tick
            //  <300: Pioneer Fallback — 1W+1C+1M (200e) — 2e/tick
            let body: BodyPartConstant[];
            if (capacity >= 700) {
                body = [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
            } else if (capacity >= 550) {
                body = [WORK, WORK, WORK, WORK, WORK, MOVE];
            } else if (capacity >= 300) {
                body = [WORK, WORK, MOVE];
            } else {
                body = [WORK, CARRY, MOVE];
            }

            this.colony.hatchery.enqueue({
                priority: 100,
                bodyTemplate: body,
                maxEnergy: isBootstrap ? 300 : undefined,
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
