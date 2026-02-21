// ============================================================================
// Zerg — Creep Wrapper and Task Executor
// ============================================================================
//
// ⚠️ GETTER PATTERN RULE (V8 MEMORY LEAK PREVENTION)
// ════════════════════════════════════════════════════
// Zerg instances live in the Global Heap (owned by Overlords that persist
// across ticks). NEVER store live Game objects (Creep, Source, Structure)
// as properties. The V8 GC cannot collect the previous tick's game state
// if any heap-resident object holds a reference to it.
//
// CORRECT:  Store the creep's NAME (string). Use a getter to resolve
//           the live Creep from Game.creeps each tick.
// WRONG:    this.creep = creep;  // Leaks ~1-5 MB per tick!
//
// This same rule applies to all Task and Overlord classes.
// ============================================================================

import { ITask, TaskMemory } from "../tasks/ITask";
import { HarvestTask } from "../tasks/HarvestTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { UpgradeTask } from "../tasks/UpgradeTask";
import { BuildTask } from "../tasks/BuildTask";
import { RepairTask } from "../tasks/RepairTask";
import { ReserveTask } from "../tasks/ReserveTask";
import { TrafficManager } from "../infrastructure/TrafficManager";
import { Logger } from "../../utils/Logger";
import { GlobalCache } from "../../kernel/GlobalCache";
import { getPositionAtDirection } from "../../utils/RoomPosition";

const log = new Logger("Zerg");

/** O(1) obstacle lookup — replaces per-tick Array.includes() calls */
const OBSTACLE_SET = new Set<string>(OBSTACLE_OBJECT_TYPES as string[]);

/**
 * Zerg is a wrapper around the native Creep object.
 * It provides a consistent API for task execution, intent caching,
 * and movement via the TrafficManager.
 *
 * **Heap-safe:** Stores `creepName` (string), resolves the live `Creep`
 * each tick via a getter. No V8 memory leaks.
 *
 * **Task persistence:** Tasks are serialized to `CreepMemory.task` so
 * they survive global resets. Deserialization is handled in `run()`.
 *
 * **Intent caching:** Screeps has THREE independent intent pipelines
 * per tick. Three separate flags enforce this without blocking
 * legitimate simultaneous actions:
 *
 *   Work Pipeline  (hasWorkIntent):  harvest, build, repair,
 *       upgradeController, dismantle, attack, heal
 *   Store Pipeline (hasStoreIntent): transfer, withdraw, drop, pickup
 *   Ranged Pipeline (hasRangedIntent): rangedAttack, rangedMassAttack,
 *       rangedHeal
 *
 * A creep CAN `heal()` + `rangedAttack()` in the same tick because
 * they live on separate pipelines.
 */
export class Zerg {
    /** The creep's name — used to resolve the live Creep each tick. */
    readonly creepName: string;

    /** Current assigned task. Managed by setTask() for serialization. */
    task: ITask | null = null;

    // ── Tri-Pipeline Intent Flags ─────────────────────────────────────
    // Screeps permits one Work intent, one Store intent, AND one Ranged
    // intent per tick. Three flags prevent blocking legitimate combos
    // (e.g. heal + rangedAttack, harvest + transfer).

    /** Work pipeline: harvest, build, repair, upgrade, dismantle, attack, heal. */
    protected hasWorkIntent = false;

    /** Store pipeline: transfer, withdraw, drop, pickup. */
    protected hasStoreIntent = false;

    /** Ranged pipeline: rangedAttack, rangedMassAttack, rangedHeal. */
    protected hasRangedIntent = false;

    // -----------------------------------------------------------------------
    // Path caching — safe to store in heap (serialized strings + primitives)
    // -----------------------------------------------------------------------
    _path: { path: string; step: number; target: string; ticksToLive: number } | null = null;
    _stuckCount = 0;
    _lastPos: RoomPosition | null = null;
    _expectedPos: RoomPosition | null = null; // Tracks Shove Drift
    _blockedPos: RoomPosition | null = null;  // Deep-stuck repath penalty

    constructor(creepName: string) {
        this.creepName = creepName;
    }

