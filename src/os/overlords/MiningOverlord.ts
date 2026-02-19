// ============================================================================
// MiningOverlord — Manages mining sites, miners, and haulers
// ============================================================================
//
// ⚠️ IoC PATTERN: Overlords assign tasks. They do NOT call zerg.run().
// Colony.run() iterates all zergs and calls zerg.run() once per tick.
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Miner } from "../zerg/Miner";
import { Zerg } from "../zerg/Zerg";
import { HarvestTask } from "../tasks/HarvestTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("Mining");

export class MiningOverlord extends Overlord {
    sites: MiningSite[] = [];
    miners: Miner[] = [];
    haulers: Zerg[] = [];

    constructor(colony: Colony) {
        super(colony, "mining");
    }

    init(): void {
        // Prune dead zergs (getter pattern — no refresh needed)
        this.zergs = this.zergs.filter(z => z.isAlive());

        // Adopt orphaned miners/haulers after global resets (throttled)
        this.adoptOrphans();

        // 1. Instantiate Sites if not done (uses sourceId, not live Source)
        if (this.sites.length === 0) {
            const room = this.colony.room;
            if (room) {
                const sources = room.find(FIND_SOURCES) as Source[];
                for (const source of sources) {
                    this.sites.push(new MiningSite(this.colony, source.id));
                }
            }
        }

        // 2. Throttled structure discovery on sites
        for (const site of this.sites) {
            site.refreshStructureIds();
        }

        // 3. Creep Assignment — cast existing zergs, don't re-wrap
        this.miners = this.zergs
            .filter(z => (z.memory as any)?.role === "miner") as Miner[];

        this.haulers = this.zergs
            .filter(z => (z.memory as any)?.role === "hauler");

        // 4. Spawn Logic per Site
        for (const site of this.sites) {
            this.handleSpawning(site);
        }
    }

    /**
     * Adopt orphaned miners and haulers that survive global resets.
     * Throttled to every 100 ticks to avoid CPU waste.
     */
    private adoptOrphans(): void {
        if (Game.time % 100 !== 0) return;

        const room = this.colony.room;
        if (!room) return;

        const orphans = room.find(FIND_MY_CREEPS, {
            filter: (creep: Creep) =>
                (creep.memory.role === "miner" || creep.memory.role === "hauler") &&
                !this.colony.getZerg(creep.name)
        });

        for (const orphan of orphans) {
            const zerg = this.colony.registerZerg(orphan);
            zerg.task = null;
            this.zergs.push(zerg);
            log.info(`${this.colony.name}: Adopted orphan ${orphan.memory.role} ${orphan.name}`);
        }
    }

    /**
     * True when mining infrastructure isn't ready (no containers/links/storage).
     * Workers should compensate when this is true.
     */
    get isSuspended(): boolean {
        const room = this.colony.room;
        return this.sites.every(s => !s.container && !s.link)
            && !(room?.storage);
    }

    private handleSpawning(site: MiningSite): void {
        const room = this.colony.room;
        if (!room) return;

        // Gate: require container, link, or storage before spawning specialized miners
        if (!site.container && !site.link && !room.storage) {
            return;
        }

        const source = site.source;
        if (!source) return;

        const siteMiners = this.miners.filter(m => {
            const mem = m.memory as any;
            return mem?.state?.siteId === site.sourceId;
        });
        if (siteMiners.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 100,
                bodyTemplate: [WORK, WORK, MOVE],
                overlord: this,
                name: `miner_${site.sourceId}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.sourceId } }
            });
        }

        // B. Haulers
        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any)?.state?.siteId === site.sourceId)
            .reduce((sum, h) => sum + (h.store?.getCapacity() ?? 0), 0);

        if (Game.time % 100 === 0) {
            log.info(`Site [${site.sourceId.slice(-4)}]: Dist=${site.distance}, HaulNeeded=${powerNeeded}, HaulCurrent=${currentPower}`);
        }

        if (currentPower < powerNeeded) {
            this.colony.hatchery.enqueue({
                priority: 50,
                bodyTemplate: [CARRY, MOVE],
                overlord: this,
                name: `hauler_${site.sourceId}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.sourceId } }
            });
        }
    }

    // -----------------------------------------------------------------------
    // IoC Task Assignment — Overlord assigns tasks; Colony calls zerg.run()
    // -----------------------------------------------------------------------

    run(): void {
        // Assign tasks to idle miners
        for (const miner of this.miners) {
            if (!miner.isAlive()) continue;
            if (!miner.task) {
                const mem = miner.memory as any;
                const siteId = mem?.state?.siteId;
                const site = this.sites.find(s => s.sourceId === siteId);
                if (site?.source) {
                    miner.setTask(new HarvestTask(site.source.id));
                }
            }
        }

        // Assign tasks to idle haulers
        for (const hauler of this.haulers) {
            if (!hauler.isAlive()) continue;
            if (hauler.task) continue;

            const mem = hauler.memory as any;
            const siteId = mem?.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (hauler.store?.getUsedCapacity() === 0) {
                // Empty — go withdraw from site container
                if (site?.containerId) {
                    hauler.setTask(new WithdrawTask(site.containerId));
                } else if (site?.source) {
                    // Fix #3: Early game — no container. Pick up dropped energy near source.
                    const dropped = site.source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)
                        .find(r => r.resourceType === RESOURCE_ENERGY);
                    if (dropped) {
                        hauler.setTask(new PickupTask(dropped.id as Id<Resource>));
                    }
                }
            } else {
                // Full or partially full — deliver to storage or spawn
                const room = this.colony.room;
                if (room) {
                    const dropoff = room.storage || room.find(FIND_MY_SPAWNS)?.[0];
                    if (dropoff) {
                        hauler.setTask(new TransferTask(dropoff.id as Id<Structure | Creep>));
                    }
                }
            }
        }
    }
}
