// ============================================================================
// Worker — Typed Zerg extension for worker creeps
// ============================================================================
//
// ⚠️ IoC PATTERN: Worker has NO autonomous run() logic.
// WorkerOverlord assigns tasks. Colony calls zerg.run().
// ============================================================================

import { Zerg } from "./Zerg";

export class Worker extends Zerg {
    constructor(creepName: string) {
        super(creepName);
    }
}