    // -----------------------------------------------------------------------
    // Getters — resolve live Game objects each tick (Getter Pattern)
    // -----------------------------------------------------------------------

    /** Resolve the live Creep from Game.creeps. Returns undefined if dead. */
    get creep(): Creep | undefined {
        return Game.creeps[this.creepName];
    }

    /** Unique name of the creep. */
    get name(): string {
        return this.creepName;
    }

    /** Current position. Returns undefined if creep is dead. */
    get pos(): RoomPosition | undefined {
        return this.creep?.pos;
    }

    /** Current room. Returns undefined if creep is dead. */
    get room(): Room | undefined {
        return this.creep?.room;
    }

    /** Creep memory. Returns undefined if creep is dead. */
    get memory(): CreepMemory | undefined {
        return this.creep?.memory;
    }

    /** Remaining ticks before the creep dies of old age. */
    get ticksToLive(): number | undefined {
        return this.creep?.ticksToLive;
    }

    /** The creep's store (carried resources). */
    get store(): StoreDefinition | undefined {
        return this.creep?.store;
    }

    /** Movement fatigue — creep cannot move while fatigue > 0. */
    get fatigue(): number | undefined {
        return this.creep?.fatigue;
    }

    /** Check if the creep is still alive in the game world. */
    isAlive(): boolean {
        return this.creep !== undefined;
    }

    // -----------------------------------------------------------------------
    // Task Management — with serialization for amnesia prevention
    // -----------------------------------------------------------------------

    /**
     * Assign a task to this Zerg. Serializes to CreepMemory for persistence
     * across global resets. Pass null to clear the task.
     */
    setTask(task: ITask | null): void {
        this.task = task;
        const mem = this.memory;
        if (!mem) return;

        if (task) {
            mem.task = task.serialize();
        } else {
            delete mem.task;
        }
    }

    /**
     * Attempt to reconstruct the current task from CreepMemory.
     * Called when `this.task` is null but `memory.task` exists (i.e.,
     * after a global reset wiped the heap).
     */
    private deserializeTask(taskMem: TaskMemory): ITask | null {
        switch (taskMem.name) {
            case "Harvest":
                return new HarvestTask(taskMem.targetId as Id<Source>);
            case "Withdraw":
                return new WithdrawTask(taskMem.targetId as Id<Structure | Tombstone | Ruin>);
            case "Transfer":
                return new TransferTask(taskMem.targetId as Id<Structure | Creep>);
            case "Pickup":
                return new PickupTask(taskMem.targetId as Id<Resource>);
            case "Upgrade":
                return new UpgradeTask(taskMem.targetId as Id<StructureController>);
            case "Build":
                return new BuildTask(taskMem.targetId as Id<ConstructionSite>);
            case "Repair":
                return new RepairTask(taskMem.targetId as Id<Structure>);
            case "Reserve":
                return new ReserveTask(taskMem.targetId as Id<StructureController>);
            default:
                log.warning(`Unknown task type "${taskMem.name}" — clearing`);
                return null;
        }
    }

    // -----------------------------------------------------------------------
    // Intent-Cached Action Wrappers — Tri-Pipeline
    // -----------------------------------------------------------------------
    // Screeps allows ONE Work, ONE Store, AND ONE Ranged intent per tick.
    //
    // Work Pipeline   (hasWorkIntent):   harvest, build, repair,
    //    upgradeController, dismantle, attack, heal
    //
    // Store Pipeline  (hasStoreIntent):  transfer, withdraw, drop, pickup
    //
    // Ranged Pipeline (hasRangedIntent): rangedAttack, rangedMassAttack,
    //    rangedHeal
    // -----------------------------------------------------------------------

    // ── Work Pipeline ─────────────────────────────────────────────────

