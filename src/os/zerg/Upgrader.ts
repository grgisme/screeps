// ============================================================================
// Upgrader — Typed Zerg extension for upgrader creeps
// ============================================================================
//
// ⚠️ IoC PATTERN: Upgrader has NO autonomous run() logic.
// UpgradingOverlord assigns tasks. Colony calls zerg.run().
// ============================================================================

import { Zerg } from "./Zerg";

export class Upgrader extends Zerg {
    constructor(creepName: string) {
        super(creepName);
    }
}
