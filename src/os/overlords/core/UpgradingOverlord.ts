import { Overlord } from "../Overlord";
// import { Colony } from "../../colony/Colony";
import { Upgrader } from "../../zerg/Upgrader";
import { Logger } from "../../../utils/Logger";
// import { Zerg } from "../../zerg/Zerg";

const log = new Logger("Upgrading");

export class UpgradingOverlord extends Overlord {
    upgraders: Upgrader[];

    constructor(colony: any) {
        super(colony, "upgrading");
        this.upgraders = this.zergs.map(z => new Upgrader(z.creep));
    }

    init(): void {
        this.handleSpawning();
    }

    run(): void {
        for (const upgrader of this.upgraders) {
            upgrader.run();
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        const storage = room.storage;
        const controller = room.controller;

        if (!controller) return;

        // ── Genesis Gate ───────────────────────────────────────────
        // Specialized upgraders are a LIABILITY at RCL 1 without
        // logistics infrastructure. Only spawn if:
        //   • Downgrade imminent (always override)
        //   • RCL 8 (always need upgraders to prevent downgrade)
        //   • Storage exists with energy
        //   • Containers exist (logistics can feed them)
        // Otherwise, workers handle upgrading as a fallback task.
        const downgradeImminent = controller.ticksToDowngrade < 4000;
        const hasStorage = storage && storage.store.energy > 0;
        const hasContainers = room.find(FIND_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        }).length > 0;
        const isRCL8 = controller.level === 8;

        if (!downgradeImminent && !hasStorage && !hasContainers && !isRCL8) {
            // Gate is closed — cleanup any existing upgraders
            if (this.upgraders.length > 0) {
                for (const u of this.upgraders) {
                    log.info(`Suiciding gated upgrader ${u.name} (no infrastructure)`);
                    u.creep.suicide();
                }
                this.upgraders = [];
            }
            return;
        }

        // ── Spawn Gating (Death Spiral Prevention) ─────────────────
        let shouldSpawn = false;
        if (hasStorage && storage!.store.energy > 10000) {
            shouldSpawn = true;
        } else if (hasContainers && room.energyAvailable > room.energyCapacityAvailable * 0.9 && this.colony.creeps.length > 2) {
            // Surplus mode — but ONLY with logistics infrastructure
            shouldSpawn = true;
        }

        // If Critical (Downgrade imminent), FORCE spawn
        if (controller.ticksToDowngrade < 4000) {
            shouldSpawn = true;
        }

        if (!shouldSpawn) return;

        // ── Target Count Logic ─────────────────────────────────────
        let target = 1;
        if (storage && storage.store.energy > 100000) {
            target = 3;
        }
        if (storage && storage.store.energy > 500000) {
            target = 5;
        }

        // ── Priority ───────────────────────────────────────────────
        let priority = 4;
        if (controller.ticksToDowngrade < 4000) {
            priority = 2; // Critical
        }

        if (this.upgraders.length < target) {
            this.colony.hatchery.enqueue({
                priority: priority,
                bodyTemplate: [WORK, WORK, CARRY, MOVE],
                overlord: this,
                memory: { role: "upgrader" }
            });
        }
    }
}
