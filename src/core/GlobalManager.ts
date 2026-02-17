// ============================================================================
// GlobalManager — Centralized entry point for Heap-First Architecture
// ============================================================================

import { GlobalCache } from "../utils/GlobalCache";
import { Logger } from "../utils/Logger";

const log = new Logger("GlobalManager");

/**
 * Manages the "Warm Start" lifecycle.
 * initializes and validates global state managers (RoomManager, StatsManager, etc.)
 * on global reset, and triggers their rehydration from Memory.
 */
export class GlobalManager {
    /**
     * Run at the start of the tick to ensure all global components are ready.
     * This is the "Warm Start" entry point.
     */
    static init(): void {
        const isReset = GlobalCache.isGlobalReset();

        // Example: Initialize basic stats manager or other global singletons here
        // Future: GlobalCache.rehydrate("StatsManager", () => new StatsManager(), s => s.serialize());

        if (isReset) {
            log.info("GlobalManager initialized (New Isolate)");
        }
    }

    /**
     * Run at the end of the tick to persist dirty heap state to Memory.
     * This replaces the standard "Memory is saved automatically" assumption.
     */
    static run(): void {
        // 1. Run global managers (if any)

        // 2. Commit dirty state from GlobalCache to Memory
        GlobalCache.commit();
    }
}
