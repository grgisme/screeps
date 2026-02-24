// ============================================================================
// HarvestTask — Harvest energy from a Source
// ============================================================================

import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";
import { MovePriority } from "../infrastructure/MovePriority";

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
 *
 * **Priority-aware:** `settings.movePriority` can be injected by the
 * assigning Overlord (e.g. `MovePriority.EMERGENCY` for bootstrappers)
 * so EMERGENCY traffic rights are preserved every tick without bypassing
 * the Task abstraction. If not set, defaults to `MovePriority.LOW`.
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
        // Valid if source has energy OR is actively regenerating
        return source.energy > 0 || source.ticksToRegeneration > 0;
    }

    run(zerg: Zerg): boolean {
        const source = this.target;
        if (!source) return true; // Target gone — task complete (invalid)

        // Non-miners stop harvesting when full so they can go build/upgrade.
        // Miners (static workers) drop their energy in place — this is Drop Mining:
        // energy lands on the terrain tile beneath them so haulers/logistics can
        // pick it up via FIND_DROPPED_RESOURCES without blocking the harvest loop.
        if (zerg.store && zerg.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
            if ((zerg.memory as any)?.role !== "miner") return true;
            // Miner: dump and keep harvesting
            zerg.drop(RESOURCE_ENERGY);
            return false;
        }

        if (zerg.pos && zerg.pos.inRangeTo(source, this.settings.workRange)) {
            // Use the Zerg wrapper — preserves hasWorkIntent lock so no other
            // system can issue a conflicting work-pipeline action this tick.
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
            // Respect the priority injected by the assigning Overlord.
            // Bootstrappers inject EMERGENCY; regular creeps get LOW by default.
            const priority = this.settings.movePriority ?? MovePriority.LOW;
            zerg.travelTo(source, this.settings.targetRange, priority);
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
