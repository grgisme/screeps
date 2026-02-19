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
import { GlobalCache } from "../../kernel/GlobalCache";

const log = new Logger("Hatchery");

export interface SpawnRequest {
    priority: number;
    bodyTemplate: BodyPartConstant[];
    overlord: Overlord;
    name?: string;
    memory?: any;
    maxEnergy?: number; // Allows Overlords to cap morphological growth
}

export class Hatchery {
    colony: Colony;

    // ── Stored IDs only — never live Game objects ──────────────────────
    spawnIds: Id<StructureSpawn>[] = [];
    extensionIds: Id<StructureExtension>[] = [];
    queue: SpawnRequest[];

    constructor(colony: Colony) {
        this.colony = colony;
        this.queue = [];
        this.refresh();
    }

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

    /** Dynamically connects to the GlobalCache used by main.ts */
    private get pendingSpawns(): Set<string> {
        return GlobalCache.rehydrate("pendingSpawns", () => new Set<string>());
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

    enqueue(request: SpawnRequest): string {
        const name = request.name || `${request.overlord.processId}_${Game.time}_${Math.floor(Math.random() * 100)}`;
        this.queue.push({ ...request, name });
        this.queue.sort((a, b) => b.priority - a.priority);
        return name;
    }

    run(): void {
        const room = this.colony.room;
        if (!room) return;

        const spawns = this.spawns;

        // 1. Emergency Mode Check (Deadlock Prevention)
        const criticalCreeps = this.colony.creeps.filter(
            c => c.memory.role === 'miner' || c.memory.role === 'worker'
        );

        if (criticalCreeps.length === 0 && spawns.length > 0) {
            const spawn = spawns[0];
            const bootstrapperName = `bootstrapper_${this.colony.name}_${Game.time}`;

            if (!spawn.spawning) {
                // Wait until we have 200 energy for [WORK, CARRY, MOVE]
                if (room.energyAvailable >= 200) {
                    log.warning(`${this.colony.name}: EMERGENCY MODE ACTIVATED. Spawning ${bootstrapperName}.`);

                    const result = spawn.spawnCreep([WORK, CARRY, MOVE], bootstrapperName, {
                        memory: {
                            role: 'worker',
                            colony: this.colony.name,
                            _overlord: "worker"
                        } as any
                    });

                    if (result === OK) {
                        this.pendingSpawns.add(bootstrapperName); // Phase I: Commitment Handshake
                        return; // Halt queue processing for this tick
                    }
                }
                return; // Always halt normal queue if in an emergency to stockpile 200 energy
            }
        }

        // 2. Process Queue
        if (this.queue.length > 0 && spawns.length > 0) {
            const availableSpawns = spawns.filter(s => !s.spawning);

            // Track Virtual Energy so multiple spawns don't try to spend the same energy
            let virtualEnergyAvailable = room.energyAvailable;

            for (const spawn of availableSpawns) {
                if (this.queue.length === 0) break;

                const request = this.queue[0];
                const energyCapacity = room.energyCapacityAvailable ?? 300;

                // Apply Overlord's maximum energy budget if provided
                const energyToUse = request.maxEnergy ? Math.min(energyCapacity, request.maxEnergy) : energyCapacity;

                const body = CreepBody.grow(request.bodyTemplate, energyToUse);
                const bodyCost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

                // Empty body deadlock — template too expensive for room capacity
                if (body.length === 0) {
                    log.warning(`Template too expensive for capacity (${energyCapacity}). Dropping request ${request.name}.`);
                    this.queue.shift();
                    continue;
                }

                if (bodyCost > virtualEnergyAvailable) {
                    if (bodyCost > energyCapacity) {
                        log.warning(`Dropping impossible spawn request ${request.name} (Cost ${bodyCost} > Cap ${energyCapacity})`);
                        this.queue.shift();
                        continue;
                    }
                    // Cannot afford right now. Wait for energy.
                    break;
                }

                // Try to spawn
                const result = spawn.spawnCreep(body, request.name!, {
                    memory: {
                        _overlord: request.overlord.processId,
                        colony: this.colony.name,
                        ...(request.memory || {})
                    } as any
                });

                if (result === OK) {
                    log.info(`Spawning '${request.name}' (Cost: ${bodyCost}) for Overlord '${request.overlord.processId}'.`);

                    virtualEnergyAvailable -= bodyCost; // Prevent double spend
                    this.pendingSpawns.add(request.name!); // Phase I: Commitment

                    this.queue.shift();
                } else if (result === ERR_NAME_EXISTS) {
                    log.warning(`Name exists '${request.name}', dropping request.`);
                    this.queue.shift();
                } else if (result === ERR_BUSY) {
                    break;
                } else {
                    log.error(`Spawn error ${result} for ${request.name}`);
                }
            }
        }

        // 3. Phase III Handshake (Cleanup pending spawns once they are alive)
        const pending = this.pendingSpawns;
        for (const name of pending) {
            const creep = Game.creeps[name];
            if (creep && !creep.spawning) {
                pending.delete(name);
            }
        }
    }
}
