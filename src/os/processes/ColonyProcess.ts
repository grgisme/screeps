// ============================================================================
// ColonyProcess — Kernel-managed process for Colony tick execution
// ============================================================================

import { Process } from "../../kernel/Process";
import { Colony } from "../colony/Colony";
import { GlobalCache } from "../../kernel/GlobalCache";

export class ColonyProcess extends Process {
    readonly colonyName: string;
    processId: string;
    readonly processName = "colony";

    /** 
     * The colony data object. Tied to the instance, NOT a static registry, 
     * to prevent memory leaks when a room is lost and the process is pruned.
     */
    colony: Colony;

    constructor(pid: number, priority: number, parentPID: number | null, colonyName: string) {
        super(pid, priority, parentPID);
        this.colonyName = colonyName;
        this.processId = `colony:${colonyName}`;

        // Rehydrate ensures the Colony object survives a global reset without 
        // tying it to a permanent static registry that leaks when rooms are lost.
        this.colony = GlobalCache.rehydrate(
            `ColonyObj:${this.colonyName}`,
            () => new Colony(this.colonyName)
        );
    }

    run(): void {
        this.colony.refresh();
        this.colony.run();
    }

    serialize(): Record<string, unknown> {
        return {
            colonyName: this.colonyName,
        };
    }
}
