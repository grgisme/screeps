// ============================================================================
// FillerOverlord — Extension/Spawn filler from Storage (RCL 4+)
// ============================================================================
//
// Spawns 1-2 small "filler" creeps that shuttle energy from Storage
// to empty extensions and spawns. Eliminates "Energy Racing" by
// centralizing distribution through a dedicated role.
//
// Activation: Only when room.storage exists (RCL 4+)
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
                // Withdraw from Storage
                const storage = room.storage;
                if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    filler.setTask(new WithdrawTask(storage.id as Id<Structure>));
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
                    // Everything full — rally near storage and wait
                    const rally = room.storage?.pos;
                    if (rally && filler.pos && filler.pos.getRangeTo(rally) > 3) {
                        filler.travelTo(rally, 3);
                    }
                }
            }
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room || !room.storage) return; // Gate: Storage required (RCL 4+)

        // Don't spawn if storage is almost empty
        if (room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 1000) return;

        // Count scaling: 1 filler for RCL 4-5, 2 for RCL 6+
        const rcl = room.controller?.level ?? 0;
        const maxFillers = rcl >= 6 ? 2 : 1;

        if (this.fillers.length >= maxFillers) return;

        // Body: [CARRY, CARRY, MOVE] segments — small, cheap, fast
        // Grown by Hatchery based on capacity (CreepBody.grow handles this)
        const template: BodyPartConstant[] = [CARRY, CARRY, MOVE];

        this.colony.hatchery.enqueue({
            priority: 85,
            bodyTemplate: template,
            overlord: this,
            name: `Filler_${this.colony.name}_${Game.time}`,
            memory: { role: "filler" }
        });

        log.debug(() => `Filler requested. Current: ${this.fillers.length}/${maxFillers}`);
    }
}
