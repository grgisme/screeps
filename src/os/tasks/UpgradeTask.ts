// ============================================================================
// UpgradeTask — Upgrade the room controller
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * UpgradeTask directs a Zerg to upgrade the room controller.
 *
 * **Heap-safe:** Stores `targetId` (string), resolves the live object
 * each tick via `Game.getObjectById()`.
 *
 * **Persistent:** Returns true only on fatal errors — upgrading is
 * a continuous activity until the creep runs out of energy.
 */
export class UpgradeTask implements ITask {
    readonly name = "Upgrade";
    settings: TaskSettings = { targetRange: 3, workRange: 3 };

    /** Stored as an ID string — never a live Game object. */
    public readonly targetId: Id<StructureController>;

    constructor(targetId: Id<StructureController>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live target each tick (no heap leak)
    // -----------------------------------------------------------------------

    get target(): StructureController | null {
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
        if (!target) return true; // Target gone — task complete

        // Out of energy — task done, overlord will reassign
        if (zerg.store?.getUsedCapacity(RESOURCE_ENERGY) === 0) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.upgradeController(target);
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER
            ) {
                return true; // Fatal
            }
            return false; // Keep upgrading
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
