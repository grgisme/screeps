import { Kernel } from "./Kernel";
import { ColonyProcess } from "../os/processes/ColonyProcess";
import { Logger } from "../utils/Logger";

const log = new Logger("GlobalManager");

/** Minimum storage energy for a colony to act as a rescue donor. */
const RESCUE_DONOR_THRESHOLD = 10000;
/** Ticks a colony must have been in blackout before rescue activates. */
const RESCUE_BLACKOUT_THRESHOLD = 20;
/** Body for the cross-room rescue transporter (25 CARRY = 1250 energy). */
const RESCUE_BODY: BodyPartConstant[] = [
    CARRY, CARRY, CARRY, CARRY, CARRY,
    CARRY, CARRY, CARRY, CARRY, CARRY,
    CARRY, CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE, MOVE, MOVE,
    MOVE, MOVE, MOVE, MOVE, MOVE,
];

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
     * End-of-tick commit: scan all colonies for blackout states and
     * dispatch cross-colony rescue when a healthy donor exists.
     *
     * Step 7 — Inter-Colony Rescue (Global Hivemind):
     * If Colony A has been in CRITICAL_BLACKOUT for > 20 ticks, find the
     * closest healthy Colony B (storage > 10k, no hostiles) and set
     * Memory.colonies[B].rescueTarget = A's room name. Colony B's
     * next refresh() will enqueue a RescueTransporter automatically.
     */
    static run(): void {
        const colonies = (Memory as any).colonies as Record<string, any> | undefined;
        if (!colonies) return;

        // Collect all owned rooms with their basic state from memory
        const ownedRooms = Object.keys(Game.rooms).filter(name => {
            const room = Game.rooms[name];
            return room.controller?.my;
        });

        if (ownedRooms.length < 2) return; // Step 7 requires at least 2 colonies

        const now = Game.time;

        for (const victimName of ownedRooms) {
            const victimMem = colonies[victimName];
            if (!victimMem) continue;

            const lastBlackout: number = victimMem.lastBlackoutTick ?? 0;
            const isBlackout = (now - lastBlackout) < 5; // active if flagged within last 5 ticks
            if (!isBlackout) continue;
            if ((now - lastBlackout) < RESCUE_BLACKOUT_THRESHOLD) continue; // too early

            // Victim is confirmed in prolonged blackout — already has a rescue dispatched?
            if (victimMem.rescueSentTick && (now - victimMem.rescueSentTick) < 300) continue;

            const victimRoom = Game.rooms[victimName];
            if (!victimRoom) continue;

            // Find closest healthy donor
            let bestDonor: string | null = null;
            let bestDistance = Infinity;

            for (const donorName of ownedRooms) {
                if (donorName === victimName) continue;
                const donorRoom = Game.rooms[donorName];
                if (!donorRoom?.storage) continue;
                if (donorRoom.storage.store.getUsedCapacity(RESOURCE_ENERGY) < RESCUE_DONOR_THRESHOLD) continue;
                if ((donorRoom.find(FIND_HOSTILE_CREEPS)?.length ?? 0) > 0) continue;
                // Already has a pending rescue task
                const donorMem = colonies[donorName];
                if (donorMem?.rescueTarget) continue;

                const dist = Game.map.getRoomLinearDistance(donorName, victimName);
                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestDonor = donorName;
                }
            }

            if (!bestDonor) continue;

            // Tag the donor colony — Colony.refresh() will pick this up and enqueue the rescue creep
            colonies[bestDonor].rescueTarget = victimName;
            victimMem.rescueSentTick = now;
            log.warning(`[GlobalManager] Step 7: Dispatching rescue from ${bestDonor} → ${victimName} (storage: ${Game.rooms[bestDonor]?.storage?.store.energy ?? '?'}e)`);
        }
    }
}

export { RESCUE_BODY };

