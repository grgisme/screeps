// ============================================================================
// TrafficManager — Priority-based movement resolution
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";
import { getPositionAtDirection } from "../../utils/RoomPosition";
import { GlobalCache } from "../../kernel/GlobalCache";

const log = new Logger("TrafficManager");

export interface MoveIntent {
    zerg: Zerg;
    direction: DirectionConstant;
    priority: number;
}

export class TrafficManager {
    private static intents: MoveIntent[] = [];
    private static movesThisTick = 0;
    private static shovesThisTick = 0;

    static register(zerg: Zerg, direction: DirectionConstant, priority: number): void {
        this.intents.push({ zerg, direction, priority });
    }

    /**
     * Build a per-tick creep occupancy map for a room.
     * Returns a Uint8Array[2500] where 1 = tile has a creep.
     * Cached per-tick via GlobalCache to avoid redundant find() calls.
     */
    private static getOccupancy(roomName: string): Uint8Array {
        const key = `occupancy:${roomName}`;
        let cached = GlobalCache.get<{ tick: number, map: Uint8Array }>(key);
        if (cached && cached.tick === Game.time) return cached.map;

        const occ = new Uint8Array(2500);
        const room = Game.rooms[roomName];
        if (room) {
            const creeps = room.find(FIND_CREEPS);
            for (const c of creeps) {
                occ[c.pos.x * 50 + c.pos.y] = 1;
            }
        }
        cached = { tick: Game.time, map: occ };
        GlobalCache.set(key, cached);
        return occ;
    }

    static run(): void {
        try {
            this.intents.sort((a, b) => a.priority - b.priority);

            for (const intent of this.intents) {
                if ((intent.direction as number) === 0) continue;

                const zerg = intent.zerg;
                if (!zerg.pos) continue;

                const targetPos = getPositionAtDirection(zerg.pos, intent.direction);

                if (!targetPos) {
                    // Border transition
                    zerg.creep!.move(intent.direction);
                    this.movesThisTick++;
                    continue;
                }

                const creepsAtTarget = targetPos.lookFor(LOOK_CREEPS);
                const blocker = creepsAtTarget.length > 0 ? creepsAtTarget[0] : null;

                if (blocker && blocker.my) {
                    const blockerIntentIndex = this.intents.findIndex(i => i.zerg.name === blocker.name && (i.direction as number) !== 0);
                    const blockerIntent = blockerIntentIndex > -1 ? this.intents[blockerIntentIndex] : null;

                    if (!blockerIntent) {
                        // Blocker is stationary — shove it out of the way
                        const shoved = this.shove(blocker, zerg);
                        if (shoved) this.shovesThisTick++;
                    } else if (intent.priority < blockerIntent.priority) {
                        // Only force swap on true head-to-head deadlocks
                        const isHeadToHead = blockerIntent.direction === blocker.pos.getDirectionTo(zerg.pos);

                        if (isHeadToHead) {
                            const swapDir = blocker.pos.getDirectionTo(zerg.pos);
                            blocker.move(swapDir);
                            blocker.say("🔄");
                            this.shovesThisTick++;
                            this.intents[blockerIntentIndex].direction = 0 as DirectionConstant;
                        }
                    }
                }

                zerg.creep!.move(intent.direction);
                this.movesThisTick++;
            }

            if (this.shovesThisTick > 0 && Game.time % 5 === 0) {
                log.debug(`Traffic: ${this.movesThisTick} moves, ${this.shovesThisTick} shoves/swaps.`);
            }
        } finally {
            this.intents = [];
            this.movesThisTick = 0;
            this.shovesThisTick = 0;
        }
    }

    // ── Recursive Shoving with Cycle Detection ──
    private static shove(creep: Creep, initiator: Zerg, depth = 0, locked = new Set<string>()): boolean {
        if (depth > 3) return false; // Max recursion depth to protect CPU
        if (locked.has(creep.name)) return false; // Prevent circular pushing loops
        locked.add(creep.name);

        if ((creep.memory as any).role === "miner") return false;

        // Protect stationary workers AND active train pullers
        const taskName = (creep.memory as any).task?.name;
        if (taskName === "Harvest" || taskName === "Upgrade" || taskName === "Pull") {
            return false;
        }

        // ── Pull Mechanic: bypass fatigue by pulling ──
        if (creep.fatigue > 0) {
            if (initiator.creep && initiator.pos) {
                initiator.creep.pull(creep);
                creep.move(initiator.creep);
                creep.say("🔄");
                return true;
            }
            return false;
        }

        const directions: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        const occupancy = this.getOccupancy(creep.pos.roomName);
        const terrain = Game.map.getRoomTerrain(creep.pos.roomName);
        const matrixKey = `matrix_static:${creep.pos.roomName}`;
        const matrixCached = GlobalCache.get<{ tick: number, matrix: CostMatrix }>(matrixKey);

        for (const dir of directions) {
            const pos = getPositionAtDirection(creep.pos, dir);
            if (!pos) continue;

            // Prevent Exit Bouncing
            if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) continue;

            // Wall check (terrain)
            if ((terrain.get(pos.x, pos.y) & TERRAIN_MASK_WALL) !== 0) continue;

            // Structure obstacle check via CostMatrix
            if (matrixCached && matrixCached.matrix.get(pos.x, pos.y) === 255) continue;

            // Creep occupancy check — recursively shove if occupied
            if (occupancy[pos.x * 50 + pos.y] !== 0) {
                const blockers = pos.lookFor(LOOK_CREEPS);
                if (blockers.length > 0 && blockers[0].my) {
                    const chainShoved = this.shove(blockers[0], initiator, depth + 1, locked);
                    if (!chainShoved) continue;
                } else {
                    continue; // Enemy creep or empty (stale occupancy)
                }
            }

            // Tile is empty (or was just vacated by recursive shove)
            // Update occupancy so the chain sees the new state
            occupancy[creep.pos.x * 50 + creep.pos.y] = 0;
            occupancy[pos.x * 50 + pos.y] = 1;

            creep.move(dir);
            creep.say(depth > 0 ? "⛓️" : "🚶");
            return true;
        }

        // Swap Fallback
        if (initiator.pos) {
            const swapDir = creep.pos.getDirectionTo(initiator.pos);
            creep.move(swapDir);
            creep.say("🔄");
            return true;
        }

        return false;
    }
}
