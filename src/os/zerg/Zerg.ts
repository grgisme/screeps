// ============================================================================
// Zerg — Creep Wrapper and Task Executor
// ============================================================================

import { ITask } from "../tasks/ITask";
import { TrafficManager } from "../infrastructure/TrafficManager";

/**
 * Zerg is a wrapper around the native Creep object.
 * It provides a consistent API for task execution and movement.
 */
export class Zerg {
    creep: Creep;
    task: ITask | null = null;

    // Cached path structure: serialized string + current step index + target pos string
    _path: { path: string; step: number; target: string; ticksToLive: number } | null = null;
    _stuckCount = 0;
    _lastPos: RoomPosition | null = null;

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
        }
    }

    /**
     * Move to a target using cached pathing and TrafficManager.
     */
    travelTo(target: RoomPosition | { pos: RoomPosition }, range = 1, priority = 1): void {
        const targetPos = "pos" in target ? target.pos : target;

        // 1. Stuck Detection
        if (this._lastPos && this.pos.isEqualTo(this._lastPos)) {
            this._stuckCount++;
        } else {
            this._stuckCount = 0;
            this._lastPos = this.pos;
        }

        // 2. Validate Cache
        if (this._path) {
            // Check if stuck
            if (this._stuckCount > 2) {
                this._path = null;
                this._stuckCount = 0; // Reset stuck count
            }
            // Check TTL
            else if (this._path.ticksToLive <= 0) {
                this._path = null;
            }
            // Check target mismatch
            else if (this._path.target !== targetPos.toString()) {
                this._path = null;
            }
            // Check if reached (using range)
            else if (this.pos.getRangeTo(targetPos) <= range) {
                this._path = null;
            }
        }

        // Target reached?
        if (this.pos.inRangeTo(targetPos, range)) {
            return;
        }

        // 3. Generate Path if needed
        if (!this._path) {
            const ret = PathFinder.search(this.pos, { pos: targetPos, range }, {
                plainCost: 2,
                swampCost: 10,
                maxOps: 2000
            });

            if (ret.incomplete) {
                return;
            }

            // Serialize path to string
            const pathString = this.serializePath(this.pos, ret.path);
            this._path = {
                path: pathString,
                step: 0,
                target: targetPos.toString(),
                ticksToLive: ret.path.length
            };
        }

        // 4. Follow Path
        if (this._path) {
            // Provide next direction
            const direction = parseInt(this._path.path[this._path.step], 10) as DirectionConstant;

            if (direction) {
                // Register intent
                TrafficManager.register(this, direction, priority);

                // Optimistic advance: We assume the move will succeed for path tracking purposes
                // If it fails (stuck), stuck detection will handle it next tick
                this._path.step++;
                this._path.ticksToLive--;

                // If we've exhausted the path, allow recalc next tick if not there yet
                if (this._path.step >= this._path.path.length) {
                    this._path = null;
                }
            }
        }
    }

    /**
     * Serialize array of positions to direction string (e.g. "123").
     */
    private serializePath(startPos: RoomPosition, path: RoomPosition[]): string {
        let result = "";
        let curr = startPos;
        for (const next of path) {
            result += curr.getDirectionTo(next);
            curr = next;
        }
        return result;
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
    /**
     * Check for threats and flee if necessary.
     * Returns true if the creep is fleeing and should abort other logic.
     */
    avoidDanger(): boolean {
        const room = this.creep.room;
        if (!Memory.rooms) Memory.rooms = {};
        const mem = Memory.rooms[room.name];

        // 1. Check Danger Signs
        let dangerous = false;
        if (mem && mem.isDangerous) {
            dangerous = true;
        } else {
            // Instant check for visible hostiles
            const hostiles = this.pos.findInRange(FIND_HOSTILE_CREEPS, 5, {
                filter: (c) => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK)
            });
            if (hostiles.length > 0) {
                dangerous = true;
            }
        }

        // 2. Flee if Dangerous
        if (dangerous) {
            // Drop current task
            this.task = null;
            this.creep.say("😨 FLEE");

            // Flee to Home Room (Storage or Spawn)
            const homeName = this.creep.memory.homeRoom;
            if (homeName) {
                // If we are already in home room and it's dangerous, maybe move to Spawn/Controller/Rampart?
                // But typically this logic is for remote creeps.

                const homeRoom = Game.rooms[homeName];
                let target: RoomPosition | undefined;

                if (homeRoom) {
                    if (homeRoom.storage) target = homeRoom.storage.pos;
                    else {
                        const spawns = homeRoom.find(FIND_MY_SPAWNS);
                        if (spawns.length > 0) target = spawns[0].pos;
                    }
                } else {
                    // Home room not visible? Just move to coords 25,25 of home room (blind)
                    target = new RoomPosition(25, 25, homeName);
                }

                if (target) {
                    this.travelTo(target, 5); // Stand near storage
                    return true;
                }
            }
        }

        return false;
    }
}
