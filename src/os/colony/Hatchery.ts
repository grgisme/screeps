import { Colony } from "../Colony";
import { Overlord } from "../processes/Overlord";
import { CreepBody } from "../../utils/CreepBody";

export interface SpawnRequest {
    priority: number;
    bodyTemplate: BodyPartConstant[];
    overlord: Overlord;
    name?: string; // Optional specific name desire
}

export class Hatchery {
    colony: Colony;
    spawns: StructureSpawn[];
    extensions: StructureExtension[];
    queue: SpawnRequest[];
    pendingSpawns: string[]; // Names of creeps that are spawning/spawned but not yet in Game.creeps (maybe)

    constructor(colony: Colony) {
        this.colony = colony;
        this.spawns = [];
        this.extensions = [];
        this.queue = [];
        this.pendingSpawns = [];
        this.refresh();
    }

    refresh(): void {
        this.spawns = this.colony.room.find(FIND_MY_SPAWNS);
        this.extensions = this.colony.room.find(FIND_MY_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_EXTENSION
        }) as StructureExtension[];
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
        // 1. Emergency Mode Check
        if (this.colony.room.find(FIND_MY_CREEPS).length === 0 && this.spawns.length > 0) {
            console.log(`${this.colony.name}: EMERGENCY MODE ACTIVATED. Spawning Bootstrapper.`);
            // Override queue
            const spawn = this.spawns[0];
            const result = spawn.spawnCreep([WORK, CARRY, MOVE], "Bootstrapper", {
                memory: { role: 'worker', room: this.colony.name } as any // Minimal memory
            });
            if (result === OK) return; // Priorities handled
        }

        // 2. Process Queue
        if (this.queue.length > 0 && this.spawns.length > 0) {
            const availableSpawns = this.spawns.filter(s => !s.spawning);

            for (const spawn of availableSpawns) {
                if (this.queue.length === 0) break;

                const request = this.queue[0]; // Peek at highest priority

                // Calculate dynamic body
                // We assume request.bodyTemplate is a pattern if we use grow, OR a fixed body.
                // The prompt says: "Input: template (e.g., [WORK, WORK, MOVE]) and energyLimit."
                // So we always force 'grow' logic? 
                // "Dynamic Body Generator... Implement the Template Repetition Algorithm"
                // Let's assume the Overlord passes a small pattern (e.g. [WORK, CARRY, MOVE]) and we scale it.
                // Or maybe the Overlord did the scaling? 
                // "Implement the Hatchery... Dynamic Body Generator... Input: template... and energyLimit."
                // This implies the Hatchery (or Overlord calling utility) does it.
                // Let's use current energyCapacityAvailable for the limit.

                const energyCapacity = this.colony.room.energyCapacityAvailable;
                const body = CreepBody.grow(request.bodyTemplate, energyCapacity);

                const energyAvailable = this.colony.room.energyAvailable;
                const bodyCost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

                // If we can't afford it yet, but it fits in capacity, we wait (block lower priorities).
                // Or do we skip? "Priority Queue". Usually we block for high priority.
                if (bodyCost > energyAvailable) {
                    // Cannot spawn yet.
                    // If we can NEVER afford it (cost > capacity), we must fix or discard.
                    if (bodyCost > energyCapacity) {
                        console.log(`Hatchery: Dropping impossible spawn request ${request.name} (Cost ${bodyCost} > Cap ${energyCapacity})`);
                        this.queue.shift();
                        continue;
                    }
                    // Else wait for energy.
                    // We consume the spawn's turn by doing nothing (waiting).
                    break;
                }

                // Try to spawn
                const result = spawn.spawnCreep(body, request.name!, {
                    memory: {
                        _overlord: request.overlord.processId, // Link back to overlord
                        colony: this.colony.name
                    } as any
                });

                if (result === OK) {
                    console.log(`Hatchery: Spawning '${request.name}' (Cost: ${bodyCost}) for Overlord '${request.overlord.processId}'.`);
                    this.queue.shift(); // Remove from queue
                } else if (result === ERR_NAME_EXISTS) {
                    // Name collision? Just drop it or rename?
                    console.log(`Hatchery: Name exists '${request.name}', dropping request.`);
                    this.queue.shift();
                } else {
                    console.log(`Hatchery: Check spawn error ${result} for ${request.name}`);
                }
            }
        }

        // 3. Logistics Integration (Refill)
        this.registerRefillRequests();

        // 4. Cleanup pending spawns
        // If creep exists in Game.creeps, remove from pending
        this.pendingSpawns = this.pendingSpawns.filter(name => !Game.creeps[name]);
    }

    private registerRefillRequests(): void {
        // Calculate total deficit
        const capacity = this.colony.room.energyCapacityAvailable;
        const available = this.colony.room.energyAvailable;
        const deficit = capacity - available;

        if (deficit > 0) {
            // "If deficit > 0, register a single LogisticsRequest (Priority: Critical) for the Hatchery."
            // We need a target for the request. The prompt implies "The Hatchery" is the target?
            // But LogisticsNetwork requests target specific structures.
            // "Refill Logic: When a Transporter arrives, it should transfer to the Spawn/Extension with the lowest current energy."

            // If we register a request pointing to... a spawn? Or the Hatchery object itself?
            // LogisticsNetwork types usually expect Structure | Resource.
            // If we pass 'this', we need to implement the Structure interface or handle it in Logistics.
            // EASIER: Pick one spawn/extension as the 'representative' target, OR
            // modify LogisticsNetwork to handle a virtual target?
            // PROMPT SAYS: "register a single LogisticsRequest ... for the Hatchery."

            // Let's pick the first spawn as the anchor/target for the logistics request.
            // But checking 'lowest current energy' implies the transporter decides where to put it upon arrival.
            // This suggests the LogisticsNetwork needs to support a "Cluster" target or we just point to the Spawn and assume the transporter is smart.

            // To keep it simple and compliant:
            // We will request input for the first Spawn (or first extension needing energy).
            // But we treat it as a request for the whole pool.

            // Find a structure that needs energy
            const target = this.spawns.find(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                this.extensions.find(e => e.store.getFreeCapacity(RESOURCE_ENERGY) > 0);

            if (target) {
                // Determine absolute priority. Supply Critical = 1? Or higher?
                // "Tiers: 1=Critical (Miners/Queens)..."
                // Logistics priorities: usually 1-10.
                // Let's say 10 is critical.
                this.colony.logistics.requestInput(target, {
                    amount: deficit,
                    priority: 10, // Critical
                    resourceType: RESOURCE_ENERGY
                });
            }
        }
    }
}
