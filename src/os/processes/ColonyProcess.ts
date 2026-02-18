// ============================================================================
// ColonyProcess — Kernel-managed process for Colony tick execution
//
// Colony is a data/state container. ColonyProcess is the Kernel adapter
// that handles the tick lifecycle (refresh → run) under the scheduler's
// CPU budget, load shedding, and panic protocols.
// ============================================================================

import { Process } from "../../kernel/Process";
import { Colony } from "../colony/Colony";

export class ColonyProcess extends Process {
    /** Room name this colony manages. Stored as a string (Getter Pattern). */
    readonly colonyName: string;

    /** Stable process identifier for deduplication. */
    processId: string;

    /** Process type name used for serialization and lookup. */
    readonly processName = "colony";

    /**
     * Static registry for Colony data objects.
     * Allows lookup by room name from anywhere in the codebase.
     * Keyed by room name to avoid storing live Game objects.
     */
    static colonies: { [name: string]: Colony } = {};

    constructor(pid: number, priority: number, parentPID: number | null, colonyName: string) {
        super(pid, priority, parentPID);
        this.colonyName = colonyName;
        this.processId = `colony:${colonyName}`;

        // Initialize colony data object if not already in registry
        if (!ColonyProcess.colonies[this.colonyName]) {
            this.colony = new Colony(this.colonyName);
            ColonyProcess.colonies[this.colonyName] = this.colony;
        }
    }

    /**
     * Colony data object accessor.
     * Uses the static registry to avoid storing a direct reference
     * that could hold stale Game object references.
     */
    get colony(): Colony {
        return ColonyProcess.colonies[this.colonyName];
    }

    set colony(c: Colony) {
        ColonyProcess.colonies[this.colonyName] = c;
    }

    run(): void {
        // Colony refresh + run under Kernel's CPU budget
        this.colony.refresh();
        this.colony.run();
    }

    serialize(): Record<string, unknown> {
        return {
            colonyName: this.colonyName,
        };
    }
}
