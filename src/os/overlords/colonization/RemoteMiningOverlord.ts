// ============================================================================
// RemoteMiningOverlord — Mining operations for remote rooms
// ============================================================================

import { Overlord } from "../Overlord";
import { Colony } from "../../colony/Colony";
import { MiningSite } from "../../colony/MiningSite";
import { Miner } from "../../zerg/Miner";
import { Zerg } from "../../zerg/Zerg";
import { Logger } from "../../../utils/Logger";

const log = new Logger("RemoteMiningOverlord");

/**
 * Like MiningOverlord but for remote rooms.
 * Creates MiningSite objects for sources in the remote room,
 * with distance calculated from the home colony spawn.
 */
export class RemoteMiningOverlord extends Overlord {
    targetRoom: string;
    sites: MiningSite[] = [];
    miners: Miner[] = [];
    haulers: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `remoteMining_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        const room = Game.rooms[this.targetRoom];
        if (!room) return; // No visibility yet

        // 1. Instantiate Sites if not done
        if (this.sites.length === 0) {
            const sources = room.find(FIND_SOURCES);
            for (const source of sources) {
                const site = new MiningSite(this.colony, source);
                // Override distance with remote path calculation
                this.calculateRemoteDistance(site);
                this.sites.push(site);
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
     * Calculate the path distance from the home colony spawn/storage
     * to the remote mining site. This is crucial for hauling calculations.
     */
    private calculateRemoteDistance(site: MiningSite): void {
        const dropoff = this.colony.room.storage || this.colony.room.find(FIND_MY_SPAWNS)[0];
        if (!dropoff) return;

        const path = PathFinder.search(site.source.pos, { pos: dropoff.pos, range: 1 });
        site.distance = path.path.length;
        log.info(`Remote site ${site.source.id} distance: ${site.distance}`);
    }

    private handleSpawning(site: MiningSite): void {
        // A. Miners — one per source
        const siteMiners = this.miners.filter(m => m.site === site);
        if (siteMiners.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 80, // High, but below local miners (100)
                bodyTemplate: [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE],
                overlord: this,
                name: `rminer_${site.source.id}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.source.id } }
            });
        }

        // B. Haulers — part-count balanced
        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any).state?.siteId === site.source.id)
            .reduce((sum, h) => sum + h.creep.store.getCapacity(), 0);

        log.info(`Remote MiningSite [${site.source.id}]: Distance [${site.distance}], Required Haul [${powerNeeded}], Current [${currentPower}]`);

        if (currentPower < powerNeeded) {
            this.colony.hatchery.enqueue({
                priority: 40, // Medium — remote hauling
                bodyTemplate: [CARRY, MOVE],
                overlord: this,
                name: `rhauler_${site.source.id}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.source.id } }
            });
        }
    }

    run(): void {
        for (const miner of this.miners) {
            miner.run();
        }

        for (const hauler of this.haulers) {
            if (hauler.creep.store.getFreeCapacity() > 0) {
                // Go to remote site container
                const site = this.sites.find(s => s.source.id === (hauler.memory as any).state?.siteId);
                if (site && site.containerPos) {
                    if (!hauler.pos.inRangeTo(site.containerPos, 1)) {
                        hauler.travelTo(site.containerPos);
                    } else {
                        if (site.container) hauler.creep.withdraw(site.container, RESOURCE_ENERGY);
                        else {
                            const dropped = site.containerPos.lookFor(LOOK_RESOURCES)[0];
                            if (dropped) hauler.creep.pickup(dropped);
                        }
                    }
                }
            } else {
                // Deliver to home colony storage/spawn
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
