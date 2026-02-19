// ============================================================================
// BuildTask — Build a construction site
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * BuildTask directs a Zerg to build a construction site.
 *
 * **Heap-safe:** Stores `targetId` (string), resolves the live object
 * each tick via `Game.getObjectById()`.
 *
 * **Completion:** Returns true when the site is finished (target
 * disappears from the game world) or on fatal errors.
 */
export class BuildTask implements ITask {
    readonly name = "Build";
    settings: TaskSettings = { targetRange: 3, workRange: 3 };

    /** Stored as an ID string — never a live Game object. */
    public readonly targetId: Id<ConstructionSite>;

    constructor(targetId: Id<ConstructionSite>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live target each tick (no heap leak)
    // -----------------------------------------------------------------------

    get target(): ConstructionSite | null {
        return Game.getObjectById(this.targetId);
    }

    // -----------------------------------------------------------------------
    // ITask Implementation
    // -----------------------------------------------------------------------

    isValid(): boolean {
        return !!this.target;
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target) return true; // Site finished or removed — task complete

        // Out of energy — task done, overlord will reassign
        if (zerg.store?.getUsedCapacity(RESOURCE_ENERGY) === 0) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.build(target);
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER
            ) {
                return true; // Fatal
            }
            return false; // Keep building
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
