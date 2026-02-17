import { Overlord } from "../Overlord";
import { Colony } from "../../Colony";
import { MiningSite } from "../../colony/MiningSite";
import { Miner } from "../../zerg/Miner";
import { Zerg } from "../../infrastructure/Zerg";

export class MiningOverlord extends Overlord {
    sites: MiningSite[] = [];
    miners: Miner[] = [];
    haulers: Zerg[] = [];

    constructor(colony: Colony) {
        super(colony, "mining");
    }

    init(): void {
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

    private handleSpawning(site: MiningSite): void {
        const siteMiners = this.miners.filter(m => m.site === site);
        if (siteMiners.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 100, // Very High, essential for energy
                bodyTemplate: [WORK, WORK, WORK, WORK, WORK, MOVE], // 5 Work = 10 energy/tick
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

        console.log(`MiningSite [${site.source.id}]: Distance [${site.distance}], Required Haul Capacity [${powerNeeded}], Current [${currentPower}]`);

        if (currentPower < powerNeeded) {
            // "Part-Count Balancing" logic: TotalCarryParts = ceil(HaulingPower / 50).
            // Actually, we request a creep. 
            // If we need 100 capacity, that's 2 CARRY parts.
            // But HaulingPower is total capacity needed. 

            // We enqueue a request. The Hatchery handles body scaling.
            // We should provide a template.
            // Standard Hauler: CARRY, MOVE (1:1 road).

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

        // Haulers are likely managed by TransporterOverlord logic generally, 
        // but if this Overlord requested them and OWNS them (passed 'this' as overlord),
        // then it should run them. 
        // NOTE: The requirements say "It requests Haulers". 
        // Usually dedicated haulers for a source are "Dedicated Logistics". 
        // If we use the TransporterOverlord for general logistics, these might be redundant?
        // OR, this MiningOverlord simply ensures enough haulers exist, but maybe they join the general pool?
        // Requirement: "It requests Haulers... based on MiningSite... logic"
        // Let's assume for this specific task, MiningOverlord runs them OR they are just spawned.
        // Given Phase 1 is "MiningSite Architecture", we'll just implement basic running or idle for now 
        // unless specified.
        // Actually, the requirements don't specify Hauler BEHAVIOR in "The Miner Zerg" or "MiningOverlord" sections other than spawning.
        // I will focus on Miner running. Haulers might just accumulate for now or I'll implement simple delivery.

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
