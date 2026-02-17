// ============================================================================
// GlobalManager — Centralized entry point for Heap-First Architecture
// ============================================================================

import { GlobalCache } from "./GlobalCache";
import { Logger } from "../utils/Logger";
import { Colony } from "../os/colony/Colony";

const log = new Logger("GlobalManager");

/**
 * Manages the "Warm Start" lifecycle.
 * initializes and validates global state managers (RoomManager, StatsManager, etc.)
 * on global reset, and triggers their rehydration from Memory.
 */
export class GlobalManager {

    static colonies: Map<string, Colony> = new Map();

    /**
     * Run at the start of the tick to ensure all global components are ready.
     * This is the "Warm Start" entry point.
     */
    static init(): void {
        const isReset = GlobalCache.isGlobalReset();

        // Initialize Colonies for all owned rooms
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (room && room.controller && room.controller.my) {
                if (!this.colonies.has(roomName)) {
                    // Rehydrate or create new Colony
                    const colony = GlobalCache.rehydrate(
                        `Colony:${roomName}`,
                        () => new Colony(roomName)
                    );
                    this.colonies.set(roomName, colony);
                }
            }
        }

        if (isReset) {
            log.info("GlobalManager initialized (New Isolate)");
        }
    }

    /**
     * Run at the end of the tick to persist dirty state.
     */
    static run(): void {
        // Run all colonies? No, Colony.run() should be called by Kernel or Main loop?
        // For now, let's have main loop call colonies.run() or Kernel manage them.
        // But Kernel manages processes.
        // We are "treating Colonies as top-level processes" per requirements.
        // So we should wrap Colony in a Process? or just run them here?
        // Requirement: "Update the Kernel to treat Colonies as top-level processes"

        // 2. Commit dirty state from GlobalCache to Memory
        GlobalCache.commit();
    }
}
