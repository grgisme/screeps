import { Overlord } from "../Overlord";
// import { Colony } from "../../colony/Colony";
import { Upgrader } from "../../zerg/Upgrader";
// import { Zerg } from "../../zerg/Zerg";

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

        // 1. Spawn Gating (Death Spiral Prevention)
        // Only spawn if Storage exists OR ample energy (RCL 1 exception handled by Workers)
        // Actually, pure upgraders start at RCL 2+ usually with containers.
        // If no storage/container, workers do upgrading.
        // So we gate on Storage existence OR Container existence?
        // Or simply energy capacity?
        // "Trigger: Only spawn if room.storage exists OR room.energyAvailable is consistently high (Surplus Mode)."

        let shouldSpawn = false;
        if (room.storage && room.storage.store.energy > 10000) {
            shouldSpawn = true;
        } else if (room.energyAvailable > room.energyCapacityAvailable * 0.9 && this.colony.creeps.length > 2) {
            // Surplus mode (e.g. at RCL 1 with full extensions and nothing to build)
            shouldSpawn = true;
        }

        // If Critical (Downgrade imminent), FORCE spawn
        if (controller.ticksToDowngrade < 4000) {
            shouldSpawn = true;
        }

        if (!shouldSpawn) return;

        // 2. Target Count Logic
        let target = 1;
        if (storage && storage.store.energy > 100000) {
            // Rich: Scale up
            target = 3;
        }
        if (storage && storage.store.energy > 500000) {
            // Very Rich: Scale more
            target = 5;
        }

        // 3. Priority
        let priority = 4; // Low-ish
        if (controller.ticksToDowngrade < 4000) {
            priority = 2; // Critical (Higher than Workers/Haulers)
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
