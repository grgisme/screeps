// ============================================================================
// Zerg — Creep Wrapper and Task Executor
// ============================================================================

import { ITask } from "../tasks/ITask";

/**
 * Zerg is a wrapper around the native Creep object.
 * It provides a consistent API for task execution and movement.
 */
export class Zerg {
    creep: Creep;
    task: ITask | null = null;

    constructor(creep: Creep) {
        this.creep = creep;
    }

    /** Unique name of the creep */
    get name(): string {
        return this.creep.name;
    }

    get pos(): RoomPosition {
        return this.creep.pos;
    }

    get room(): Room {
        return this.creep.room;
    }

    get memory(): CreepMemory {
        return this.creep.memory;
    }

    /**
     * Refresh the internal creep reference.
     * Must be called every tick because the Creep object is recreated by the game engine.
     */
    refresh(): void {
        const creep = Game.creeps[this.name];
        if (creep) {
            this.creep = creep;
        } else {
            // Creep is dead
            // We can handle cleanup here if needed
        }
    }

    /**
     * Run the current task.
     */
    run(): void {
        if (this.task) {
            if (!this.task.isValid()) {
                this.task = null;
                return;
            }

            const finished = this.task.run(this);
            if (finished) {
                this.task = null;
            }
        }
    }
}
