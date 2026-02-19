// ============================================================================
// Overlord — Base class for task managers
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import type { Colony } from "../colony/Colony";

export abstract class Overlord {
    colony: Colony;
    processId: string;
    zergs: Zerg[] = [];

    constructor(colony: Colony, processId: string) {
        this.colony = colony;
        this.processId = processId;
    }

    /** Refresh state at start of tick */
    abstract init(): void;

    /** Execute logic (assign tasks) */
    abstract run(): void;

    /** Add a Zerg to this overlord's control */
    addZerg(zerg: Zerg): void {
        this.zergs.push(zerg);
    }
}
