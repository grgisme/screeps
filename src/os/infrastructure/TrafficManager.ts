// ============================================================================
// TrafficManager — Level 3 Bipartite Graph Matching (Gale-Shapley)
// ============================================================================
//
// Instead of sequential priority queues and heuristic shoving, this hands
// the entire room to Gale-Shapley stable matching. Every allied creep
// proposes to tiles in preference order (target → current → adjacent).
// Tiles accept the highest-priority proposer. The result is a globally
// optimal 1:1 mapping of N creeps to M tiles, resolving swaps, cascading
// shoves, and deadlocks in a single mathematical pass.
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";
import { getPositionAtDirection } from "../../utils/RoomPosition";
import { GlobalCache } from "../../kernel/GlobalCache";
import { stableMatch, MatchProposer, MatchReceiver } from "../../utils/Algorithms";

const OBSTACLE_SET = new Set<string>(OBSTACLE_OBJECT_TYPES as string[]);

const log = new Logger("TrafficManager");

export interface MoveIntent {
    zerg: Zerg;
    direction: DirectionConstant;
    priority: number;
}

export class TrafficManager {
    private static intents: MoveIntent[] = [];

    static register(zerg: Zerg, direction: DirectionConstant, priority: number): void {
        this.intents.push({ zerg, direction, priority });
    }

    static run(): void {
        try {
            // Traffic is inherently localized per-room. Group intents.
            const intentsByRoom = new Map<string, MoveIntent[]>();
            const activeRooms = new Set<string>();

            for (const intent of this.intents) {
                if (!intent.zerg.pos || (intent.direction as number) === 0) continue;
                const rn = intent.zerg.pos.roomName;
                if (!intentsByRoom.has(rn)) intentsByRoom.set(rn, []);
                intentsByRoom.get(rn)!.push(intent);
                activeRooms.add(rn);
            }

            for (const roomName of activeRooms) {
                this.resolveBipartiteTraffic(roomName, intentsByRoom.get(roomName) || []);
            }
        } finally {
            this.intents = [];
        }
    }

    private static resolveBipartiteTraffic(roomName: string, roomIntents: MoveIntent[]): void {
        const room = Game.rooms[roomName];
        if (!room) return;

        // ── Fix #5: Filter out spawning creeps — they share spawn coords
        // but cannot move. Including them corrupts the graph.
        const myCreeps = room.find(FIND_MY_CREEPS).filter(c => !c.spawning);
        if (myCreeps.length === 0) return;

        const staticKey = `matrix_static:${roomName}`;
        const staticCached = GlobalCache.get<{ tick: number, matrix: CostMatrix }>(staticKey);
        let matrix: CostMatrix;
        if (staticCached) {
            matrix = staticCached.matrix;
        } else {
            matrix = new PathFinder.CostMatrix();
            room.find(FIND_STRUCTURES).forEach((s: any) => {
                if (OBSTACLE_SET.has(s.structureType) ||
                    (s.structureType === STRUCTURE_RAMPART && !s.my)) {
                    matrix.set(s.pos.x, s.pos.y, 255);
                }
            });
            // Cache it so we don't rebuild from FIND_STRUCTURES every tick
            GlobalCache.set(staticKey, { tick: Game.time, matrix });
        }
        const terrain = Game.map.getRoomTerrain(roomName);

        const proposers: MatchProposer[] = [];
        const receiversMap = new Map<string, MatchReceiver>();
        const tileMap = new Map<string, RoomPosition>();

        // Map intents for O(1) lookup
        const intentMap = new Map<string, MoveIntent>();
        for (const i of roomIntents) intentMap.set(i.zerg.name, i);

        // ── Fix #4: O(1) creep position lookup instead of lookFor ──
        const creepAtPos = new Map<string, Creep>();
        for (const c of myCreeps) {
            creepAtPos.set(`${c.pos.roomName}_${c.pos.x},${c.pos.y}`, c);
        }

        // ── Fix #2: Use roomName-qualified tile IDs to prevent cross-room collisions ──
        const addReceiver = (pos: RoomPosition): string => {
            const id = `${pos.roomName}_${pos.x},${pos.y}`;
            if (!receiversMap.has(id)) {
                receiversMap.set(id, {
                    id: id,
                    capacity: 1,
                    score: (proposerId: string) => {
                        const creep = Game.creeps[proposerId];
                        const intent = intentMap.get(proposerId);
                        let score = intent ? intent.priority : 0;

                        if (creep && creep.pos.x === pos.x && creep.pos.y === pos.y && creep.pos.roomName === pos.roomName) {
                            const taskName = (creep.memory as any).task?.name;
                            // ── Fix #3: Only truly stationary roles get +10000 ──
                            // Fatigued creeps get standard tie-break so high-priority
                            // movers can evict them (using pull mechanic in phase 3).
                            if (taskName === "Harvest" || taskName === "Upgrade" || taskName === "Pull" ||
                                (creep.memory as any).role === "miner") {
                                score += 10000;
                            } else {
                                score += 0.1; // Resist shoves, but yield to higher priority
                            }
                        }
                        return score;
                    }
                });
                tileMap.set(id, pos);
            }
            return id;
        };

        const DIRS: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];

        // ── Fix #2: Track creeps that moved off-grid (room transition) ──
        const exitedCreeps = new Set<string>();

