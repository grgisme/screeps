// ============================================================================
// PickupTask — Pick up a dropped Resource from the ground
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * PickupTask directs a Zerg to pick up a dropped Resource.
 *
 * **Heap-safe:** Stores `targetId` (string), resolves the live object
 * each tick via `Game.getObjectById()`.
 *
 * **Serializable:** `serialize()` produces a JSON-safe `TaskMemory`.
 */
export class PickupTask implements ITask {
    readonly name = "Pickup";
    settings: TaskSettings = { targetRange: 1, workRange: 1 };

    /** Stored as an ID string — never a live Game object. */
    public readonly targetId: Id<Resource>;

    constructor(targetId: Id<Resource>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live target each tick (no heap leak)
    // -----------------------------------------------------------------------

    get target(): Resource | null {
        return Game.getObjectById(this.targetId);
    }

    // -----------------------------------------------------------------------
    // ITask Implementation
    // -----------------------------------------------------------------------

    isValid(): boolean {
        return !!this.target && this.target.amount > 0;
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target || target.amount === 0) return true; // Target gone or empty — done

        // Creep is full — task done
        if (zerg.store?.getFreeCapacity() === 0) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.pickup(target);
            // Only abort on fatal errors
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER
            ) {
                return true;
            }
            // Pickup is one-shot — done after a single successful grab
            if (result === OK) return true;
            return false;
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
