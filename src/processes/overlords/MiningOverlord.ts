// ============================================================================
// MiningOverlord — Manages miners for a specific source
// ============================================================================

import { Overlord } from "../../os/processes/Overlord";
import { Colony } from "../../os/Colony";
import { HarvestTask } from "../../os/tasks/HarvestTask";
// ...

export class MiningOverlord extends Overlord {
    source: Source;

    constructor(colony: Colony, source: Source) {
        super(colony, `mining:${colony.name}:${source.id}`);
        this.source = source;
    }

    init(): void {
        // Simple 1 miner per source logic
        const miners = this.zergs.filter(z => z.memory.role === "miner");

        if (miners.length < 1) {
            // Need a miner
            // We need a SpawningOverlord eventually, but for now we can request spawn directly?
            // Or log intent as requested.
            console.log(`[${this.colony.name}] MiningOverlord requesting Miner for ${this.source.id}`);

            // Temporary: Direct spawn request until SpawningOverlord exists
            const spawn = this.colony.room.find(FIND_MY_SPAWNS)[0];
            if (spawn && !spawn.spawning) {
                const name = `miner_${this.colony.name}_${Game.time}`;
                spawn.spawnCreep([WORK, WORK, MOVE], name, {
                    memory: {
                        role: "miner",
                        pid: 0, // Managed by Overlord, not Process 
                        homeRoom: this.colony.name,
                        targetId: this.source.id
                    }
                });
            }
        }
    }

    run(): void {
        for (const zerg of this.zergs) {
            if (!zerg.task) {
                zerg.task = new HarvestTask(this.source);
            }
        }
    }
}
