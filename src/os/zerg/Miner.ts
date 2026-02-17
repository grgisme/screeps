import { Zerg } from "./Zerg";
import { MiningSite } from "../colony/MiningSite";

export class Miner extends Zerg {
    site: MiningSite | undefined;

    constructor(creep: Creep, site?: MiningSite) {
        super(creep);
        this.site = site;
    }

    run(): void {
        if (!this.site || !this.site.containerPos) return;

        // 1. Move to container position
        if (!this.pos.isEqualTo(this.site.containerPos)) {
            this.travelTo(this.site.containerPos);
            return;
        }

        // 2. Harvest
        if (this.site.source.energy > 0) {
            this.creep.harvest(this.site.source);
        }

        // 3. Link Logic
        if (this.site.link && this.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            // If carry parts exist and link is not full
            if (this.site.link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                this.creep.transfer(this.site.link, RESOURCE_ENERGY);
            }
        }

        // 4. Container Repair Logic
        // If container exists and is damaged, and we have WORK parts + energy
        if (this.site.container && this.site.container.hits < this.site.container.hitsMax) {
            // Need CARRY part to repair? No, repair needs energy in creep, or maybe just work?
            // Actually repair consumes energy from the creep. 
            // Static miners usually drop harvest into container. They pick up from container to repair?
            // Or if they have a CARRY part, they might have energy in store from harvest tick (if harvest result > carry cap? no).

            // Standard miner: WORK*5, MOVE*1 (or similar). No CARRY.
            // If we want repair capability, we need 1 CARRY part.

            if (this.creep.store.energy > 0) {
                this.creep.repair(this.site.container);
            } else if (this.site.container.store.energy > 0) {
                this.creep.withdraw(this.site.container, RESOURCE_ENERGY);
            }
        }
    }
}
