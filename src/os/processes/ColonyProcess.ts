// ============================================================================
// ColonyProcess — Kernel adapter for a Colony
// ============================================================================

import { Process } from "../../kernel/Process";

import { Colony } from "../Colony";

export class ColonyProcess extends Process {
    colonyName: string;
    colony: Colony; // Add this property

    processId: string;
    processName = "colony";

    // Registry for lookup by name
    static colonies: { [name: string]: Colony } = {};

    constructor(pid: number, priority: number, parentPID: number | null, colonyName: string) {
        super(pid, priority, parentPID);
        this.colonyName = colonyName;
        this.processId = `colony:${colonyName}`;

        // Initialize colony if not already in static registry
        if (!ColonyProcess.colonies[this.colonyName]) {
            this.colony = new Colony(this.colonyName);
            ColonyProcess.colonies[this.colonyName] = this.colony;
        } else {
            this.colony = ColonyProcess.colonies[this.colonyName];
        }
    }

    run(): void {
        // Ensure colony exists in registry
        if (!ColonyProcess.colonies[this.colonyName]) {
            // We can't easily access the Colony object unless we created it.
            // But ColonyProcess creates the Colony object.
            // Let's store it.
        }

        // The constructor now ensures this.colony is set.
        // This block is redundant if the constructor handles it,
        // but keeping it as per instruction for now.
        if (!this.colony) {
            this.colony = new Colony(this.colonyName);
            ColonyProcess.colonies[this.colonyName] = this.colony;
        }

        this.colony.refresh(); // Added refresh back, as it's a common pattern for Colony objects
        this.colony.run();
    }

    serialize(): Record<string, unknown> {
        return {
            colonyName: this.colonyName
        };
    }
}
