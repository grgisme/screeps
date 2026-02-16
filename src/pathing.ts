import { Dictionary } from "lodash";
import { managerCPU } from "./manager.cpu";

export const pathing = {
    // Cache for CostMatrix to avoid recalculating every tick
    _costMatrixCache: {} as Dictionary<CostMatrix>,
    _costMatrixTick: {} as Dictionary<number>,

    getCostMatrix: function (roomName: string): CostMatrix {
        if (this._costMatrixTick[roomName] === Game.time && this._costMatrixCache[roomName]) {
            return this._costMatrixCache[roomName];
        }

        const room = Game.rooms[roomName];
        let costs = new PathFinder.CostMatrix();

        if (!room) return costs;

        // USER REQUEST: Prioritize Road Efficiency
        room.find(FIND_STRUCTURES).forEach(struct => {
            if (struct.structureType === STRUCTURE_ROAD) {
                // Road cost: 1 (Always better than plain: 2)
                costs.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType === STRUCTURE_CONTAINER) {
                // Container cost: 1 (Walkable, effectively a road)
                costs.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType !== STRUCTURE_RAMPART || !(struct as StructureRampart).my) {
                // Impassable
                costs.set(struct.pos.x, struct.pos.y, 0xff);
            }
        });

        // Road Construction Sites: 1 (Encourage usage of planned paths)
        room.find(FIND_CONSTRUCTION_SITES).forEach(site => {
            if (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER) {
                costs.set(site.pos.x, site.pos.y, 1);
            } else if (site.structureType !== STRUCTURE_RAMPART) {
                costs.set(site.pos.x, site.pos.y, 0xff);
            }
        });

        room.find(FIND_CREEPS).forEach(creep => {
            if (!creep.my) {
                costs.set(creep.pos.x, creep.pos.y, 0xff);
            } else {
                // Friendly creeps: Avoidable but not impassable
                costs.set(creep.pos.x, creep.pos.y, 20);
            }
        });

        this._costMatrixCache[roomName] = costs;
        this._costMatrixTick[roomName] = Game.time;
        return costs;
    },

    run: function (creep: Creep, target: RoomPosition | { pos: RoomPosition }, range: number = 1) {
        if (creep.fatigue > 0) return;

        const dest = target instanceof RoomPosition ? target : target.pos;

        // Stuck Detection
        const mem = creep.memory as any;
        if (!mem._pos) {
            mem._pos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName };
            mem._stuckCount = 0;
        } else {
            if (creep.pos.x === mem._pos.x && creep.pos.y === mem._pos.y && creep.pos.roomName === mem._pos.roomName) {
                mem._stuckCount = (mem._stuckCount || 0) + 1;
            } else {
                mem._stuckCount = 0;
                mem._pos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName };
            }
        }

        if (mem._stuckCount >= 3) {
            delete mem._path;
            const dir = (Math.floor(Math.random() * 8) + 1) as DirectionConstant;
            creep.move(dir);
            return;
        }

        // Binary Path Execution
        if (mem._path && typeof mem._path === 'string') {
            const pathStr = mem._path as string;
            const dir = parseInt(pathStr[0], 10) as DirectionConstant;

            if (creep.move(dir) === OK) {
                mem._path = pathStr.substring(1);
                if (mem._path.length === 0) delete mem._path;
            } else {
                delete mem._path; // Failed, recalc
            }
            return;
        }

        // Global Routing: Find the exit tile and move to it using the CUSTOM PATHING
        if (dest.roomName !== creep.room.name) {
            const route = Game.map.findRoute(creep.room.name, dest.roomName, {
                routeCallback(roomName) {
                    if (Memory.remoteRooms && Memory.remoteRooms[roomName]) {
                        if (Memory.remoteRooms[roomName].state === 'hostile') return Infinity;
                    }
                    return 1;
                }
            });

            if (route !== ERR_NO_PATH && route.length > 0) {
                const exit = creep.pos.findClosestByRange(route[0].exit);
                if (exit) {
                    // RECURSIVE CALL: Navigate to the exit using road-aware logic
                    this.run(creep, exit, 0);
                    return;
                }
            }
        }

        if (creep.pos.inRangeTo(dest, range)) {
            delete (creep.memory as any)._path;
            return;
        }

        // CPU Yield Logic
        const cpuLimit = (Game.cpu.limit || 20) * 0.5;
        if (Game.cpu.getUsed() > cpuLimit && !creep.memory.emergency && (creep.memory as any)._stuckCount < 2) {
            return;
        }

        // Calculate Path with Road Bias
        const maxOps = Game.cpu.bucket < 2000 ? 500 : 2000;
        const ret = PathFinder.search(
            creep.pos,
            { pos: dest, range: range },
            {
                plainCost: 2,  // Plain tiles are 2x as expensive as roads
                swampCost: 10, // Swamps are 10x as expensive as roads
                maxOps: maxOps,
                roomCallback: (roomName) => this.getCostMatrix(roomName)
            }
        );

        if (ret.path.length > 0) {
            // Serialize to String
            let pathStr = "";
            let curr = creep.pos;
            for (const step of ret.path) {
                pathStr += curr.getDirectionTo(step);
                curr = step;
            }
            mem._path = pathStr;

            // Move first step
            if (pathStr.length > 0) {
                const dir = parseInt(pathStr[0], 10) as DirectionConstant;
                if (creep.move(dir) === OK) {
                    mem._path = pathStr.substring(1);
                    if (mem._path.length === 0) delete mem._path;
                }
            }
        }
    }
};
