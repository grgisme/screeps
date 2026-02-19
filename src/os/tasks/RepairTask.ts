// ============================================================================
// RepairTask — Repair a damaged structure
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * RepairTask directs a Zerg to repair a damaged structure.
 *
 * **Heap-safe:** Stores `targetId` (string), resolves the live object
 * each tick via `Game.getObjectById()`.
 *
 * **Completion:** Returns true when the structure reaches full HP,
 * the target is destroyed, or on fatal errors.
 */
export class RepairTask implements ITask {
    readonly name = "Repair";
    settings: TaskSettings = { targetRange: 3, workRange: 3 };

    /** Stored as an ID string — never a live Game object. */
    public readonly targetId: Id<Structure>;

    constructor(targetId: Id<Structure>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live target each tick (no heap leak)
    // -----------------------------------------------------------------------

    get target(): Structure | null {
        return Game.getObjectById(this.targetId);
    }

    // -----------------------------------------------------------------------
    // ITask Implementation
    // -----------------------------------------------------------------------

    isValid(): boolean {
        const t = this.target;
        return !!t && t.hits < t.hitsMax;
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target) return true; // Target destroyed — task complete
        if (target.hits === target.hitsMax) return true; // Fully repaired

        // Out of energy — task done, overlord will reassign
        if (zerg.store?.getUsedCapacity(RESOURCE_ENERGY) === 0) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.repair(target);
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER
            ) {
                return true; // Fatal
            }
            return false; // Keep repairing
        } else {
            zerg.travelTo(target, this.settings.targetRange);
            return false;
        }
    }

    serialize(): TaskMemory {
        return {
            name: this.name,
            targetId: this.targetId as string,
            settings: { ...this.settings },
        };
    }
}
