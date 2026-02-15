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

        room.find(FIND_STRUCTURES).forEach(struct => {
            if (struct.structureType === STRUCTURE_ROAD) {
                costs.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType === STRUCTURE_CONTAINER) {
                costs.set(struct.pos.x, struct.pos.y, 1); // Walkable, but preferred? maybe slightly higher than road? 1 is fine.
            } else if (struct.structureType !== STRUCTURE_RAMPART || !(struct as StructureRampart).my) {
                costs.set(struct.pos.x, struct.pos.y, 0xff);
            }
        });

        room.find(FIND_CONSTRUCTION_SITES).forEach(site => {
            if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER && site.structureType !== STRUCTURE_RAMPART) {
                costs.set(site.pos.x, site.pos.y, 0xff);
            }
        });

        room.find(FIND_CREEPS).forEach(creep => {
            if (!creep.my) {
                costs.set(creep.pos.x, creep.pos.y, 0xff);
            } else {
                // For our own creeps, don't make them absolute walls (0xff).
                // If we do, PathFinder will often fail entirely in crowded rooms.
                // Instead, make them an "expensive" tile so pathing prefers open space
                // but can still find a path "through" a crowded area.
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

        // CPU Yield Logic: If high CPU, delay pathfinding unless critical
        // Use 50% of limit instead of hard-coded 25
        const cpuLimit = (Game.cpu.limit || 20) * 0.5;
        if (Game.cpu.getUsed() > cpuLimit && !creep.memory.emergency && (creep.memory as any)._stuckCount < 2) {
            return;
        }

        // Global Routing
        if (dest.roomName !== creep.room.name) {
            const route = Game.map.findRoute(creep.room.name, dest.roomName, {
                routeCallback(roomName) {
                    if (Memory.remoteRooms && Memory.remoteRooms[roomName]) {
                        if (Memory.remoteRooms[roomName].state === 'hostile') return Infinity;
                    }
                    return 1;
                }
            });

            if (route !== ERR_NO_PATH) {
                const exit = creep.pos.findClosestByRange(route[0].exit);
                if (exit) {
                    creep.moveTo(exit);
                    return;
                }
            }
        }

        if (creep.pos.inRangeTo(dest, range)) {
            delete (creep.memory as any)._path;
            return;
        }

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
        // Stored as string of digits: "1334..."
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

        // Calculate Path
        // Calculate Path
        // THROTTLING: If Critical/Recovering, increase ReusePath
        const strategy = managerCPU.getStrategy(); // Need to import or pass?
        // Importing modules in pathing.ts might cause cycle?
        // Let's use Game.cpu.bucket directly to avoid circular dependency

        let shouldSearch = true;
        if (Game.cpu.bucket < 2000 && !creep.memory.emergency) {
            // Reuse existing path if possible?
            // Actually PathFinder.search doesn't reuse.
            // We can check creep.memory._path validity?
            // But if we are here, binary execution failed or ran out.

            // If critical, return incomplete path?
            // Or optimize search ops:
            // limit maxOps
        }

        const maxOps = Game.cpu.bucket < 2000 ? 500 : 2000;

        const ret = PathFinder.search(
            creep.pos,
            { pos: dest, range: range },
            {
                plainCost: 2,
                swampCost: 10,
                roomCallback: (roomName) => this.getCostMatrix(roomName),
                maxOps: maxOps
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
                creep.move(dir);
                mem._path = pathStr.substring(1);
            }
        }
    }
};
