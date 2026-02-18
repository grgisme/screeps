// ============================================================================
// ITask — Interface for actionable, serializable tasks
// ============================================================================

import type { Zerg } from "../zerg/Zerg";

// -------------------------------------------------------------------------
// Serialization Types — survive global resets via CreepMemory
// -------------------------------------------------------------------------

/**
 * Serialized task representation stored in `CreepMemory.task`.
 * Must be JSON-safe (no live Game objects, only IDs and primitives).
 */
export interface TaskMemory {
    /** Task type name — used by TaskFactory to reconstruct the task. */
    name: string;

    /** The Game object ID of the target (e.g., Source, Structure, etc.) */
    targetId: string;

    /** Task-specific settings (range, oneShot, etc.) */
    settings: TaskSettings;
}

/**
 * Task execution settings. Controls range behavior and one-shot completion.
 */
export interface TaskSettings {
    /** Range at which to start moving toward the target. */
    targetRange: number;

    /** Range at which the task's work action can execute. */
    workRange: number;

    /** If true, the task completes after a single successful action. */
    oneShot?: boolean;
}

// -------------------------------------------------------------------------
// ITask Interface
// -------------------------------------------------------------------------

/**
 * A Task represents a specific action a Zerg should perform (Harvest, Upgrade, etc.)
 *
 * Tasks are designed to be:
 * - **Heap-safe:** They store target IDs, not live Game objects.
 * - **Serializable:** They can be saved to CreepMemory and reconstructed
 *   after a global reset via `serialize()` + TaskFactory.
 * - **Stateless executors:** Overlords assign tasks; Zergs execute them blindly.
 */
export interface ITask {
    /** Task type name (e.g., "Harvest", "Transfer", "Upgrade"). */
    readonly name: string;

    /** Task execution settings. */
    settings: TaskSettings;

    /**
     * Execution logic. Called once per tick by Zerg.run().
     * @returns true if the task is complete and should be cleared.
     */
    run(zerg: Zerg): boolean;

    /** Check if the task is still valid (e.g., target exists, has resources). */
    isValid(): boolean;

    /**
     * Serialize the task to a JSON-safe format for CreepMemory persistence.
     * This ensures tasks survive global resets.
     */
    serialize(): TaskMemory;
}
