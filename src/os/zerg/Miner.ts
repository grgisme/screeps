// ============================================================================
// Miner — Typed Zerg extension for mining creeps
// ============================================================================
//
// ⚠️ ARCHITECTURE NOTE: Zergs are blind executors. Overlords are brains.
// ═══════════════════════════════════════════════════════════════════════
// Miner does NOT contain a run() method or autonomous decision logic.
// The MiningOverlord is responsible for:
//   1. Assigning a HarvestTask to the Miner
//   2. Deciding when to transfer to a Link vs. Container
//   3. Deciding when to repair the container
//
// This class exists only to provide typed identity and any miner-specific
// accessors that Overlords might need (e.g., checking if the creep has
// arrived at its container position).
// ============================================================================

import { Zerg } from "./Zerg";

/**
 * Miner is a typed extension of Zerg for mining creeps.
 *
 * **No autonomous logic.** The MiningOverlord orchestrates Miners by
 * assigning tasks (HarvestTask, TransferTask, RepairTask) based on
 * the current Link/Container state.
 *
 * **Heap-safe:** Inherits the getter pattern from Zerg. No live Game
 * objects stored as properties.
 */
export class Miner extends Zerg {
    constructor(creepName: string) {
        super(creepName);
    }
}
