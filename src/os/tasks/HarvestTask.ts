// ============================================================================
// HarvestTask — Harvest energy from a Source
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

/**
 * HarvestTask directs a Zerg to harvest energy from a specific Source.
 *
 * **Heap-safe:** Stores `targetId` (string), not a live `Source` object.
 * The actual Source is resolved each tick via a getter using
 * `Game.getObjectById()`, preventing V8 memory leaks when cached in
 * the global heap by Overlords.
 *
 * **Serializable:** `serialize()` produces a JSON-safe `TaskMemory`
 * that survives global resets via `CreepMemory.task`.
 */
export class HarvestTask implements ITask {
    readonly name = "Harvest";
    settings: TaskSettings = { targetRange: 1, workRange: 1 };

    /** Stored as an ID string — never a live Game object. */
    private readonly targetId: Id<Source>;

    constructor(targetId: Id<Source>) {
        this.targetId = targetId;
    }

    // -----------------------------------------------------------------------
    // Getter — resolve live Source from ID each tick (no heap leak)
    // -----------------------------------------------------------------------

    /** Resolve the target Source from the Game object registry. */
    get target(): Source | null {
        return Game.getObjectById(this.targetId);
    }

    // -----------------------------------------------------------------------
    // ITask Implementation
    // -----------------------------------------------------------------------

    isValid(): boolean {
        const source = this.target;
        if (!source) return false;
        // Valid if source has energy OR is regenerating (it will have energy soon)
        return source.energy > 0 || source.ticksToRegeneration !== undefined;
    }

    run(zerg: Zerg): boolean {
        const source = this.target;
        if (!source) return true; // Target gone — task complete (invalid)

        // Non-miners must stop harvesting when full so they can build/upgrade
        if (zerg.store && zerg.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
            if ((zerg.memory as any)?.role !== "miner") return true;
        }

        if (zerg.pos && zerg.pos.inRangeTo(source, this.settings.workRange)) {
            const result = zerg.harvest(source);
            // Only abort on *fatal* errors. Transient errors (BUSY, TIRED,
            // NOT_ENOUGH_RESOURCES) must NOT kill the task — they resolve
            // themselves next tick.
            if (
                result === ERR_INVALID_TARGET ||
                result === ERR_NOT_OWNER ||
                result === ERR_NO_BODYPART
            ) {
                return true; // Fatal — permanently clear this task
            }
            return false; // Keep harvesting (OK, BUSY, TIRED, etc.)
        } else {
            zerg.travelTo(source, this.settings.targetRange);
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
