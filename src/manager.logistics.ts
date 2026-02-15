import { micro } from "./MicroOptimizations";
import _ from "lodash";

export const managerLogistics = {
    // Cache tasks per tick
    _tasks: {} as { [roomName: string]: LogisticsTask[] },
    _tick: -1,

    run: function (room: Room) {
        // Generate tasks
        const tasks = this.getTasks(room);

        // Visualize (Optional)
        // tasks.forEach(t => room.visual.circle(t.pos, {fill: 'yellow', radius: 0.3}));

        // Auto-Expansion Trigger (Rarely)
        if (Game.time % 1000 === 0 && room.storage && room.controller && room.controller.level >= 4) {
            if (room.storage.store[RESOURCE_ENERGY] > 100000) {
                // Check if we are already expanding? (Check for claimer)
                // Or better: Checking map status
                const claimers = _.filter(Game.creeps, c => c.memory.role === 'claimer');
                if (claimers.length === 0) {
                    const bestRoom = require('./manager.intel').managerIntel.getBestExpansionRoom();
                    if (bestRoom) {
                        console.log(`🚀 EXPANSION: Launching Colony to ${bestRoom} from ${room.name}`);
                        // Spawn Claimer
                        const spawn = room.find(FIND_MY_SPAWNS)[0];
                        if (spawn) {
                            const name = 'claimer' + Game.time;
                            spawn.spawnCreep([CLAIM, MOVE, MOVE], name, {
                                memory: { role: 'claimer', room: room.name, working: false, state: 0, targetId: bestRoom as any }
                            });
                        }
                    }
                }
            }
        }
    },

    getTasks: function (room: Room): LogisticsTask[] {
        if (this._tick === Game.time && this._tasks[room.name]) {
            return this._tasks[room.name];
        }

        const tasks: LogisticsTask[] = [];

        // 1. Supply Requests (Who needs energy?)
        const targets = micro.find(room, FIND_MY_STRUCTURES).filter(s => {
            return (s.structureType === STRUCTURE_EXTENSION ||
                s.structureType === STRUCTURE_SPAWN ||
                s.structureType === STRUCTURE_TOWER) &&
                (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        });

        targets.forEach(s => {
            let priority = 1;
            const struct = s as AnyStoreStructure;
            if (s.structureType === STRUCTURE_SPAWN) priority = 10;
            if (s.structureType === STRUCTURE_EXTENSION) priority = 10;
            if (s.structureType === STRUCTURE_TOWER) {
                priority = (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 400 ? 5 : 1;
            }

            tasks.push({
                id: s.id,
                pos: s.pos,
                type: 'transfer',
                resource: RESOURCE_ENERGY,
                amount: struct.store.getFreeCapacity(RESOURCE_ENERGY),
                priority: priority
            });
        });

        // 2. Withdrawal Tasks (Who has energy?)
        // Dropped
        const dropped = micro.find(room, FIND_DROPPED_RESOURCES).filter(r => r.resourceType === RESOURCE_ENERGY && r.amount > 50);
        dropped.forEach(r => {
            tasks.push({
                id: r.id,
                pos: r.pos,
                type: 'pickup',
                resource: RESOURCE_ENERGY,
                amount: r.amount,
                priority: 5 // Medium priority to pick up
            });
        });

        // Containers
        const containers = micro.find(room, FIND_STRUCTURES).filter(s => s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store[RESOURCE_ENERGY] > 0);
        containers.forEach(s => {
            const amount = (s as StructureContainer).store[RESOURCE_ENERGY];
            tasks.push({
                id: s.id,
                pos: s.pos,
                type: 'withdraw',
                resource: RESOURCE_ENERGY,
                amount: amount,
                priority: amount > 1000 ? 5 : 2
            });
        });

        // Storage (Can be both source and sink, usually source if we have extensions needing fill)
        if (room.storage && room.storage.store[RESOURCE_ENERGY] > 0) {
            tasks.push({
                id: room.storage.id,
                pos: room.storage.pos,
                type: 'withdraw',
                resource: RESOURCE_ENERGY,
                amount: room.storage.store[RESOURCE_ENERGY],
                priority: 1 // Low priority fallback source
            });
        }

        this._tasks[room.name] = tasks;
        this._tick = Game.time;
        return tasks;
    },

    getTask: function (creep: Creep): LogisticsTask | null {
        // Simple logic:
        // If creep is empty, find highest priority 'withdraw'/'pickup' task.
        // If creep is full, find highest priority 'transfer' task.

        const tasks = this.getTasks(creep.room);
        let candidates: LogisticsTask[] = [];

        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            // Needs Energy
            candidates = tasks.filter(t => (t.type === 'withdraw' || t.type === 'pickup'));
        } else {
            // Has Energy (deliver)
            // If strictly full? Or just has some?
            // Usually haulers act when full or no more pickup.
            // Let's say if > 0 energy, can deliver.
            candidates = tasks.filter(t => t.type === 'transfer');
        }

        if (candidates.length === 0) return null;

        // Sort by Priority then Distance
        candidates.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return creep.pos.getRangeTo(a.pos) - creep.pos.getRangeTo(b.pos);
        });

        // Reserve? (Optional complex logic to not over-assign)
        // For now just return best.
        return candidates[0];
    }
};

export interface LogisticsTask {
    id: Id<any>;
    pos: RoomPosition;
    type: 'transfer' | 'withdraw' | 'pickup';
    resource: ResourceConstant;
    amount: number;
    priority: number;
}
