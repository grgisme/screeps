// ============================================================================
// FillerOverlord — Extension/Spawn filler from Hub (Hatchery Container or Storage)
// ============================================================================
//
// Spawns 1-2 small "filler" creeps that shuttle energy from the Hub
// to empty extensions and spawns. Eliminates "Energy Racing" by
// centralizing distribution through a dedicated role.
//
// Activation: When a hatchery container (RCL 2+) or Storage (RCL 4+) exists
// Body: [CARRY, CARRY, MOVE] — cheap, fast, no WORK needed
// Priority: 85 (below miners 100 and haulers 90, above workers 30)

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
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

        // Fallback: hatchery container near spawn
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

    run(): void {
        const room = this.colony.room;
        if (!room) return;

        for (const filler of this.fillers) {
            if (!filler.isAlive()) continue;
            if (filler.task) continue;

            const mem = filler.memory as any;

            // State machine: collect until full, distribute until empty
            if ((filler.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                mem.collecting = true;
            }
            if ((filler.store?.getFreeCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                mem.collecting = false;
            }

            if (mem.collecting) {
                // Withdraw from hub (Storage or hatchery container)
                const hub = this.getFillerHub(room);
                if (hub) {
                    filler.setTask(new WithdrawTask(hub.id as Id<Structure>));
                }
            } else {
                // Fill empty extensions and spawns (closest first)
                const target = filler.pos?.findClosestByRange(FIND_MY_STRUCTURES, {
                    filter: (s: Structure) =>
                        (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                        (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                }) as StructureSpawn | StructureExtension | undefined;

                if (target) {
                    filler.setTask(new TransferTask(target.id as Id<Structure>));
                } else {
                    // Everything full — rally near hub and wait
                    const hub = this.getFillerHub(room);
                    const rally = hub?.pos ?? room.find(FIND_MY_SPAWNS)?.[0]?.pos;
                    if (rally && filler.pos && filler.pos.getRangeTo(rally) > 3) {
                        filler.travelTo(rally, 3);
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

        if (this.fillers.length >= maxFillers) return;

        // Body: [CARRY, CARRY, MOVE] segments — small, cheap, fast
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
