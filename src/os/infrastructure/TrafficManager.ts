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
        const staticCached = GlobalCache.get<{ tick: number, matrix: CostMatrix, count: number }>(staticKey);
        const structCount = room.find(FIND_STRUCTURES).length;
        let matrix: CostMatrix;

        // Invalidate on structure-count change (build/destroy events) OR every 100 ticks
        // to catch gradual road-HP decay that doesn't change the structure count.
        const ROAD_DECAY_INTERVAL = 100;
        const cacheStale = !staticCached ||
            staticCached.count !== structCount ||
            (Game.time - staticCached.tick) >= ROAD_DECAY_INTERVAL;

        if (!cacheStale) {
            matrix = staticCached!.matrix;
        } else {
            matrix = new PathFinder.CostMatrix();
            room.find(FIND_STRUCTURES).forEach((s: any) => {
                if (OBSTACLE_SET.has(s.structureType) ||
                    (s.structureType === STRUCTURE_RAMPART && !s.my)) {
                    matrix.set(s.pos.x, s.pos.y, 255);
                } else if (s.structureType === STRUCTURE_ROAD) {
                    if (matrix.get(s.pos.x, s.pos.y) !== 255) {
                        // Roads below 20% HP are treated as plain terrain (cost 2).
                        // They're about to disappear and routing through them causes
                        // stale-path stalls the tick they vanish. Road-Repair-on-Transit
                        // keeps healthy roads at cost 1 the vast majority of the time.
                        const hpRatio = s.hits / s.hitsMax;
                        matrix.set(s.pos.x, s.pos.y, hpRatio < 0.2 ? 2 : 1);
                    }
                }
            });
            // Sync Sources/Minerals as solid rock (mirrors Zerg.ts static cache).
            room.find(FIND_SOURCES).forEach((s: Source) => matrix.set(s.pos.x, s.pos.y, 255));
            room.find(FIND_MINERALS).forEach((m: Mineral) => matrix.set(m.pos.x, m.pos.y, 255));

            GlobalCache.set(staticKey, { tick: Game.time, matrix, count: structCount });
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

                        if (!creep) return 0;

                        // 1. Proposing to the actual TARGET tile — use the intent priority directly.
                        if (intent && (intent.direction as number) !== 0) {
                            const targetPos = getPositionAtDirection(creep.pos, intent.direction);
                            if (targetPos && targetPos.x === pos.x && targetPos.y === pos.y && targetPos.roomName === pos.roomName) {
                                return intent.priority;
                            }
                        }

                        // 2. Proposing to the CURRENT (stay-still) tile.
                        if (creep.pos.x === pos.x && creep.pos.y === pos.y && creep.pos.roomName === pos.roomName) {
                            // Only truly stationary creeps (no move intent) get the parking score.
                            if (!intent || (intent.direction as number) === 0) {
                                const taskName = (creep.memory as any).task?.name;
                                const role = (creep.memory as any).role;
                                if (taskName === "Harvest" || taskName === "Upgrade" || taskName === "Pull" ||
                                    role === "miner" || role === "filler") {

                                    // FIX 3: Scope isParked correctly.
                                    // FIX 4: Tighten isParked checks and reduce score.
                                    //
                                    // isNearTo() checks a 3×3 grid — a worker merely walking past a
                                    // source on a road tile gets classified as "parked" if it pauses.
                                    // Miners/harvesters should only be truly parked when at range 1
                                    // from the source AND on a container tile (their workstation).
                                    //
                                    // Score reduced from 10000 to 50. This is still high enough to
                                    // resist standard haulers (priority 1-10) and shove proposals
                                    // (score 0.2), but emergency/military traffic (priority 100+)
                                    // can displace them when absolutely needed.
                                    // Fillers are a special case — they NEVER move and get 10000.
                                    let isParked = false;
                                    if (taskName === "Upgrade" && room.controller && creep.pos.inRangeTo(room.controller, 3)) {
                                        isParked = true;
                                    } else if (taskName === "Harvest" || role === "miner") {
                                        // Only truly parked if adjacent to a source AND on a container
                                        // (the designated mining spot). Just being isNearTo a source
                                        // on a road tile is NOT parked — that's a transient creep.
                                        const nearSource = room.find(FIND_SOURCES).some(s => creep.pos.isNearTo(s));
                                        const nearMineral = !nearSource && room.find(FIND_MINERALS).some(m => creep.pos.isNearTo(m));
                                        if (nearSource || nearMineral) {
                                            // Check if standing on a container (designated workstation)
                                            const onContainer = creep.pos.lookFor(LOOK_STRUCTURES)
                                                .some((s: Structure) => s.structureType === STRUCTURE_CONTAINER);
                                            isParked = onContainer || role === "miner"; // miners always park at their source
                                        }
                                    } else if (role === "filler") {
                                        // Fillers are permanent residents of the bunker center.
                                        // They NEVER move and must never be displaced by any traffic.
                                        return 10000;
                                    }

                                    if (isParked) return 50;
                                }

                                // Fix 5: Priority-Based Yielding.
                                // Truly idle creeps (no task at all) are the lowest-priority
                                // occupants in the room — they must yield to everything.
                                // Active movers score 1.0, shoves score 0.2; 0.01 guarantees
                                // any active creep can displace an idle one.
                                const hasTask = !!(creep.memory as any).task;
                                return hasTask ? 0.5 : 0.01;
                            } else {
                                // Creep is trying to move but blocked — hold ground against
                                // same-priority trailing traffic to form a stable queue.
                                // Without this, two same-priority creeps leapfrog endlessly:
                                // A blocks at 0.1, B (priority 1) evicts A; next tick B blocks
                                // at 0.1, A evicts B — infinite oscillation.
                                //
                                // Using intent.priority + 0.1 means:
                                //   - A priority-1 hauler holds at 1.1, resisting a trailing
                                //     priority-1 hauler (score 1.0) → stable queue forms.
                                //   - A priority-10 transporter (score 10.0) still displaces
                                //     the priority-1 hauler (1.1) → right-of-way preserved.
                                return intent.priority + 0.1;
                            }
                        }

                        // 3. Proposing to an adjacent fallback/shove tile.
                        return 0.2;
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
                // FIX 5: targetPos is null when stepping off grid (0-49 bounds)
                if (!targetPos || targetPos.roomName !== roomName) {
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
                    // FIX 3: Solid Target Sabotage guard.
                    // If a stale path points into a newly built extension (cost 255),
                    // skip the proposal entirely — the native engine would reject the
                    // move anyway, causing a silent stall every tick.
                    if (matrix.get(targetPos.x, targetPos.y) < 255) {
                        prefs.push(addReceiver(targetPos));
                    }
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

            // Preference 3-N: Adjacent tiles (allow self to be shoved).
            //
            // Use a deterministic per-creep order instead of Math.random().
            // A random shuffle changes each tick, so a displaced idle creep can
            // be sent to tile X one tick then tile Y the next — it never settles.
            // Hashing the creep name gives a stable, tick-invariant order that is
            // still unique per creep (so all idles don't pile into the same tile).
            const nameHash = creep.name.split('').reduce(
                (h, c) => Math.imul(h, 31) + c.charCodeAt(0) | 0, 0
            );
            const deterministicDirs = [...DIRS].sort((a, b) => {
                const ah = (Math.imul(nameHash ^ (a << 16), 0x9e3779b9)) >>> 0;
                const bh = (Math.imul(nameHash ^ (b << 16), 0x9e3779b9)) >>> 0;
                return ah - bh;
            });
            for (const dir of deterministicDirs) {
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

        // Track creeps whose move intents have been finalized by a swap.
        // In Screeps, only the LAST move() call per tick counts. If we issue
        // creep.pull(blocker) + creep.move(blocker) for a mutual swap, then
        // later call creep.move(direction), the directional move OVERWRITES
        // the swap target — silently breaking the pull() handshake.
        // handledSwaps prevents this by skipping the directional move.
        const handledSwaps = new Set<string>();

        // Build a set of all tiles assigned by Gale-Shapley so the step-aside
        // logic can avoid nudging a blocker into a tile that another creep is
        // simultaneously routing into (creepAtPos only shows start-of-tick state).
        const assignedTiles = new Set<string>(matches.values());

        for (const creep of myCreeps) {
            // Skip creeps that already moved off-grid in phase 1
            if (exitedCreeps.has(creep.name)) continue;
            // Skip creeps already handled by a prior swap iteration
            if (handledSwaps.has(creep.name)) continue;

            const matchedTileId = matches.get(creep.name);
            if (!matchedTileId) continue;

            const matchedPos = tileMap.get(matchedTileId)!;

            // The algorithm decided this creep should stay still
            if (matchedPos.isEqualTo(creep.pos)) continue;

            const moveDir = creep.pos.getDirectionTo(matchedPos);

            // ── Fix #4: O(1) creep lookup instead of lookFor ──
            const tileKey = `${matchedPos.roomName}_${matchedPos.x},${matchedPos.y}`;
            const blocker = creepAtPos.get(tileKey) || null;

            // ── Swap / Step-Aside resolution ──
            let isSwapping = false;

            if (blocker && blocker.my) {
                const blockerAssignedTile = matches.get(blocker.name);
                const myCurrentTile = `${creep.pos.roomName}_${creep.pos.x},${creep.pos.y}`;

                // If the blocker is mathematically moving to OUR tile, it's a mutual swap.
                if (blockerAssignedTile === myCurrentTile) {
                    // pull() is required for ALL move(creep) calls, not just fatigued ones.
                    //
                    // The Screeps engine requires a matching pull() from the target whenever
                    // a creep calls move(anotherCreep). Without pull(), move(creep) is
                    // silently rejected — swaps between two non-fatigued creeps on roads
                    // were silently failing because the fatigue guard suppressed pull().
                    // pull() also exempts the pulled creep from road/swamp fatigue costs.
                    //
                    // CRITICAL: Use move(blocker) not move(direction) — move(direction)
                    // would overwrite the pull() target. The Screeps engine needs the
                    // explicit creep reference to link the pull-move pair atomically.
                    creep.pull(blocker);
                    creep.move(blocker);
                    blocker.move(creep);
                    // Protect blocker from having its move(creep) overwritten when
                    // the loop processes it later.
                    handledSwaps.add(blocker.name);
                    isSwapping = true;
                    creep.say("🔗");
                } else if (!blockerAssignedTile || blockerAssignedTile !== myCurrentTile) {
                    // vacatePos Step-Aside:
                    // The blocker is idle (unmatched) OR matched to a THIRD tile (not
                    // a mutual swap). In either case, the blocker needs to vacate our
                    // target tile. Scan adjacent tiles for an off-path empty spot.
                    // The hauler keeps its straight-line move and the blocking creep
                    // steps onto a swamp/plain without blocking traffic.
                    let steppedAside = false;

                    // If the blocker IS matched to another tile, try to nudge it
                    // toward its assigned destination first (most natural resolution).
                    if (blockerAssignedTile) {
                        const assignedPos = tileMap.get(blockerAssignedTile);
                        if (assignedPos && !assignedPos.isEqualTo(blocker.pos)) {
                            const nudgeDir = blocker.pos.getDirectionTo(assignedPos);
                            // Verify the nudge tile is walkable and unoccupied
                            const nudgePos = getPositionAtDirection(blocker.pos, nudgeDir);
                            if (nudgePos && nudgePos.roomName === roomName &&
                                nudgePos.x > 0 && nudgePos.x < 49 && nudgePos.y > 0 && nudgePos.y < 49 &&
                                (terrain.get(nudgePos.x, nudgePos.y) & TERRAIN_MASK_WALL) === 0 &&
                                matrix.get(nudgePos.x, nudgePos.y) < 255) {
                                const nudgeKey = `${nudgePos.roomName}_${nudgePos.x},${nudgePos.y}`;
                                // Check both start-of-tick positions AND Gale-Shapley assignments
                                // to avoid nudging into a tile another creep is routing into.
                                if (!creepAtPos.has(nudgeKey) && !assignedTiles.has(nudgeKey)) {
                                    blocker.move(nudgeDir);
                                    steppedAside = true;
                                }
                            }
                        }
                    }

                    // General step-aside scan: find any adjacent empty tile
                    for (let d = 1; d <= 8 && !steppedAside; d++) {
                        const adjPos = getPositionAtDirection(blocker.pos, d as DirectionConstant);
                        if (!adjPos || adjPos.roomName !== roomName) continue;
                        if (adjPos.x === 0 || adjPos.x === 49 || adjPos.y === 0 || adjPos.y === 49) continue;
                        if ((terrain.get(adjPos.x, adjPos.y) & TERRAIN_MASK_WALL) !== 0) continue;
                        if (matrix.get(adjPos.x, adjPos.y) >= 255) continue; // wall/structure
                        const adjKey = `${adjPos.roomName}_${adjPos.x},${adjPos.y}`;
                        // Check both start-of-tick AND Gale-Shapley assigned tiles
                        if (creepAtPos.has(adjKey) || assignedTiles.has(adjKey)) continue;
                        // Clear tile found — step aside off the hauler's path
                        blocker.move(d as DirectionConstant);
                        steppedAside = true;
                    }
                    if (!steppedAside) {
                        // Boxed in — fall back to swap so the hauler isn't hard-blocked.
                        // Same pull() requirement applies (see mutual-swap comment above).
                        creep.pull(blocker);
                        creep.move(blocker);
                        blocker.move(creep);
                        handledSwaps.add(blocker.name);
                        isSwapping = true;
                        creep.say("🔄");
                    }
                }
            }

            // Only issue a directional move if we did NOT set up a swap.
            // move(direction) would overwrite the move(creep) from pull().
            if (!isSwapping) {
                creep.move(moveDir);
            }

            if (intentMap.has(creep.name) && intentMap.get(creep.name)!.direction === moveDir) {
                movesThisTick++;
            } else {
                shovesThisTick++;
            }
        }

        if ((movesThisTick > 0 || shovesThisTick > 0) && Game.time % 5 === 0) {
            log.debug(`[${roomName}] Bipartite: ${movesThisTick} moved, ${shovesThisTick} shoved.`);
        }
    }
}
