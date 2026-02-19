// ============================================================================
// WithdrawTask — Withdraw resources from a container, storage, or tombstone
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * WithdrawTask directs a Zerg to withdraw energy from a target structure.
 *
 * **Heap-safe:** Stores `targetId` (string), resolves the live object
 * each tick via `Game.getObjectById()`.
 *
 * **Serializable:** `serialize()` produces a JSON-safe `TaskMemory`.
 */
export class WithdrawTask implements ITask {
    readonly name = "Withdraw";
    settings: TaskSettings = { targetRange: 1, workRange: 1 };

    /** Stored as an ID string — never a live Game object. */
    private readonly targetId: Id<Structure | Tombstone | Ruin>;

    constructor(targetId: Id<Structure | Tombstone | Ruin>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live target each tick (no heap leak)
    // -----------------------------------------------------------------------

    get target(): (Structure | Tombstone | Ruin) | null {
        return Game.getObjectById(this.targetId);
    }

    // -----------------------------------------------------------------------
    // ITask Implementation
    // -----------------------------------------------------------------------

    isValid(): boolean {
        const target = this.target;
        if (!target) return false;
        // Valid if target has energy to withdraw
        if ("store" in target) {
            return (target as any).store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        }
        return false;
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target) return true; // Target gone — task complete

        // Creep is full — task done
        if (zerg.store?.getFreeCapacity() === 0) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.withdraw(
                target as Structure | Tombstone | Ruin,
                RESOURCE_ENERGY
            );
            // Only abort on fatal errors
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER ||
                result === ERR_NOT_ENOUGH_RESOURCES
            ) {
                return true;
            }
            // Withdraw is one-shot — done after a single successful pull
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
