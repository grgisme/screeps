import { ITask, TaskMemory, TaskSettings } from "./ITask";
import type { Zerg } from "../zerg/Zerg";

export class ReserveTask implements ITask {
    readonly name = "Reserve";
    settings: TaskSettings = { targetRange: 1, workRange: 1 };
    public readonly targetId: Id<StructureController>;

    constructor(targetId: Id<StructureController>) {
        this.targetId = targetId;
    }

    get target(): StructureController | null {
        return Game.getObjectById(this.targetId);
    }

    isValid(): boolean {
        return !!this.target;
    }

    run(zerg: Zerg): boolean {
        const target = this.target;
        if (!target) return true;

        if (zerg.pos && zerg.pos.inRangeTo(target, this.settings.workRange)) {
            const result = zerg.reserveController(target);
            if (result === ERR_INVALID_TARGET || result === ERR_NOT_OWNER) return true;
            return false; // Reserving is continuous
        } else {
            zerg.travelTo(target, this.settings.targetRange);
            return false;
        }
    }

    serialize(): TaskMemory {
        return { name: this.name, targetId: this.targetId as string, settings: { ...this.settings } };
    }
}
