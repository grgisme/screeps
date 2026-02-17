// ============================================================================
// Tasks — Basic Implementations
// ============================================================================

import { ITask } from "./ITask";
import { Zerg } from "../infrastructure/Zerg";

export class HarvestTask implements ITask {
    name = "Harvest";
    target: Source;
    settings = { targetRange: 1, workRange: 1 };

    constructor(target: Source) {
        this.target = target;
    }

    isValid(): boolean {
        return !!this.target && (this.target.energy > 0 || String(this.target.ticksToRegeneration) !== "undefined");
    }

    run(zerg: Zerg): boolean {
        if (zerg.pos.inRangeTo(this.target, this.settings.workRange)) {
            const result = zerg.creep.harvest(this.target);
            return result !== OK && result !== ERR_NOT_ENOUGH_RESOURCES;
            // Return true if finished? Harvest is continuous usually.
            // For now, return false unless error.
        } else {
            zerg.creep.moveTo(this.target);
            return false;
        }
    }
}
