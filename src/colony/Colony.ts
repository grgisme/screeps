/**
 * Colony - The 'Brain' of a room.
 *
 * A Colony is a centralized manager for a single owned room. It:
 *   1. Monitors room-level state (RCL, energy, threats)
 *   2. Owns a collection of Overlords (Mining, Upgrading, Spawning, etc.)
 *   3. Collects SpawnRequests from all Overlords and feeds them to the Hatchery
 *   4. Is hydrated into the Heap for persistence
 *
 * Colony instances are created per-room and live on the V8 heap.
 * On global reset, they are re-instantiated from room data.
 */
import { Overlord, SpawnRequest } from "../overlords/Overlord";
import { MiningOverlord } from "../overlords/MiningOverlord";
import { InfrastructureOverlord } from "../overlords/InfrastructureOverlord";
import { heap } from "../os/Heap";

/** Colony state for diagnostics */
export interface ColonyState {
    roomName: string;
    rcl: number;
    energyAvailable: number;
    energyCapacity: number;
    overlordCount: number;
    spawnQueueLength: number;
}

export class Colony {
    /** Room name this colony manages */
    roomName: string;

    /** All Overlords owned by this Colony */
    overlords: Map<string, Overlord> = new Map();

    /** Spawn requests collected from Overlords this tick */
    spawnQueue: SpawnRequest[] = [];

    /** Tick when this colony was last run */
    private lastRunTick: number = -1;

    constructor(roomName: string) {
        this.roomName = roomName;
    }

    // ─── ROOM STATE ────────────────────────────────────────────────

    get room(): Room | undefined {
        return Game.rooms[this.roomName];
    }

    get controller(): StructureController | undefined {
        return this.room?.controller;
    }

    get rcl(): number {
        return this.controller?.level || 0;
    }

    get energyAvailable(): number {
        return this.room?.energyAvailable || 0;
    }

    get energyCapacity(): number {
        return this.room?.energyCapacityAvailable || 0;
    }

    get spawns(): StructureSpawn[] {
        if (!this.room) return [];
        return this.room.find(FIND_MY_SPAWNS);
    }

    // ─── OVERLORD MANAGEMENT ───────────────────────────────────────

    /** Register an Overlord with this Colony */
    addOverlord(overlord: Overlord): void {
        this.overlords.set(overlord.pid, overlord);
    }

    /** Remove an Overlord */
    removeOverlord(pid: string): void {
        this.overlords.delete(pid);
    }

    /** Get an Overlord by PID */
    getOverlord(pid: string): Overlord | undefined {
        return this.overlords.get(pid);
    }

    // ─── INITIALIZATION ────────────────────────────────────────────

    /**
     * Initialize default Overlords for this Colony.
     * Called once when the Colony is first created or after global reset.
     */
    init(): void {
        // Mining Overlord — one per room, manages all sources
        if (!this.overlords.has(`mining-${this.roomName}`)) {
            this.addOverlord(new MiningOverlord(this.roomName));
        }

        // Infrastructure Overlord — automated construction site placement
        if (!this.overlords.has(`infra-${this.roomName}`)) {
            this.addOverlord(new InfrastructureOverlord(this.roomName));
        }

        // Future Overlords will be added here:
        // this.addOverlord(new UpgradeOverlord(this.roomName));
        // this.addOverlord(new LogisticsOverlord(this.roomName));
        // this.addOverlord(new DefenseOverlord(this.roomName));
    }

    // ─── MAIN TICK ─────────────────────────────────────────────────

    /**
     * Run this Colony for the current tick.
     *
     * Flow:
     *   1. Run all Overlords (sense → spawn → assign → execute)
     *   2. Collect spawn requests from all Overlords
     *   3. Process spawn queue (priority-sorted)
     */
    run(): void {
        const room = this.room;
        if (!room) return;
        if (this.lastRunTick === Game.time) return; // Prevent double-run
        this.lastRunTick = Game.time;

        // 1. Run all Overlords
        for (const overlord of this.overlords.values()) {
            overlord.run();
        }

        // 2. Collect spawn requests
        this.spawnQueue = [];
        for (const overlord of this.overlords.values()) {
            const requests = overlord.getPendingSpawnRequests();
            this.spawnQueue.push(...requests);
        }

        // 3. Sort by priority (lower = spawns first)
        this.spawnQueue.sort((a, b) => a.priority - b.priority);

        // 4. Process spawn queue
        this.processSpawnQueue();
    }

    /**
     * Process the spawn queue — find available spawns and execute requests.
     */
    private processSpawnQueue(): void {
        if (this.spawnQueue.length === 0) return;

        const availableSpawns = this.spawns.filter(s => !s.spawning);
        if (availableSpawns.length === 0) return;

        let spawnIdx = 0;
        for (const request of this.spawnQueue) {
            if (spawnIdx >= availableSpawns.length) break;

            const spawn = availableSpawns[spawnIdx];
            const bodyCost = request.body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

            if (bodyCost > this.energyAvailable) {
                // Not enough energy — skip (don't advance spawn index)
                continue;
            }

            const name = `${request.label}-${Game.time % 10000}`;
            const result = spawn.spawnCreep(request.body, name, {
                memory: {
                    role: request.memory.role || 'zerg',
                    room: this.roomName,
                    working: false,
                    state: 0,
                    overlord: request.overlord,
                    ...request.memory,
                } as CreepMemory,
            });

            if (result === OK) {
                spawnIdx++;
                if (Game.time % 50 === 0) {
                    console.log(`🥚 COLONY ${this.roomName}: Spawning ${name} for ${request.overlord}`);
                }
            }
        }
    }

    // ─── DIAGNOSTICS ───────────────────────────────────────────────

    getState(): ColonyState {
        return {
            roomName: this.roomName,
            rcl: this.rcl,
            energyAvailable: this.energyAvailable,
            energyCapacity: this.energyCapacity,
            overlordCount: this.overlords.size,
            spawnQueueLength: this.spawnQueue.length,
        };
    }

    toString(): string {
        return `Colony<${this.roomName}|RCL${this.rcl}|${this.overlords.size} overlords>`;
    }
}

// ─── COLONY REGISTRY (Heap-cached) ─────────────────────────────────

const _colonies: Map<string, Colony> = new Map();

/**
 * Get or create a Colony for a room.
 * Colonies are cached on the heap and survive across ticks.
 */
export function getColony(roomName: string): Colony {
    let colony = _colonies.get(roomName);
    if (!colony) {
        colony = new Colony(roomName);
        colony.init();
        _colonies.set(roomName, colony);
    }
    return colony;
}

/**
 * Get all active Colonies.
 */
export function getAllColonies(): Colony[] {
    return Array.from(_colonies.values());
}

/**
 * Initialize Colonies for all owned rooms.
 * Called on global reset and when new rooms are claimed.
 */
export function initColonies(): void {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (room.controller && room.controller.my) {
            getColony(roomName); // Creates if doesn't exist
        }
    }
}
