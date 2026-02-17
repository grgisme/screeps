// ============================================================================
// ITask — Interface for actionable tasks
// ============================================================================

import { Zerg } from "../infrastructure/Zerg";

/**
 * A Task represents a specific action a Zerg should perform (Harvest, Upgrade, etc.)
 */
export interface ITask {
    /** Name of the task for debugging (e.g., "Harvest:abc1234") */
    name: string;

    /** The target object or position */
    target: RoomObject | RoomPosition | null;

    /**
     * Settings for the task (e.g., range to target)
     */
    settings: {
        targetRange: number;
        workRange: number;
        oneShot?: boolean;
    };

    /**
     * Execution logic.
     * @returns true if the task is complete.
     */
    run(zerg: Zerg): boolean;

    /** Check if the task is still valid (e.g. target exists) */
    isValid(): boolean;
}
