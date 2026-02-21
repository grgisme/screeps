// ============================================================================
// FillerOverlord — Stationary Fast Filler from Hub
// ============================================================================
//
// Spawns filler creeps that park on designated standing tiles in the bunker
// core. Once positioned, the filler NEVER MOVES — it executes a pure
// withdraw/transfer loop, reaching the hub and all adjacent extensions
// within range 1.
//
// Activation: When a hatchery container (RCL 2+) or Storage (RCL 4+) exists
// Body: [CARRY, CARRY, MOVE] — cheap, fast, MOVE only used to reach tile
// Priority: 85 (below miners 100 and haulers 90, above workers 30)

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { Logger } from "../../utils/Logger";

const log = new Logger("Filler");

export class FillerOverlord extends Overlord {
    fillers: Zerg[] = [];

    constructor(colony: Colony) {
        super(colony, "filler");
    }

    init(): void {
        this.fillers = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "filler");

        this.handleSpawning();
    }

    /**
     * Get the filler's energy hub: Storage (RCL 4+) or hatchery container (RCL 2+).
     * Returns null if neither exists.
     */
    getFillerHub(room: Room): StructureStorage | StructureContainer | null {
        // Prefer Storage when available
        if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            return room.storage;
        }

        // Fallback: hatchery container near spawn (ideally at future Storage position)
        const anchor = this.colony.memory.anchor;
        if (!anchor) return null;

        const hubCoord = BunkerLayout.hubPos;
        const hubPos = new RoomPosition(anchor.x + hubCoord.x, anchor.y + hubCoord.y, room.name); // Hub position = BunkerLayout.hubPos
        const containers = hubPos.lookFor(LOOK_STRUCTURES)
            .filter(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];

        if (containers.length > 0 && containers[0].store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            return containers[0];
        }

        // Broader search: any container near spawn that isn't source/controller
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return null;
        const spawn = spawns[0];
        const controller = room.controller;

        const hatchContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        }).filter(c => {
            const nearSource = c.pos.findInRange(FIND_SOURCES, 2).length > 0;
            const nearCtrl = controller && c.pos.getRangeTo(controller) <= 3;
            return !nearSource && !nearCtrl;
        }) as StructureContainer[];

        if (hatchContainers.length > 0 && hatchContainers[0].store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            return hatchContainers[0];
        }

        return null;
    }

    /**
     * Get the standing tile for this filler (by index).
     * Uses BunkerLayout.fillerTiles relative to the colony anchor.
     */
    private getStandingTile(fillerIndex: number): RoomPosition | null {
        const anchor = this.colony.memory.anchor;
        if (!anchor) return null;

        const tiles = BunkerLayout.fillerTiles;
        if (fillerIndex >= tiles.length) return null;

        const coord = tiles[fillerIndex];
        return new RoomPosition(anchor.x + coord.x, anchor.y + coord.y, this.colony.name);
    }

    run(): void {
        const room = this.colony.room;
        if (!room) return;

        for (let i = 0; i < this.fillers.length; i++) {
            const filler = this.fillers[i];
            if (!filler.isAlive()) continue;
            if (filler.task) continue;

            // ── Step 1: Navigate to standing tile (only until positioned) ──
            const standingTile = this.getStandingTile(i);
            if (standingTile && filler.pos && !filler.pos.isEqualTo(standingTile)) {
                filler.travelTo(standingTile, 0);
                continue;
            }

            // ── Step 2: Stationary withdraw/transfer loop ──
            const energy = filler.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;

            if (energy === 0) {
                // Withdraw from hub (must be within range 1 of standing tile)
                const hub = this.getFillerHub(room);
                if (hub) {
                    filler.setTask(new WithdrawTask(hub.id as Id<Structure>));
                }
            } else {
                // Transfer to adjacent extension/spawn (range 1 only — no walking)
                const target = filler.pos?.findInRange(FIND_MY_STRUCTURES, 1, {
                    filter: (s: Structure) =>
                        (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                        (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                })[0] as StructureSpawn | StructureExtension | undefined;

                if (target) {
                    filler.setTask(new TransferTask(target.id as Id<Structure>));
                } else {
                    // Fallback: mobile filling for sub-optimal layouts
                    // Extensions may not be adjacent yet — walk to them
                    const farTarget = filler.pos?.findClosestByRange(FIND_MY_STRUCTURES, {
                        filter: (s: Structure) =>
                            (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                            (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    }) as StructureSpawn | StructureExtension | undefined;

                    if (farTarget) {
                        filler.setTask(new TransferTask(farTarget.id as Id<Structure>));
                    }
                }
            }
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room) return;

        // Gate: need a hub to draw from (hatchery container OR Storage)
        const hub = this.getFillerHub(room);
        if (!hub) return;

        // Don't spawn if hub is nearly empty — wait for haulers to fill it
        if (hub.store.getUsedCapacity(RESOURCE_ENERGY) < 200) return;

        // Count scaling: 1 filler for RCL 2-5, 2 for RCL 6+
        const rcl = room.controller?.level ?? 0;
        const maxFillers = rcl >= 6 ? 2 : 1;

        // Pre-spawn TTL replacement: if a filler is dying, don't count it
        let activeFillers = 0;
        for (const f of this.fillers) {
            const ttl = f.creep?.ticksToLive ?? Infinity;
            const bodySize = f.creep?.body?.length ?? 3;
            const preSpawnThreshold = (bodySize * 3) + 15; // spawnTime + ~15 ticks to walk to tile
            if (ttl > preSpawnThreshold) {
                activeFillers++;
            } else {
                log.debug(() => `Pre-spawn: Filler TTL=${ttl}, threshold=${preSpawnThreshold}`);
            }
        }

        if (activeFillers >= maxFillers) return;

        // Body: [CARRY, CARRY, MOVE] — MOVE only for initial positioning
        const template: BodyPartConstant[] = [CARRY, CARRY, MOVE];

        this.colony.hatchery.enqueue({
            priority: 85,
            bodyTemplate: template,
            overlord: this,
            name: `Filler_${this.colony.name}_${Game.time}`,
            memory: { role: "filler" }
        });

        log.debug(() => `Filler requested. Hub: ${hub.structureType}, Current: ${this.fillers.length}/${maxFillers}`);
    }
}
