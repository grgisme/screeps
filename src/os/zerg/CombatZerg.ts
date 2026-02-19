// ============================================================================
// CombatZerg — Typed Zerg extension for military creeps
// ============================================================================
//
// ⚠️ IoC PATTERN: CombatZerg has NO autonomous run() logic.
// DefenseOverlord / DestroyerOverlord execute micro directly.
// ============================================================================

import { Zerg } from "./Zerg";

export class CombatZerg extends Zerg {
    constructor(creepName: string) {
        super(creepName);
    }
}