    /** Harvest a source or mineral. */
    harvest(target: Source | Mineral): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.harvest(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Repair a structure. */
    repair(target: Structure): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.repair(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Build a construction site. */
    build(target: ConstructionSite): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.build(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Upgrade the room controller. */
    upgradeController(target: StructureController): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.upgradeController(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Dismantle a structure. */
    dismantle(target: Structure): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.dismantle(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Melee attack a target. */
    attack(target: Creep | Structure): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.attack(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Heal self or another creep. */
    heal(target: Creep): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.heal(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    /** Reserve a neutral room controller. */
    reserveController(target: StructureController): ScreepsReturnCode {
        if (this.hasWorkIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.reserveController(target);
        if (result === OK) this.hasWorkIntent = true;
        return result;
    }

    // ── Ranged Pipeline ───────────────────────────────────────────────

    /** Ranged attack a target. */
    rangedAttack(target: Creep | Structure): ScreepsReturnCode {
        if (this.hasRangedIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.rangedAttack(target);
        if (result === OK) this.hasRangedIntent = true;
        return result;
    }

    /** Ranged mass attack. */
    rangedMassAttack(): ScreepsReturnCode {
        if (this.hasRangedIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.rangedMassAttack();
        if (result === OK) this.hasRangedIntent = true;
        return result;
    }

    /** Heal self or another creep at a distance. */
    rangedHeal(target: Creep): ScreepsReturnCode {
        if (this.hasRangedIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.rangedHeal(target);
        if (result === OK) this.hasRangedIntent = true;
        return result;
    }

    // ── Store Pipeline ────────────────────────────────────────────────

    /** Transfer resources to a target. */
    transfer(
        target: Structure | Creep,
        resourceType: ResourceConstant = RESOURCE_ENERGY,
        amount?: number
    ): ScreepsReturnCode {
        if (this.hasStoreIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.transfer(target, resourceType, amount);
        if (result === OK) this.hasStoreIntent = true;
        return result;
    }

    /** Withdraw resources from a target. */
    withdraw(
        target: Structure | Tombstone | Ruin,
        resourceType: ResourceConstant = RESOURCE_ENERGY,
        amount?: number
    ): ScreepsReturnCode {
        if (this.hasStoreIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.withdraw(target, resourceType, amount);
        if (result === OK) this.hasStoreIntent = true;
        return result;
    }

    /** Drop a resource on the ground. */
    drop(resourceType: ResourceConstant, amount?: number): ScreepsReturnCode {
        if (this.hasStoreIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.drop(resourceType, amount);
        if (result === OK) this.hasStoreIntent = true;
        return result;
    }

    /** Pick up a dropped resource. */
    pickup(target: Resource): ScreepsReturnCode {
        if (this.hasStoreIntent) return ERR_BUSY;
        const creep = this.creep;
        if (!creep) return ERR_NOT_OWNER;
        const result = creep.pickup(target);
        if (result === OK) this.hasStoreIntent = true;
        return result;
    }

    // -----------------------------------------------------------------------
    // Movement — cached pathing via TrafficManager
    // -----------------------------------------------------------------------

    /**
     * Move to a target using cached pathing and TrafficManager.
     * Path caching is heap-safe (serialized direction strings + primitives).
     */
    travelTo(target: RoomPosition | { pos: RoomPosition }, range = 1, priority = 1): void {
        const creep = this.creep;
        const currentPos = this.pos;
        if (!creep || !currentPos) return;

        // ── FIX 1: Fatigue Guard ──
        if ((this.fatigue ?? 0) > 0) return;

        const targetPos = "pos" in target ? target.pos : target;

        // ── Boundary Bounce Prevention ──
        // Only trigger when the creep JUST ENTERED this room (lastPos was in a
        // different room). If the creep is trying to LEAVE (walking toward an
        // exit from the interior), do NOT intercept — let the engine handle
        // the room transition.
        if ((currentPos.x === 0 || currentPos.x === 49 || currentPos.y === 0 || currentPos.y === 49) &&
            this._lastPos && this._lastPos.roomName !== currentPos.roomName) {
            const dx = currentPos.x === 0 ? 1 : currentPos.x === 49 ? -1 : 0;
            const dy = currentPos.y === 0 ? 1 : currentPos.y === 49 ? -1 : 0;
            const stepIn = new RoomPosition(currentPos.x + dx, currentPos.y + dy, currentPos.roomName);
            this._path = null;
            TrafficManager.register(this, currentPos.getDirectionTo(stepIn), priority + 10);
            return;
        }

        // ── FIX 2: Shove Detection & Step Validation ──
        if (this._path && this._lastPos) {
            const expectedDir = parseInt(this._path.path[this._path.step], 10) as DirectionConstant;
            const expectedPos = getPositionAtDirection(this._lastPos, expectedDir);

            if (currentPos.isEqualTo(this._lastPos)) {
                this._stuckCount++;
            } else if (expectedPos && currentPos.isEqualTo(expectedPos)) {
                // Moved correctly along the path
                this._stuckCount = 0;
                this._path.step++;
                this._path.ticksToLive--;
            } else {
                // We moved, but NOT along the expected path (we were shoved off-route!)
                this._path = null;
                this._stuckCount = 0;
            }
        } else if (this._lastPos && currentPos.isEqualTo(this._lastPos)) {
            this._stuckCount++;
        } else {
            this._stuckCount = 0;
        }

        this._lastPos = currentPos;

        // Validate remaining cache
        if (this._path) {
            if (this._stuckCount > 2 ||
                this._path.ticksToLive <= 0 ||
                this._path.target !== targetPos.toString() ||
                this._path.step >= this._path.path.length) {

                this._path = null;
                // Don't reset _stuckCount here — we need it for the
                // deep-stuck fallback below.
            } else if (currentPos.getRangeTo(targetPos) <= range) {
                this._path = null;
                return;
            }
        }

        // ── Deep-Stuck Repath ──
        // If stuck > 5 ticks, penalize the SPECIFIC tile that's blocking us
        // (the expected next step), not a uniform 3x3. This changes the
        // relative cost landscape so PathFinder finds a different route.
        if (this._stuckCount > 5) {
            // Calculate the specific tile we keep failing to reach
            if (this._path) {
                const blockedDir = parseInt(this._path.path[this._path.step], 10) as DirectionConstant;
                const blockedTarget = getPositionAtDirection(currentPos, blockedDir);
                this._blockedPos = blockedTarget || currentPos;
            } else {
                this._blockedPos = currentPos;
            }
            this._path = null;
            this._stuckCount = 0;
        }

        if (currentPos.inRangeTo(targetPos, range)) return;

        // ── Road-Aware Pathfinding with Static/Dynamic CostMatrix ──
        if (!this._path) {
            // ── Broadphase Corridor Routing ──
            // Use Game.map.findRoute to build a room corridor for inter-room
            // travel. This prevents PathFinder from flood-filling into
            // irrelevant adjacent rooms, saving massive CPU.
            let allowedRooms: Set<string> | undefined;
            if (currentPos.roomName !== targetPos.roomName) {
                const routeKey = `route:${currentPos.roomName}:${targetPos.roomName}`;
                let routeCached = GlobalCache.get<{ tick: number, rooms: Set<string> }>(routeKey);
                if (!routeCached || Game.time - routeCached.tick > 500) {
                    const route = Game.map.findRoute(currentPos.roomName, targetPos.roomName);
                    if (route !== ERR_NO_PATH) {
                        allowedRooms = new Set([currentPos.roomName, ...(route as Array<{ room: string }>).map(r => r.room)]);
                    }
                    routeCached = { tick: Game.time, rooms: allowedRooms || new Set([currentPos.roomName]) };
                    GlobalCache.set(routeKey, routeCached);
                } else {
                    allowedRooms = routeCached.rooms;
                }
            }

            const ret = PathFinder.search(currentPos, { pos: targetPos, range }, {
                plainCost: 2,
                swampCost: 10,
                maxOps: 10000,
                heuristicWeight: 1.2, // Greedy A* — ~30-40% CPU savings on long paths
                roomCallback: (roomName) => {
                    // Enforce broadphase corridor
                    if (allowedRooms && !allowedRooms.has(roomName)) return false;
                    const room = Game.rooms[roomName];
                    if (!room) return false;

                    // --- Static layer: structures (cached 100 ticks) ---
                    const staticKey = `matrix_static:${roomName}`;
                    let staticCached = GlobalCache.get<{ tick: number, matrix: CostMatrix }>(staticKey);

                    if (!staticCached || Game.time - staticCached.tick > 100) {
                        const costs = new PathFinder.CostMatrix();
                        room.find(FIND_STRUCTURES).forEach(s => {
                            if (OBSTACLE_SET.has(s.structureType) ||
                                (s.structureType === STRUCTURE_RAMPART && !(s as OwnedStructure).my)) {
                                costs.set(s.pos.x, s.pos.y, 255);
                            } else if (s.structureType === STRUCTURE_ROAD) {
                                // Only set road cost if tile is NOT already an obstacle
                                if (costs.get(s.pos.x, s.pos.y) !== 255) {
                                    costs.set(s.pos.x, s.pos.y, 1);
                                }
                            }
                        });
                        staticCached = { tick: Game.time, matrix: costs };
                        GlobalCache.set(staticKey, staticCached);
                    }

                    // --- Dynamic layer: clone static + overlay creeps (per-tick) ---
                    const dynamicKey = `matrix_dynamic:${roomName}`;
                    let dynamicCached = GlobalCache.get<{ tick: number, matrix: CostMatrix }>(dynamicKey);

                    if (!dynamicCached || dynamicCached.tick !== Game.time) {
                        const costs = staticCached.matrix.clone();
                        room.find(FIND_MY_CREEPS).forEach(c => {
                            // Only mark OTHER miners as obstacles, never self.
                            // A miner marking its own current tile as cost-255 makes
                            // PathFinder see the start tile as impassable → empty path
                            // → "⛔ Blocked" → miner stuck near spawn forever.
                            if (c.memory.role === 'miner' && c.name !== this.creepName) {
                                costs.set(c.pos.x, c.pos.y, 255);
                            }
                        });
                        dynamicCached = { tick: Game.time, matrix: costs };
                        GlobalCache.set(dynamicKey, dynamicCached);
                    }

                    // Deep-stuck repath: penalize the specific blocking tile
                    if (this._blockedPos && roomName === this._blockedPos.roomName) {
                        const unstuckMatrix = dynamicCached.matrix.clone();
                        const bx = this._blockedPos.x;
                        const by = this._blockedPos.y;
                        if (bx >= 0 && bx <= 49 && by >= 0 && by <= 49) {
                            unstuckMatrix.set(bx, by, 255); // Hard-block the specific tile
                        }
                        // Clear OUTSIDE callback so incomplete paths don't lose the penalty
                        return unstuckMatrix;
                    }

                    return dynamicCached.matrix;
                }
            });

            // Clear _blockedPos AFTER search completes, not inside the callback.
            // If PathFinder hit maxOps and returned incomplete, the callback already
            // used the penalty. Clearing here ensures it's consumed exactly once.
            this._blockedPos = null;

            if (ret.path.length === 0) {
                creep.say("⛔ Blocked");
                return;
            }

            this._path = {
                path: this.serializePath(currentPos, ret.path),
                step: 0,
                target: targetPos.toString(),
                ticksToLive: ret.path.length
            };
        }

        // Follow Path
        if (this._path && this._path.step < this._path.path.length) {
            const direction = parseInt(this._path.path[this._path.step], 10) as DirectionConstant;
            if (direction) {
                TrafficManager.register(this, direction, priority);
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

    // -----------------------------------------------------------------------
    // Task Execution Loop
    // -----------------------------------------------------------------------

    /**
     * Execute the current task for this tick.
     * Handles task deserialization after global resets, intent caching
     * reset, and task lifecycle (validate → run → clear on completion).
     */
    run(): void {
        if (!this.isAlive()) return;
        if (this.creep?.spawning) return; // Spawning creeps waste CPU on pathfinding/logic

        // Reset tri-pipeline intent flags for this tick
        this.hasWorkIntent = false;
        this.hasStoreIntent = false;
        this.hasRangedIntent = false;

        // Deserialize task from memory if heap was wiped (global reset)
        const mem = this.memory;
        if (!this.task && mem?.task) {
            this.task = this.deserializeTask(mem.task as TaskMemory);
            if (!this.task && mem) {
                delete mem.task; // Clean up invalid serialized task
            }
        }

        // Execute task
        if (this.task) {
            if (!this.task.isValid()) {
                this.setTask(null);
                return;
            }

            const finished = this.task.run(this);
            if (finished) {
                this.setTask(null);
            }
        }
    }
}
