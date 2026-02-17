// ============================================================================
// ReserverOverlord — Buffer Cycling reservation for remote rooms
// ============================================================================

import { Overlord } from "../Overlord";
import { Colony } from "../../colony/Colony";
import { Logger } from "../../../utils/Logger";

const log = new Logger("ReserverOverlord");

/** Estimated ticks to spawn a [CLAIM, CLAIM, MOVE, MOVE] body */
const RESERVER_SPAWN_TIME = 12; // 4 parts × 3 ticks/part

/** Safety buffer for congestion and travel variance */
const SAFETY_BUFFER = 500;

/**
 * Implements "Buffer Cycling" from the research:
 * Only request a Reserver creep when:
 *   controller.reservation.ticksToEnd < (Distance + SpawnTime + SafetyBuffer)
 *
 * This minimizes energy spent on expensive CLAIM bodies by
 * avoiding constant reserver presence.
 */
export class ReserverOverlord extends Overlord {
    targetRoom: string;
    distance: number;

    constructor(colony: Colony, targetRoom: string, distance: number) {
        super(colony, `reserver_${targetRoom}`);
        this.targetRoom = targetRoom;
        this.distance = distance;
    }

    /**
     * Calculate the threshold below which we need to spawn a new reserver.
     * Formula: Distance + SpawnTime + SafetyBuffer
     */
    getThreshold(): number {
        return this.distance + RESERVER_SPAWN_TIME + SAFETY_BUFFER;
    }

    init(): void {
        // Check if we already have a reserver assigned
        const reservers = this.zergs.filter(z => (z.memory as any).role === "reserver");
        if (reservers.length > 0) {
            return; // Reserver is already alive
        }

        // Check room visibility
        const room = Game.rooms[this.targetRoom];
        if (!room || !room.controller) {
            return; // No visibility or no controller — wait for scout
        }

        // Buffer Cycling: only spawn if ticksToEnd < threshold
        const reservation = room.controller.reservation;
        const ticksToEnd = reservation ? reservation.ticksToEnd : 0;
        const threshold = this.getThreshold();

        if (ticksToEnd < threshold) {
            log.info(`Reservation low in ${this.targetRoom}: ${ticksToEnd} < ${threshold}. Requesting reserver.`);
            this.colony.hatchery.enqueue({
                priority: 30, // Medium — important but not as critical as miners
                bodyTemplate: [CLAIM, CLAIM, MOVE, MOVE], // Net +1 tick/tick after decay
                overlord: this,
                name: `reserver_${this.targetRoom}_${Game.time}`,
                memory: { role: "reserver", targetRoom: this.targetRoom }
            });
        }
    }

    run(): void {
        const reservers = this.zergs.filter(z => (z.memory as any).role === "reserver");
        for (const reserver of reservers) {
            const room = Game.rooms[this.targetRoom];

            // If we have visibility and a controller, go reserve it
            if (room && room.controller) {
                if (reserver.pos.inRangeTo(room.controller.pos, 1)) {
                    reserver.creep.reserveController(room.controller);
                } else {
                    reserver.travelTo(room.controller.pos, 1);
                }
            } else {
                // Travel to room center to gain visibility
                const targetPos = new RoomPosition(25, 25, this.targetRoom);
                reserver.travelTo(targetPos, 20);
            }
        }
    }
}
