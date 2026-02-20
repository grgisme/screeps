// ============================================================================
// DismantleTask — Dismantle an obsolete structure to reclaim 50% energy
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * DismantleTask directs a Zerg to dismantle a structure.
 * Uses `creep.dismantle()` which recovers 50% of construction cost
 * into the creep's carry capacity.
 *
 * **Completion:** When the target is destroyed, carry is full, or no WORK parts.
 */
export class DismantleTask implements ITask {
    readonly name = "Dismantle";
    settings: TaskSettings = { targetRange: 1, workRange: 1 };

    public readonly targetId: Id<Structure>;

    constructor(targetId: Id<Structure>) {
        this.targetId = targetId;
    }

    get target(): Structure | null {
        return Game.getObjectById(this.targetId);
    }

    isValid(): boolean {
        return !!this.target;
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target) return true; // Target destroyed — task complete

        // If carry is full, stop dismantling — transition to deposit
        if (zerg.store?.getFreeCapacity() === 0) return true;

        if (zerg.pos && zerg.pos.isNearTo(target)) {
            const result = zerg.dismantle(target);
            if (result === ERR_NO_BODYPART) return true; // No WORK parts
            if (result === ERR_INVALID_TARGET) return true;
            return false; // Keep dismantling
        } else {
            zerg.travelTo(target, 1);
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
