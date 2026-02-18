// ============================================================================
// GlobalManager — Tick-wide system init + Colony bootstrapping
//
// This module is the "warm start" initializer. It ensures colonies are
// registered as Kernel processes, rather than executing them directly.
// Colony objects are data/state containers; execution is handled by
// ColonyProcess under the Kernel's scheduler (load shedding, CPU budgets).
// ============================================================================

import { Kernel } from "./Kernel";
import { ColonyProcess } from "../os/processes/ColonyProcess";
import { Logger } from "../utils/Logger";

const log = new Logger("GlobalManager");

export class GlobalManager {
    /**
     * Initialize the global game state for the current tick.
     *
     * Iterates all owned rooms and ensures each has a corresponding
     * ColonyProcess registered with the Kernel. This replaces the
     * previous pattern of instantiating Colony objects directly
     * (the "Two Masters" anti-pattern) which bypassed load shedding
     * and kernel panics.
     *
     * @param kernel The Kernel instance to register colony processes with
     */
    static init(kernel: Kernel): void {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) {
                continue;
            }

            const processId = `colony:${roomName}`;
            if (kernel.hasProcessId(processId)) {
                continue;
            }

            // Spawn a new ColonyProcess (Priority 0 = critical)
            const proc = new ColonyProcess(0, 0, null, roomName);
            kernel.addProcess(proc);
            log.info(`→ Spawned ColonyProcess for ${roomName} (PID ${proc.pid})`);
        }
    }

    /**
     * End-of-tick commit. Currently a placeholder for future
     * global-scope bookkeeping (stats, inter-colony comms, etc.).
     */
    static run(): void {
        // Reserved for end-of-tick operations
    }
}
