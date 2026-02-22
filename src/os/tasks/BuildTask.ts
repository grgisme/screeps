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
    settings: TaskSettings = { targetRange: 2, workRange: 3 };

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

        const inWorkRange = zerg.pos?.inRangeTo(target, this.settings.workRange) ?? false;
        const atTargetRange = zerg.pos?.inRangeTo(target, this.settings.targetRange) ?? false;

        // ── Intent Combination ────────────────────────────────────────────
        // build() and move() use separate engine pipelines and can both fire
        // in the same tick. By splitting workRange (3) from targetRange (2),
        // a worker at range 3 fires BOTH: it builds now AND closes to range 2
        // for even more build ticks next tick. This reclaims the approach tick
        // for free construction progress — zero extra CPU, zero extra energy.
        //
        //   Range 4+  →  move only        (out of workRange)
        //   Range 3   →  move + build     ← combination tick
        //   Range 2   →  build only       (at targetRange, settled)
        // ─────────────────────────────────────────────────────────────────

        if (inWorkRange) {
            // Build — succeeds whether moving or stationary
            const result = zerg.build(target);
            if (result === ERR_INVALID_TARGET || result === ERR_NOT_OWNER) return true;
        }

        if (!atTargetRange) {
            // Move: fires even when in workRange (range 3 → range 2 transition)
            zerg.travelTo(target, this.settings.targetRange);
        }

        return false;
    }

    serialize(): TaskMemory {
        return {
            name: this.name,
            targetId: this.targetId as string,
            settings: { ...this.settings },
        };
    }
}