        // ── 1. BUILD PROPOSERS & PREFERENCES ──
        for (const creep of myCreeps) {
            const intent = intentMap.get(creep.name);
            const currentPos = creep.pos;

            // ── Fix #2: Inter-room exit bypass ──
            // If creep wants to move off-grid into a new room, execute the
            // native .move() immediately and skip the bipartite graph.
            // This frees the exit tile for other creeps in the same tick.
            if (intent && (intent.direction as number) !== 0) {
                const targetPos = getPositionAtDirection(currentPos, intent.direction);
                if (targetPos && targetPos.roomName !== roomName) {
                    creep.move(intent.direction);
                    exitedCreeps.add(creep.name);
                    continue; // Skip graph — tile is now freed
                }
            }

            const prefs: string[] = [];

            // Preference 1: The desired target tile (same room only — cross-room handled above)
            if (intent && (intent.direction as number) !== 0) {
                const targetPos = getPositionAtDirection(currentPos, intent.direction);
                if (targetPos && targetPos.roomName === roomName) {
                    prefs.push(addReceiver(targetPos));
                }
            }

            // ── Fatigued creeps: can only swap with their evictors ──
            // Without proposing to the evictor's tile, Gale-Shapley leaves
            // the fatigued creep unmatched, breaking the mutual swap intent
            // required by the pull() mechanic below.
            if (creep.fatigue > 0) {
                // Preference 1: The tile of whoever is trying to take our spot
                for (const otherIntent of roomIntents) {
                    if (otherIntent.zerg.name === creep.name || (otherIntent.direction as number) === 0) continue;
                    if (!otherIntent.zerg.pos) continue;

                    const otherTarget = getPositionAtDirection(otherIntent.zerg.pos, otherIntent.direction);
                    if (otherTarget && otherTarget.isEqualTo(currentPos)) {
                        prefs.push(addReceiver(otherIntent.zerg.pos));
                    }
                }

                // Preference 2: Stay still
                prefs.push(addReceiver(currentPos));

                proposers.push({ id: creep.name, preferences: prefs });
                continue;
            }

            // Preference 2: The current tile (yield / stay still)
            prefs.push(addReceiver(currentPos));

            // Preference 3-N: Adjacent tiles (allow self to be shoved)
            const shuffledDirs = [...DIRS].sort(() => Math.random() - 0.5);
            for (const dir of shuffledDirs) {
                const adjPos = getPositionAtDirection(currentPos, dir);
                if (!adjPos || adjPos.roomName !== roomName) continue;

                if (adjPos.x === 0 || adjPos.x === 49 || adjPos.y === 0 || adjPos.y === 49) continue;
                if ((terrain.get(adjPos.x, adjPos.y) & TERRAIN_MASK_WALL) !== 0) continue;
                if (matrix.get(adjPos.x, adjPos.y) >= 255) continue;

                prefs.push(addReceiver(adjPos));
            }

            proposers.push({ id: creep.name, preferences: prefs });
        }

        // ── 2. EXECUTE GALE-SHAPLEY STABLE MATCHING ──
        const receivers = Array.from(receiversMap.values());
        const matches = stableMatch(proposers, receivers);

        // ── 3. TRANSLATE MATHEMATICAL MATCHES INTO NATIVE MOVES ──
        let movesThisTick = 0;
        let shovesThisTick = 0;

        for (const creep of myCreeps) {
            // Skip creeps that already moved off-grid in phase 1
            if (exitedCreeps.has(creep.name)) continue;

            const matchedTileId = matches.get(creep.name);
            if (!matchedTileId) continue;

            const matchedPos = tileMap.get(matchedTileId)!;

            // The algorithm decided this creep should stay still
            if (matchedPos.isEqualTo(creep.pos)) continue;

            const moveDir = creep.pos.getDirectionTo(matchedPos);

            // ── Fix #4: O(1) creep lookup instead of lookFor ──
            const tileKey = `${matchedPos.roomName}_${matchedPos.x},${matchedPos.y}`;
            const blocker = creepAtPos.get(tileKey) || null;

            // ── Fix #1: pull() needs all three intents ──
            if (blocker && blocker.my) {
                const blockerAssignedTile = matches.get(blocker.name);
                const myCurrentTile = `${creep.pos.roomName}_${creep.pos.x},${creep.pos.y}`;

                // If the blocker is mathematically moving to OUR tile, it's a mutual swap
                if (blockerAssignedTile === myCurrentTile) {
                    if (blocker.fatigue > 0) {
                        // Fatigued: pull mechanic requires pull + blocker.move + initiator.move
                        creep.pull(blocker);
                        blocker.move(creep);
                        creep.say("🔗");
                        // DO NOT continue — fall through to creep.move(moveDir) below!
                        // pull() requires the initiator to also issue a .move() command.
                    }
                }
            }

            creep.move(moveDir);

            if (intentMap.has(creep.name) && intentMap.get(creep.name)!.direction === moveDir) {
                movesThisTick++;
            } else {
                creep.say("🔀");
                shovesThisTick++;
            }
        }

        if ((movesThisTick > 0 || shovesThisTick > 0) && Game.time % 5 === 0) {
            log.debug(`[${roomName}] Bipartite: ${movesThisTick} moved, ${shovesThisTick} shoved.`);
        }
    }
}
