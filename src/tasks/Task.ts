/**
 * Task System — Encapsulates a target, an action, and a completion condition.
 *
 * A Task represents a single unit of work assigned to a Zerg:
 *   "Go to Source X and harvest it"
 *   "Transfer energy to Spawn Y"
 *   "Move to position Z"
 *
 * The Zerg doesn't need to know WHY it's doing the task — that logic
 * lives in the Overlord that assigned the task. The Zerg just executes.
 *
 * Tasks are serializable to creep.memory.task for persistence.
 */
import { trafficManager } from "../movement/TrafficManager";

// ─── TASK TYPES ────────────────────────────────────────────────────

export type TaskAction =
    | 'harvest'
    | 'transfer'
    | 'withdraw'
    | 'pickup'
    | 'build'
    | 'repair'
    | 'upgrade'
    | 'moveTo'
    | 'reserve'
    | 'claim'
    | 'attack'
    | 'heal'
    | 'drop'
    | 'idle';

/** Serialized task stored in creep.memory.task */
export interface TaskMemory {
    action: TaskAction;
    targetId: string | null;   // Game object ID (null for moveTo/idle)
    targetPos: { x: number, y: number, roomName: string } | null;
    resource?: ResourceConstant;
    range: number;             // How close to get before acting
    data?: Record<string, any>; // Action-specific metadata
}

// ─── TASK CLASS ────────────────────────────────────────────────────

export class Task {
    action: TaskAction;
    targetId: string | null;
    targetPos: RoomPosition | null;
    resource: ResourceConstant;
    range: number;
    data: Record<string, any>;

    constructor(
        action: TaskAction,
        targetId: string | null = null,
        targetPos: RoomPosition | null = null,
        range: number = 1,
        resource: ResourceConstant = RESOURCE_ENERGY,
        data: Record<string, any> = {},
    ) {
        this.action = action;
        this.targetId = targetId;
        this.targetPos = targetPos;
        this.range = range;
        this.resource = resource;
        this.data = data;
    }

    /** Get the game object for this task's target */
    getTarget(): RoomObject | null {
        if (!this.targetId) return null;
        return Game.getObjectById(this.targetId as Id<any>);
    }

    /**
     * Execute this task on the given creep.
     * Returns true if the task is complete, false if still in progress.
     */
    execute(creep: Creep): boolean {
        const target = this.getTarget();
        const pos = this.targetPos || target?.pos;

        // If we have a position and aren't in range, use TrafficManager
        if (pos && !creep.pos.inRangeTo(pos, this.range)) {
            trafficManager.travelTo(creep, pos, { range: this.range });
            return false;
        }

        // Execute the action
        switch (this.action) {
            case 'harvest': {
                if (!target) return true;
                const result = creep.harvest(target as Source | Mineral);
                if (result === ERR_NOT_ENOUGH_RESOURCES) return true; // Source empty
                if (creep.store.getFreeCapacity() === 0) return true; // Full
                return false;
            }
            case 'transfer': {
                if (!target) return true;
                const result = creep.transfer(target as Structure, this.resource);
                return result === OK || result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES;
            }
            case 'withdraw': {
                if (!target) return true;
                const result = creep.withdraw(target as Structure, this.resource);
                return result === OK || result === ERR_NOT_ENOUGH_RESOURCES;
            }
            case 'pickup': {
                if (!target) return true;
                const result = creep.pickup(target as Resource);
                return result === OK || result === ERR_INVALID_TARGET;
            }
            case 'build': {
                if (!target) return true;
                const result = creep.build(target as ConstructionSite);
                if (result === ERR_INVALID_TARGET) return true; // Construction complete
                return creep.store[RESOURCE_ENERGY] === 0;
            }
            case 'repair': {
                if (!target) return true;
                const struct = target as Structure;
                if (struct.hits >= struct.hitsMax) return true;
                const result = creep.repair(struct);
                return creep.store[RESOURCE_ENERGY] === 0 || result === ERR_INVALID_TARGET;
            }
            case 'upgrade': {
                if (!target) return true;
                creep.upgradeController(target as StructureController);
                return creep.store[RESOURCE_ENERGY] === 0;
            }
            case 'moveTo': {
                // Already handled by the move-to-position logic above
                return pos ? creep.pos.inRangeTo(pos, this.range) : true;
            }
            case 'reserve': {
                if (!target) return true;
                creep.reserveController(target as StructureController);
                return false; // Continuous task
            }
            case 'claim': {
                if (!target) return true;
                const result = creep.claimController(target as StructureController);
                return result === OK;
            }
            case 'attack': {
                if (!target) return true;
                creep.attack(target as Creep | Structure);
                return false;
            }
            case 'heal': {
                if (!target) return true;
                creep.heal(target as Creep);
                return false;
            }
            case 'drop': {
                creep.drop(this.resource);
                return true;
            }
            case 'idle': {
                return false; // Never completes on its own
            }
            default:
                return true;
        }
    }

    /** Check if the task is still valid */
    isValid(): boolean {
        if (this.action === 'idle' || this.action === 'moveTo') return true;
        if (this.targetId) {
            const target = Game.getObjectById(this.targetId as Id<any>);
            return target !== null;
        }
        return this.targetPos !== null;
    }

    /** Serialize for creep.memory */
    serialize(): TaskMemory {
        return {
            action: this.action,
            targetId: this.targetId,
            targetPos: this.targetPos ? { x: this.targetPos.x, y: this.targetPos.y, roomName: this.targetPos.roomName } : null,
            resource: this.resource,
            range: this.range,
            data: this.data,
        };
    }

    /** Deserialize from creep.memory */
    static deserialize(mem: TaskMemory): Task {
        const pos = mem.targetPos
            ? new RoomPosition(mem.targetPos.x, mem.targetPos.y, mem.targetPos.roomName)
            : null;
        return new Task(mem.action, mem.targetId, pos, mem.range, mem.resource, mem.data || {});
    }

    // ─── FACTORY METHODS ───────────────────────────────────────────

    static harvest(source: Source | Mineral): Task {
        return new Task('harvest', source.id, source.pos, 1);
    }

    static transfer(target: Structure, resource: ResourceConstant = RESOURCE_ENERGY): Task {
        return new Task('transfer', target.id, target.pos, 1, resource);
    }

    static withdraw(target: Structure, resource: ResourceConstant = RESOURCE_ENERGY): Task {
        return new Task('withdraw', target.id, target.pos, 1, resource);
    }

    static pickup(resource: Resource): Task {
        return new Task('pickup', resource.id, resource.pos, 1);
    }

    static build(site: ConstructionSite): Task {
        return new Task('build', site.id, site.pos, 3);
    }

    static repair(structure: Structure): Task {
        return new Task('repair', structure.id, structure.pos, 3);
    }

    static upgrade(controller: StructureController): Task {
        return new Task('upgrade', controller.id, controller.pos, 3);
    }

    static moveTo(pos: RoomPosition, range: number = 0): Task {
        return new Task('moveTo', null, pos, range);
    }

    static reserve(controller: StructureController): Task {
        return new Task('reserve', controller.id, controller.pos, 1);
    }

    static claim(controller: StructureController): Task {
        return new Task('claim', controller.id, controller.pos, 1);
    }

    static idle(): Task {
        return new Task('idle', null, null, 0);
    }

    static drop(resource: ResourceConstant = RESOURCE_ENERGY): Task {
        return new Task('drop', null, null, 0, resource);
    }

    toString(): string {
        return `Task<${this.action}→${this.targetId?.substring(0, 6) || 'none'}>`;
    }
}
