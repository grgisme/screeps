// ============================================================================
// UpgradeProcess — Overlord-pattern controller upgrading
// ============================================================================

import { Process } from "../kernel/Process";
import { Zerg } from "../zerg/Zerg";

/**
 * Manages upgrader creeps for a single room's controller.
 *
 * Follows the same Overlord pattern as MiningProcess:
 *  1. Track assigned upgrader creeps.
 *  2. Spawn replacements when below target count.
 *  3. Direct each upgrader to withdraw energy, then upgrade the controller.
 */
export class UpgradeProcess extends Process {
    public readonly processName = "upgrade";

    /** Room whose controller we are upgrading. */
    private roomName: string;
    /** Desired number of upgraders. */
    private targetUpgraders: number;

    /** Heap-cached assigned creep names. */
    private assignedCreeps: string[] = [];

    constructor(
        pid: number,
        priority: number,
        parentPID: number | null,
        roomName: string,
        targetUpgraders: number = 1
    ) {
        super(pid, priority, parentPID);
        this.roomName = roomName;
        this.targetUpgraders = targetUpgraders;
        this.processId = `upgrade:${roomName}`;
    }

    // -----------------------------------------------------------------------
    // Core Logic
    // -----------------------------------------------------------------------

    run(): void {
        this.refreshCreeps();
        this.requestSpawns();

        for (const name of this.assignedCreeps) {
            const creep = Game.creeps[name];
            if (!creep) {
                continue;
            }
            this.runUpgrader(new Zerg(creep));
        }
    }

    private runUpgrader(zerg: Zerg): void {
        const room = Game.rooms[this.roomName];
        if (!room || !room.controller) {
            return;
        }

        // Needs energy? Go withdraw/pickup
        if (zerg.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            this.withdrawEnergy(zerg, room);
            return;
        }

        // Upgrade controller
        const result = zerg.creep.upgradeController(room.controller);
        if (result === ERR_NOT_IN_RANGE) {
            zerg.travelTo(room.controller.pos);
        }
    }

    private withdrawEnergy(zerg: Zerg, room: Room): void {
        // Prefer containers/storage, fall back to harvesting a source
        const target = this.findEnergySource(room);
        if (target) {
            const result = zerg.creep.withdraw(
                target as StructureContainer | StructureStorage,
                RESOURCE_ENERGY
            );
            if (result === ERR_NOT_IN_RANGE) {
                zerg.travelTo(target.pos);
            }
            return;
        }

        // Fallback: harvest directly from a source
        const sources = room.find(FIND_SOURCES_ACTIVE);
        if (sources.length > 0) {
            const source = sources[0];
            const result = zerg.creep.harvest(source);
            if (result === ERR_NOT_IN_RANGE) {
                zerg.travelTo(source.pos);
            }
        }
    }

    private findEnergySource(
        room: Room
    ): StructureStorage | StructureContainer | null {
        // Prefer storage
        if (
            room.storage &&
            room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        ) {
            return room.storage;
        }

        // Containers with energy
        const structures = room.find(FIND_STRUCTURES) as AnyStructure[];
        for (const s of structures) {
            if (
                s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0
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

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (
                creep.memory.pid === this.pid &&
                creep.memory.role === "upgrader" &&
                alive.indexOf(name) === -1
            ) {
                alive.push(name);
            }
        }

        this.assignedCreeps = alive;
    }

    private requestSpawns(): void {
        const deficit = this.targetUpgraders - this.assignedCreeps.length;
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

            const body = this.designBody(room.energyAvailable);
            if (body.length === 0) {
                continue;
            }

            const name = `upgrader_${Game.time}_${this.pid}`;
            const result = spawn.spawnCreep(body, name, {
                memory: {
                    role: "upgrader",
                    pid: this.pid,
                    homeRoom: this.roomName,
                },
            });

            if (result === OK) {
                this.assignedCreeps.push(name);
                console.log(`[UpgradeProcess] Spawned ${name}`);
                break;
            }
        }
    }

    /**
     * Design an upgrader body: WORK, CARRY, MOVE pattern.
     * Balanced for walking + upgrading.
     */
    private designBody(energy: number): BodyPartConstant[] {
        const segment: BodyPartConstant[] = [WORK, CARRY, MOVE];
        const segmentCost =
            BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE]; // 200

        if (energy < segmentCost) {
            return [];
        }

        const body: BodyPartConstant[] = [];
        let remaining = energy;
        let segments = 0;
        const maxSegments = 8; // Cap at 24 parts

        while (remaining >= segmentCost && segments < maxSegments) {
            for (const part of segment) {
                body.push(part);
            }
            remaining -= segmentCost;
            segments++;
        }

        return body;
    }

    // -----------------------------------------------------------------------
    // Serialization
    // -----------------------------------------------------------------------

    serialize(): Record<string, unknown> {
        return {
            roomName: this.roomName,
            targetUpgraders: this.targetUpgraders,
        };
    }

    deserialize(data: Record<string, unknown>): void {
        this.roomName = data.roomName as string;
        this.targetUpgraders = (data.targetUpgraders as number) ?? 1;
    }
}
