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

        // ── GRAPH SETUP ──
        // Include ALL allied creeps — even idle ones — so they can be
        // mathematically relocated when blocking active movers.
        const myCreeps = room.find(FIND_MY_CREEPS);
        if (myCreeps.length === 0) return;

        const staticKey = `matrix_static:${roomName}`;
        const staticCached = GlobalCache.get<{ tick: number, matrix: CostMatrix }>(staticKey);
        const matrix = staticCached ? staticCached.matrix : new PathFinder.CostMatrix();
        const terrain = Game.map.getRoomTerrain(roomName);

        const proposers: MatchProposer[] = [];
        const receiversMap = new Map<string, MatchReceiver>();
        const tileMap = new Map<string, RoomPosition>();

        // Map intents for O(1) lookup
        const intentMap = new Map<string, MoveIntent>();
        for (const i of roomIntents) intentMap.set(i.zerg.name, i);

        // Helper: Register a tile as a Receiver
        const addReceiver = (pos: RoomPosition): string => {
            const id = `${pos.x},${pos.y}`;
            if (!receiversMap.has(id)) {
                receiversMap.set(id, {
                    id: id,
                    capacity: 1, // Only 1 creep per tile permitted
                    score: (proposerId: string) => {
                        const creep = Game.creeps[proposerId];
                        const intent = intentMap.get(proposerId);
                        let score = intent ? intent.priority : 0;

                        // Massive priority boost for immovable creeps on their CURRENT tile
                        if (creep && creep.pos.x === pos.x && creep.pos.y === pos.y) {
                            const taskName = (creep.memory as any).task?.name;
                            if (creep.fatigue > 0 || taskName === "Harvest" || taskName === "Upgrade" || taskName === "Pull" ||
                                (creep.memory as any).role === "miner") {
                                score += 10000;
                            } else {
                                // Tie-breaker: Creeps naturally resist being shoved
                                score += 0.1;
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

        // ── 1. BUILD PROPOSERS & PREFERENCES ──
        for (const creep of myCreeps) {
            const intent = intentMap.get(creep.name);
            const currentPos = creep.pos;
            const prefs: string[] = [];

            // Preference 1: The desired target tile
            if (intent && (intent.direction as number) !== 0) {
                const targetPos = getPositionAtDirection(currentPos, intent.direction);
                if (targetPos && targetPos.roomName === roomName) {
                    prefs.push(addReceiver(targetPos));
                }
            }

            // Preference 2: The current tile (yield / stay still)
            prefs.push(addReceiver(currentPos));

            // Preference 3-N: Adjacent tiles (allow self to be shoved)
            // Shuffle so shoves don't constantly bias toward TOP
            const shuffledDirs = [...DIRS].sort(() => Math.random() - 0.5);
            for (const dir of shuffledDirs) {
                const adjPos = getPositionAtDirection(currentPos, dir);
                if (!adjPos || adjPos.roomName !== roomName) continue;

                // Reject exits, walls, and impassable structures
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
            const matchedTileId = matches.get(creep.name);
            if (!matchedTileId) continue;

            const matchedPos = tileMap.get(matchedTileId)!;

            // The algorithm decided this creep should stay still
            if (matchedPos.isEqualTo(creep.pos)) continue;

            const moveDir = creep.pos.getDirectionTo(matchedPos);

            // ── Native Engine Swap & Pull detection ──
            const creepsAtTarget = matchedPos.lookFor(LOOK_CREEPS);
            const blocker = creepsAtTarget.length > 0 ? creepsAtTarget[0] : null;

            if (blocker && blocker.my) {
                const blockerAssignedTile = matches.get(blocker.name);
                const myCurrentTile = `${creep.pos.x},${creep.pos.y}`;

                // If the blocker is mathematically moving to OUR tile, it's a mutual swap
                if (blockerAssignedTile === myCurrentTile) {
                    if (blocker.fatigue > 0) {
                        // Fatigued blockers CAN move if pulled
                        creep.pull(blocker);
                        blocker.move(creep);
                        creep.say("🔗");
                        continue;
                    }
                }
            }

            creep.move(moveDir);

            // Was it a normal move, or a mathematical shove?
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
