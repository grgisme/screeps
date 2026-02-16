/**
 * Zerg - Wrapper around the native Creep object.
 *
 * A Zerg does NOT contain role logic. Instead, it has a `task` property
 * that is assigned by an Overlord. Each tick, the Zerg's run() method
 * executes whatever Task it has been given.
 *
 * The Overlord decides WHAT to do. The Zerg decides HOW.
 *
 * Lifecycle:
 *   1. Overlord assigns a Task → zerg.setTask(Task.harvest(source))
 *   2. Zerg.run() calls task.execute(creep)
 *   3. If task completes, Zerg goes idle → Overlord reassigns next tick
 */
import { Task, TaskMemory } from "../tasks/Task";
import { trafficManager, TravelToOpts } from "../movement/TrafficManager";

export class Zerg {
    /** The underlying Screeps Creep */
    creep: Creep;

    /** Current task assigned by an Overlord */
    task: Task | null;

    /** The Overlord PID that owns this Zerg */
    overlord: string | null;

    /** Cached body analysis */
    private _bodyAnalysis: BodyAnalysis | null = null;

    constructor(creep: Creep) {
        this.creep = creep;

        // Restore task from memory
        const mem = (creep.memory as any);
        this.task = mem.task ? Task.deserialize(mem.task as TaskMemory) : null;
        this.overlord = mem.overlord || null;
    }

    // ─── IDENTITY ──────────────────────────────────────────────────

    get name(): string { return this.creep.name; }
    get id(): Id<Creep> { return this.creep.id; }
    get pos(): RoomPosition { return this.creep.pos; }
    get room(): Room { return this.creep.room; }
    get store(): StoreDefinition { return this.creep.store; }
    get ticksToLive(): number | undefined { return this.creep.ticksToLive; }
    get spawning(): boolean { return this.creep.spawning; }
    get memory(): CreepMemory { return this.creep.memory; }

    // ─── BODY ANALYSIS ─────────────────────────────────────────────

    get body(): BodyAnalysis {
        if (!this._bodyAnalysis) {
            this._bodyAnalysis = {
                work: this.creep.getActiveBodyparts(WORK),
                carry: this.creep.getActiveBodyparts(CARRY),
                move: this.creep.getActiveBodyparts(MOVE),
                attack: this.creep.getActiveBodyparts(ATTACK),
                rangedAttack: this.creep.getActiveBodyparts(RANGED_ATTACK),
                heal: this.creep.getActiveBodyparts(HEAL),
                tough: this.creep.getActiveBodyparts(TOUGH),
                claim: this.creep.getActiveBodyparts(CLAIM),
            };
        }
        return this._bodyAnalysis;
    }

    /** How many WORK parts worth of harvesting per tick */
    get harvestPower(): number { return this.body.work * 2; }

    /** Total carry capacity */
    get carryCapacity(): number { return this.body.carry * 50; }

    // ─── TASK MANAGEMENT ───────────────────────────────────────────

    /** Assign a new task to this Zerg */
    setTask(task: Task): void {
        this.task = task;
        (this.creep.memory as any).task = task.serialize();
    }

    /** Clear the current task */
    clearTask(): void {
        this.task = null;
        delete (this.creep.memory as any).task;
    }

    /** Check if this Zerg is idle (no task or task completed) */
    get isIdle(): boolean {
        return !this.task || this.task.action === 'idle';
    }

    /** Assign this Zerg to an Overlord */
    setOverlord(overlordPid: string): void {
        this.overlord = overlordPid;
        (this.creep.memory as any).overlord = overlordPid;
    }

    // ─── EXECUTION ─────────────────────────────────────────────────

    /**
     * Execute the current task. Called every tick.
     *
     * If the task completes or becomes invalid, the Zerg goes idle.
     * The Overlord will reassign a new task next tick.
     */
    run(): void {
        if (this.creep.spawning) return;

        if (!this.task) return;

        // Validate task target still exists
        if (!this.task.isValid()) {
            this.clearTask();
            return;
        }

        // Execute the task
        const complete = this.task.execute(this.creep);
        if (complete) {
            this.clearTask();
        }
    }

    // ─── MOVEMENT ──────────────────────────────────────────────────

    /**
     * Move toward a target using the TrafficManager.
     * Replaces native creep.moveTo() with cached pathfinding,
     * stuck detection, and priority-based shoving.
     */
    travelTo(target: RoomPosition | { pos: RoomPosition }, opts: TravelToOpts = {}): ScreepsReturnCode {
        return trafficManager.travelTo(this.creep, target, {
            priority: opts.priority ?? (this.overlord ? this.getOverlordPriority() : 5),
            ...opts,
        });
    }

    /**
     * Register this Zerg as stationary (e.g., static miner).
     * The CostMatrix will route other creeps around this position.
     */
    parkStationary(): void {
        trafficManager.registerStationary(this.name, this.pos);
    }

    /** Unregister as stationary */
    unpark(): void {
        trafficManager.unregisterStationary(this.name);
    }

    /** Derive movement priority from overlord PID */
    private getOverlordPriority(): number {
        // Mining overlords are high priority (1), others default
        if (this.overlord?.startsWith('mining')) return 1;
        if (this.overlord?.startsWith('logistics') || this.overlord?.startsWith('hauling')) return 2;
        if (this.overlord?.startsWith('defense')) return 1;
        return 5;
    }

    // ─── UTILITIES ─────────────────────────────────────────────────

    /** Say something (for debugging) */
    say(msg: string): void {
        this.creep.say(msg);
    }

    toString(): string {
        const taskStr = this.task ? this.task.toString() : 'idle';
        return `Zerg<${this.name}|${taskStr}>`;
    }
}

// ─── BODY ANALYSIS ─────────────────────────────────────────────────

interface BodyAnalysis {
    work: number;
    carry: number;
    move: number;
    attack: number;
    rangedAttack: number;
    heal: number;
    tough: number;
    claim: number;
}

// ─── ZERG REGISTRY ─────────────────────────────────────────────────
// Heap-cached Zerg instances. Re-wraps on tick boundary.

const _zergCache: Map<string, Zerg> = new Map();
let _zergCacheTick: number = -1;

/**
 * Get or create a Zerg wrapper for a creep.
 * Cached per-tick to avoid re-wrapping.
 */
export function getZerg(creep: Creep): Zerg {
    if (_zergCacheTick !== Game.time) {
        _zergCache.clear();
        _zergCacheTick = Game.time;
    }

    let zerg = _zergCache.get(creep.name);
    if (!zerg) {
        zerg = new Zerg(creep);
        _zergCache.set(creep.name, zerg);
    }
    return zerg;
}

/**
 * Get all Zergs assigned to a specific Overlord.
 */
export function getZergsForOverlord(overlordPid: string): Zerg[] {
    const zergs: Zerg[] = [];
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if ((creep.memory as any).overlord === overlordPid) {
            zergs.push(getZerg(creep));
        }
    }
    return zergs;
}
