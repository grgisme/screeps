/**
 * Overlord - Abstract base class for managing a specific objective.
 *
 * The Overlord pattern:
 *   1. SENSE:  Scan for requirements (e.g., "Source A needs 5 WORK parts")
 *   2. SPAWN:  Request new Zergs from the Colony if requirements aren't met
 *   3. ASSIGN: Push specific Tasks to assigned Zergs
 *
 * Each Overlord is created by a Colony and registered as a child.
 * The Colony calls overlord.run() every tick.
 *
 * Subclasses must implement:
 *   - sense(): Analyze the current state and determine needs
 *   - assign(): Push Tasks to idle Zergs
 *   - getSpawnRequests(): Return spawn requests if more Zergs are needed
 */
import { Zerg, getZergsForOverlord } from "../wrappers/Zerg";
import { Task } from "../tasks/Task";

/** A request to spawn a new Zerg */
export interface SpawnRequest {
    /** Overlord PID requesting the spawn */
    overlord: string;
    /** Body parts for the new creep */
    body: BodyPartConstant[];
    /** Priority (lower = spawns first) */
    priority: number;
    /** Memory to set on the new creep */
    memory: Record<string, any>;
    /** Human-readable label */
    label: string;
}

export abstract class Overlord {
    /** Unique identifier (also used as Zerg assignment key) */
    pid: string;

    /** Priority (lower = more important for spawning) */
    priority: number;

    /** Room this overlord operates in */
    roomName: string;

    /** Whether this overlord is active */
    active: boolean;

    /** Spawn requests generated this tick */
    protected spawnRequests: SpawnRequest[] = [];

    constructor(pid: string, roomName: string, priority: number = 5) {
        this.pid = pid;
        this.roomName = roomName;
        this.priority = priority;
        this.active = true;
    }

    // ─── ZERG MANAGEMENT ───────────────────────────────────────────

    /** Get all Zergs assigned to this Overlord */
    get zergs(): Zerg[] {
        return getZergsForOverlord(this.pid);
    }

    /** Get idle Zergs (no task or task is 'idle') */
    get idleZergs(): Zerg[] {
        return this.zergs.filter(z => z.isIdle);
    }

    /** Count of assigned Zergs */
    get zergCount(): number {
        return this.zergs.length;
    }

    /** Total WORK parts across all assigned Zergs */
    get totalWorkParts(): number {
        return this.zergs.reduce((sum, z) => sum + z.body.work, 0);
    }

    // ─── ABSTRACT METHODS ──────────────────────────────────────────

    /**
     * SENSE: Analyze the current state.
     * Determine what resources are available, what's needed, etc.
     * Run once per tick before assign().
     */
    abstract sense(): void;

    /**
     * ASSIGN: Push Tasks to idle Zergs.
     * Called after sense(). Only need to assign tasks to idle zergs.
     */
    abstract assign(): void;

    /**
     * Get spawn requests for Zergs this Overlord needs.
     * The Colony collects these and feeds them to the SpawnHatchery.
     */
    abstract getSpawnRequests(): SpawnRequest[];

    // ─── MAIN LOOP ─────────────────────────────────────────────────

    /**
     * Run this Overlord for the current tick.
     *
     * Flow: sense → spawn → assign → execute
     */
    run(): void {
        if (!this.active) return;

        // 1. Sense: analyze environment
        this.sense();

        // 2. Generate spawn requests (Colony will process them)
        this.spawnRequests = this.getSpawnRequests();

        // 3. Assign tasks to idle Zergs
        this.assign();

        // 4. Execute: run all assigned Zergs
        for (const zerg of this.zergs) {
            zerg.run();
        }
    }

    // ─── UTILITIES ─────────────────────────────────────────────────

    /** Get the Room object (may be undefined if no vision) */
    get room(): Room | undefined {
        return Game.rooms[this.roomName];
    }

    /** Get pending spawn requests */
    getPendingSpawnRequests(): SpawnRequest[] {
        return this.spawnRequests;
    }

    toString(): string {
        return `Overlord<${this.pid}|${this.zergCount} zergs>`;
    }
}
