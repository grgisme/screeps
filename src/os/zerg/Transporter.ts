// ============================================================================
// Transporter — Hauler creep that uses the Zerg task system
// ============================================================================
//
// ⚠️ GETTER PATTERN (V8 MEMORY LEAK PREVENTION)
// ══════════════════════════════════════════════
// Inherits heap-safe design from Zerg. No live object caching.
// Task assignment is handled by TransporterOverlord via the LogisticsNetwork.
// ============================================================================

import { Zerg } from "./Zerg";
import { Overlord } from "../overlords/Overlord";

export class Transporter extends Zerg {

    overlord: Overlord;

    constructor(creepName: string, overlord: Overlord) {
        super(creepName);
        this.overlord = overlord;
    }

    run(): void {
        if (!this.isAlive()) return;

        // Repair road underfoot before executing task
        this.repairRoad();

        // Delegate to Zerg's task execution loop
        super.run();
    }

    /**
     * Repair road underfoot if damaged.
     * Costs 0 extra CPU for movement, just the repair call check.
     * Requires WORK part and Energy.
     */
    private repairRoad(): void {
        const creep = this.creep;
        if (!creep) return;
        if (creep.spawning) return;

        // 1. Check if we have energy and WORK parts
        if (creep.store.energy === 0) return;
        const workParts = creep.body.filter(b => b.type === WORK).length;
        if (workParts === 0) return;

        // 2. Check structure underfoot — use intent-cached wrapper
        const pos = this.pos;
        if (!pos) return;
        const road = pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD);
        if (road && road.hits < road.hitsMax) {
            this.repair(road);
        }
    }
}
