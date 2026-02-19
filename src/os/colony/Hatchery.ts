// ============================================================================
// Hatchery — Spawn management and priority queue
// ============================================================================
//
// ⚠️ GETTER PATTERN (V8 MEMORY LEAK PREVENTION)
// ══════════════════════════════════════════════
// Hatchery persists in the Global Heap (owned by Colony).
// NEVER cache live StructureSpawn or StructureExtension arrays.
// Store IDs only, resolve via getters.
// ============================================================================

import type { Colony } from "./Colony";
import { Overlord } from "../overlords/Overlord";
import { CreepBody } from "../../utils/CreepBody";
import { Logger } from "../../utils/Logger";

const log = new Logger("Hatchery");

export interface SpawnRequest {
    priority: number;
    bodyTemplate: BodyPartConstant[];
    overlord: Overlord;
    name?: string; // Optional specific name desire
    memory?: any;
}

export class Hatchery {
    colony: Colony;

    // ── Stored IDs only — never live Game objects ──────────────────────
    spawnIds: Id<StructureSpawn>[] = [];
    extensionIds: Id<StructureExtension>[] = [];

    queue: SpawnRequest[];
    pendingSpawns: string[]; // Names of creeps that are spawning/spawned but not yet in Game.creeps

    constructor(colony: Colony) {
        this.colony = colony;
        this.queue = [];
        this.pendingSpawns = [];
        this.refresh();
    }

    // -----------------------------------------------------------------------
    // Getters — resolve live Game objects each tick (no heap leak)
    // -----------------------------------------------------------------------

    get spawns(): StructureSpawn[] {
        return this.spawnIds
            .map(id => Game.getObjectById(id))
            .filter((s): s is StructureSpawn => s !== null);
    }

    get extensions(): StructureExtension[] {
        return this.extensionIds
            .map(id => Game.getObjectById(id))
            .filter((e): e is StructureExtension => e !== null);
    }

    refresh(): void {
        const room = this.colony.room;
        if (!room) return;
        this.spawnIds = room.find(FIND_MY_SPAWNS).map(s => s.id);
        this.extensionIds = (room.find(FIND_MY_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_EXTENSION
        }) as StructureExtension[]).map(e => e.id);
        // Clear queue each tick — overlords re-enqueue during init()
        this.queue = [];
    }

    /**
     * Enqueues a spawn request.
     * Returns the name of the creep that will be spawned.
     */
    enqueue(request: SpawnRequest): string {
        // Generate a unique name if not provided
        const name = request.name || `${request.overlord.processId}_${Game.time}_${Math.floor(Math.random() * 100)}`;

        // Add to queue
        this.queue.push({ ...request, name });
        // Sort queue by priority (descending) - Higher number = Higher priority
        this.queue.sort((a, b) => b.priority - a.priority);

        // Track pending name so it isn't Garbage Collected from memory if we used that
        if (!this.pendingSpawns.includes(name)) {
            this.pendingSpawns.push(name);
        }

        return name;
    }

    run(): void {
        // 1. Emergency Mode Check — use colony.creeps (getter, no room.find bomb)
        const room = this.colony.room;
        if (!room) return;

        const spawns = this.spawns;
        const criticalCreeps = this.colony.creeps.filter(
            c => c.memory.role === 'miner' || c.memory.role === 'worker'
        );

        if (criticalCreeps.length === 0 && spawns.length > 0) {
            const spawn = spawns[0];
            const bootstrapperName = `bootstrapper_${this.colony.name}_${Game.time}`;
            if (!spawn.spawning) {
                log.warn(`${this.colony.name}: EMERGENCY MODE ACTIVATED. Spawning ${bootstrapperName}.`);
                const result = spawn.spawnCreep([WORK, CARRY, MOVE], bootstrapperName, {
                    memory: { role: 'worker', room: this.colony.name } as any
                });
                if (result === OK) return;
            }
        }

        // 2. Process Queue
        if (this.queue.length > 0 && spawns.length > 0) {
            const availableSpawns = spawns.filter(s => !s.spawning);

            for (const spawn of availableSpawns) {
                if (this.queue.length === 0) break;

                const request = this.queue[0]; // Peek at highest priority

                const energyCapacity = this.colony.room?.energyCapacityAvailable ?? 300;
                const body = CreepBody.grow(request.bodyTemplate, energyCapacity);

                const energyAvailable = this.colony.room?.energyAvailable ?? 0;
                const bodyCost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

                // If we can't afford it yet, but it fits in capacity, we wait (block lower priorities).
                if (bodyCost > energyAvailable) {
                    if (bodyCost > energyCapacity) {
                        log.warn(() => `Dropping impossible spawn request ${request.name} (Cost ${bodyCost} > Cap ${energyCapacity})`);
                        this.queue.shift();
                        continue;
                    }
                    // Else wait for energy.
                    break;
                }

                // Try to spawn
                const result = spawn.spawnCreep(body, request.name!, {
                    memory: {
                        _overlord: request.overlord.processId, // Link back to overlord
                        colony: this.colony.name,
                        ...(request.memory || {})
                    } as any
                });

                if (result === OK) {
                    log.info(() => `Spawning '${request.name}' (Cost: ${bodyCost}) for Overlord '${request.overlord.processId}'.`);
                    this.queue.shift(); // Remove from queue
                } else if (result === ERR_NAME_EXISTS) {
                    log.warn(`Name exists '${request.name}', dropping request.`);
                    this.queue.shift();
                } else if (result === ERR_BUSY) {
                    break;
                } else {
                    log.error(`Spawn error ${result} for ${request.name}`);
                }
            }
        }

        // 3. Logistics Integration (Refill)
        this.registerRefillRequests();

        // 4. Cleanup pending spawns
        this.pendingSpawns = this.pendingSpawns.filter(name => !Game.creeps[name]);
    }

    private registerRefillRequests(): void {
        const capacity = this.colony.room?.energyCapacityAvailable ?? 300;
        const available = this.colony.room?.energyAvailable ?? 0;
        const deficit = capacity - available;

        if (deficit > 0) {
            // Find a structure that needs energy — use getters for live objects
            const target = this.spawns.find(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                this.extensions.find(e => e.store.getFreeCapacity(RESOURCE_ENERGY) > 0);

            if (target) {
                this.colony.logistics.requestInput(target.id as Id<Structure | Resource>, {
                    amount: deficit,
                    priority: 10, // Critical
                    resourceType: RESOURCE_ENERGY
                });
            }
        }
    }
}
