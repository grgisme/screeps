import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Miner } from "../zerg/Miner";
import { Zerg } from "../zerg/Zerg";
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
        // Refresh all zerg creep references for this tick and prune dead
        this.zergs = this.zergs.filter(z => {
            const alive = !!Game.creeps[z.name];
            if (alive) z.refresh();
            return alive;
        });
        // 1. Instantiate Sites if not done
        if (this.sites.length === 0) {
            const sources = this.colony.room.find(FIND_SOURCES);
            for (const source of sources) {
                this.sites.push(new MiningSite(this.colony, source));
            }
        }

        // 2. Refresh Sites
        for (const site of this.sites) {
            site.refresh();
        }

        // 3. Creep Assignment
        this.miners = this.zergs
            .filter(z => (z.memory as any).role === "miner")
            .map(z => {
                const mem = (z.memory as any);
                if (!mem.state || !mem.state.siteId) return null;
                return new Miner(z.creep, this.sites.find(s => s.source.id === mem.state.siteId));
            })
            .filter(m => m !== null) as Miner[];

        this.haulers = this.zergs.filter(z => (z.memory as any).role === "hauler");

        // 4. Spawn Logic per Site
        for (const site of this.sites) {
            this.handleSpawning(site);
        }
    }

    /**
     * True when mining infrastructure isn't ready (no containers/links/storage).
     * Workers should compensate when this is true.
     */
    get isSuspended(): boolean {
        return this.sites.every(s => !s.container && !s.link)
            && !this.colony.room.storage;
    }

    private handleSpawning(site: MiningSite): void {
        // Gate: require container, link, or storage before spawning specialized miners
        if (!site.container && !site.link && !this.colony.room.storage) {
            return;
        }

        const siteMiners = this.miners.filter(m => m.site === site);
        if (siteMiners.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 100, // Very High, essential for energy
                bodyTemplate: [WORK, WORK, MOVE], // Scales with energy: 250/repeat
                overlord: this,
                name: `miner_${site.source.id}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.source.id } }
            });
        }

        // B. Haulers
        // Calculate needed power
        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any).state.siteId === site.source.id)
            .reduce((sum, h) => sum + h.creep.store.getCapacity(), 0);

        log.throttle(100, () => `Site [${site.source.id.slice(-4)}]: Dist=${site.distance}, HaulNeeded=${powerNeeded}, HaulCurrent=${currentPower}`, site.source.id.charCodeAt(0));

        if (currentPower < powerNeeded) {
            this.colony.hatchery.enqueue({
                priority: 50, // Medium-High
                bodyTemplate: [CARRY, MOVE],
                overlord: this,
                name: `hauler_${site.source.id}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.source.id } }
            });
        }
    }

    run(): void {
        for (const miner of this.miners) {
            miner.run();
        }

        for (const hauler of this.haulers) {
            // Simple delivery logic for now to validate spawning
            if (hauler.creep.store.getFreeCapacity() > 0) {
                // Go to site container
                const site = this.sites.find(s => s.source.id === (hauler.memory as any).state.siteId);
                if (site && site.containerPos) {
                    if (!hauler.pos.inRangeTo(site.containerPos, 1)) {
                        hauler.travelTo(site.containerPos);
                    } else {
                        if (site.container) hauler.creep.withdraw(site.container, RESOURCE_ENERGY);
                        else {
                            // Pickup dropped?
                            const dropped = site.containerPos.lookFor(LOOK_RESOURCES)[0];
                            if (dropped) hauler.creep.pickup(dropped);
                        }
                    }
                }
            } else {
                // Deliver to storage/spawn
                const dropoff = this.colony.room.storage || this.colony.room.find(FIND_MY_SPAWNS)[0];
                if (dropoff) {
                    if (hauler.creep.transfer(dropoff, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        hauler.travelTo(dropoff);
                    }
                }
            }
        }
    }
}
