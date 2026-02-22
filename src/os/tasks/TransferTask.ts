// ============================================================================
// TransferTask — Transfer resources to a structure or creep
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * TransferTask directs a Zerg to transfer energy to a target structure.
 *
 * **Heap-safe:** Stores `targetId` (string), resolves the live object
 * each tick via `Game.getObjectById()`.
 *
 * **Serializable:** `serialize()` produces a JSON-safe `TaskMemory`.
 */
export class TransferTask implements ITask {
    readonly name = "Transfer";
    settings: TaskSettings = { targetRange: 1, workRange: 1 };

    /** Stored as an ID string — never a live Game object. */
    public readonly targetId: Id<Structure | Creep>;

    constructor(targetId: Id<Structure | Creep>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live target each tick (no heap leak)
    // -----------------------------------------------------------------------

    get target(): (Structure | Creep) | null {
        return Game.getObjectById(this.targetId);
    }

    // -----------------------------------------------------------------------
    // ITask Implementation
    // -----------------------------------------------------------------------

    isValid(): boolean {
        const target = this.target;
        if (!target) return false;
        // Valid if target can accept energy
        if ("store" in target) {
            return (target as any).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
        return true; // Creep targets always valid if alive
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target) return true; // Target gone — task complete

        // Creep has nothing to deliver — task done
        if (zerg.store?.getUsedCapacity() === 0) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.transfer(
                target as Structure | Creep,
                RESOURCE_ENERGY
            );

            // Only abort on fatal errors
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER ||
                result === ERR_FULL ||
                result === ERR_NOT_ENOUGH_RESOURCES
            ) {
                return true;
            }
            // Transfer is one-shot — done after a single successful push
            if (result === OK) return true;
            return false;
        } else {
            // Fix #4: Transporters get priority 10 — right-of-way in corridors.
            // Workers transferring to spawn get default 1 (they yield to haulers).
            const isTransporter = (zerg.memory as any)?.role === "transporter";
            const travelPriority = isTransporter ? 10 : 1;
            zerg.travelTo(target, this.settings.targetRange, travelPriority);
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
