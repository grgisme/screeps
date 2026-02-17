// ============================================================================
// ColonyProcess — Kernel adapter for a Colony
// ============================================================================

import { Process } from "../../kernel/Process";
import { GlobalManager } from "../../core/GlobalManager";

export class ColonyProcess extends Process {
    colonyName: string;

    processId: string;
    processName = "colony";

    constructor(pid: number, priority: number, parentPID: number | null, colonyName: string) {
        super(pid, priority, parentPID);
        this.colonyName = colonyName;
        this.processId = `colony:${colonyName}`;
    }

    run(): void {
        const colony = GlobalManager.colonies.get(this.colonyName);
        if (colony) {
            colony.refresh();
            colony.run();
        }
    }

    serialize(): Record<string, unknown> {
        return {
            colonyName: this.colonyName
        };
    }
}
