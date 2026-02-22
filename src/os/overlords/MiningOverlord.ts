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
        // Suspended only when we cannot yet afford a proper miner (RCL1 range).
        // At RCL2 (capacity ≥ 550) we allow drop-mining even before containers exist.
        const canAffordMiner = (room?.energyCapacityAvailable ?? 0) >= 550;
        return this.sites.every(s => !s.container && !s.link) && !room?.storage && !canAffordMiner;
    }

    private handleSpawning(site: MiningSite): void {
        const room = this.colony.room;
        if (!room) return;

        // Allow a drop-mining bootstrap miner once we can afford one (RCL2: capacity ≥ 550).
        // The hard gate (container required) prevented miners from ever spawning until workers
        // built containers first — but building containers is what we need miners FOR.
        // Drop-mining incurs ~10% decay tax but is far better than zero production.
        // Containers are built by workers concurrently; once built the miner steps onto them.
        const canAffordMiner = room.energyCapacityAvailable >= 550;
        if (!site.container && !site.link && !room.storage && !canAffordMiner) return;

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
                // Bootstrap cap: when no miners are alive and the template is small (≤300e),
                // cap to spawn-only energy so Hatchery doesn't deadlock waiting for unfilled
                // extensions. For larger templates (≥550e), no cap — the spawn must wait for
                // extensions to fill, but that's correct and expected at RCL2+.
                maxEnergy: (isBootstrap && body.reduce((s, p) => s + BODYPART_COST[p], 0) <= 300)
                    ? 300
                    : undefined,
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

            // ── Container Positioning Check ──
            // Miners must stand ON the container so harvested energy drops
            // directly into it. If container exists and miner isn't on it, move there.
            if (site.container && miner.pos) {
                const onContainer = miner.pos.isEqualTo(site.container.pos);
                if (!onContainer) {
                    // Check no other miner is already on this container
                    const occupied = this.miners.some(m =>
                        m !== miner && m.isAlive() && m.pos?.isEqualTo(site.container!.pos)
                    );
                    if (!occupied) {
                        miner.travelTo(site.container, 0);
                        continue; // Don't harvest until on the container
                    }
                }
            }

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
