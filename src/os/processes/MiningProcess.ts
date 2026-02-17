// ============================================================================
// MiningProcess — Overlord-pattern source harvesting
// ============================================================================

import { Process } from "../../kernel/Process";
import { Zerg } from "../zerg/Zerg";

/**
 * Manages all mining operations for a single energy source.
 *
 * This is an "Overlord" process: it owns and directs creeps rather than
 * each creep deciding for itself what to do. The process:
 *
 *  1. Checks how many miners are assigned and alive.
 *  2. Requests new miners from the spawn if below the target count.
 *  3. Directs each miner to move to the source and harvest,
 *     then transfer energy to the nearest container or spawn/extension.
 */
export class MiningProcess extends Process {
    public readonly processName = "mining";

    /** The source this process is responsible for. */
    private sourceId: Id<Source>;
    /** Room the source is located in. */
    private roomName: string;
    /** Desired number of miners. */
    private targetMiners: number;

    /** Heap-cached list of assigned creep names (not serialized). */
    private assignedCreeps: string[] = [];

    constructor(
        pid: number,
        priority: number,
        parentPID: number | null,
        sourceId: Id<Source>,
        roomName: string,
        targetMiners: number = 1
    ) {
        super(pid, priority, parentPID);
        this.sourceId = sourceId;
        this.roomName = roomName;
        this.targetMiners = targetMiners;
        this.processId = `mining:${roomName}:${sourceId}`;
    }

    // -----------------------------------------------------------------------
    // Core Logic
    // -----------------------------------------------------------------------

    run(): void {
        // Refresh assigned creep list — remove dead ones
        this.refreshCreeps();

        // Request spawns if needed
        this.requestSpawns();

        // Direct each miner
        for (const name of this.assignedCreeps) {
            const creep = Game.creeps[name];
            if (!creep) {
                continue;
            }
            this.runMiner(new Zerg(creep));
        }
    }

    private runMiner(zerg: Zerg): void {
        // If carrying energy and full (or no work parts), deliver
        if (zerg.creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
            this.deliverEnergy(zerg);
            return;
        }

        // Otherwise, harvest
        const source = Game.getObjectById(this.sourceId);
        if (!source) {
            return;
        }

        const result = zerg.creep.harvest(source);
        if (result === ERR_NOT_IN_RANGE) {
            zerg.travelTo(source.pos);
        }
    }

    private deliverEnergy(zerg: Zerg): void {
        const room = Game.rooms[this.roomName];
        if (!room) {
            return;
        }

        // Priority: spawn > extensions > containers > controller
        const target = this.findEnergyTarget(room);
        if (!target) {
            return;
        }

        const result = zerg.creep.transfer(target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
            zerg.travelTo(target.pos);
        }
    }

    private findEnergyTarget(
        room: Room
    ): StructureSpawn | StructureExtension | StructureContainer | null {
        // Find spawns/extensions that need energy
        const structures = room.find(FIND_MY_STRUCTURES) as AnyOwnedStructure[];
        for (const s of structures) {
            if (
                (s.structureType === STRUCTURE_SPAWN ||
                    s.structureType === STRUCTURE_EXTENSION) &&
                (s as StructureSpawn | StructureExtension).store.getFreeCapacity(
                    RESOURCE_ENERGY
                ) > 0
            ) {
                return s as StructureSpawn | StructureExtension;
            }
        }

        // Fallback: containers
        const containers = room.find(FIND_STRUCTURES) as AnyStructure[];
        for (const s of containers) {
            if (
                s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0
            ) {
                return s as StructureContainer;
            }
        }

        return null;
    }

    // -----------------------------------------------------------------------
    // Creep Management
    // -----------------------------------------------------------------------

    private refreshCreeps(): void {
        const alive: string[] = [];
        for (const name of this.assignedCreeps) {
            if (Game.creeps[name]) {
                alive.push(name);
            }
        }

        // Also scan for any creeps assigned to our PID that we lost track of
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (
                creep.memory.pid === this.pid &&
                creep.memory.role === "miner" &&
                alive.indexOf(name) === -1
            ) {
                alive.push(name);
            }
        }

        this.assignedCreeps = alive;
    }

    private requestSpawns(): void {
        const deficit = this.targetMiners - this.assignedCreeps.length;
        if (deficit <= 0) {
            return;
        }

        const room = Game.rooms[this.roomName];
        if (!room) {
            return;
        }

        const spawns = room.find(FIND_MY_SPAWNS);
        for (const spawn of spawns) {
            if (spawn.spawning) {
                continue;
            }

            // Calculate body based on available energy
            const body = this.designBody(room.energyAvailable);
            if (body.length === 0) {
                continue;
            }

            const name = `miner_${Game.time}_${this.pid}`;
            const result = spawn.spawnCreep(body, name, {
                memory: {
                    role: "miner",
                    pid: this.pid,
                    targetId: this.sourceId,
                    homeRoom: this.roomName,
                },
            });

            if (result === OK) {
                this.assignedCreeps.push(name);
                console.log(
                    `[MiningProcess] Spawned ${name} for source ${this.sourceId}`
                );
                break; // One spawn request per tick
            }
        }
    }

    /**
     * Design a miner body that fits the available energy.
     * Pattern: [WORK, WORK, CARRY, MOVE] as the base, scale WORKs up.
     */
    private designBody(energy: number): BodyPartConstant[] {
        const body: BodyPartConstant[] = [];
        const baseCost = BODYPART_COST[CARRY] + BODYPART_COST[MOVE]; // 100
        let remaining = energy - baseCost;

        if (remaining < BODYPART_COST[WORK]) {
            // Can't even afford one WORK + CARRY + MOVE
            if (energy >= BODYPART_COST[WORK] + baseCost) {
                return [WORK, CARRY, MOVE];
            }
            return [];
        }

        // Add WORK parts (max 5 for a single source)
        let workParts = 0;
        while (remaining >= BODYPART_COST[WORK] && workParts < 5) {
            body.push(WORK);
            remaining -= BODYPART_COST[WORK];
            workParts++;
        }

        body.push(CARRY, MOVE);
        return body;
    }

    // -----------------------------------------------------------------------
    // Serialization
    // -----------------------------------------------------------------------

    serialize(): Record<string, unknown> {
        return {
            sourceId: this.sourceId,
            roomName: this.roomName,
            targetMiners: this.targetMiners,
        };
    }

    deserialize(data: Record<string, unknown>): void {
        this.sourceId = data.sourceId as Id<Source>;
        this.roomName = data.roomName as string;
        this.targetMiners = (data.targetMiners as number) ?? 1;
    }
}
