// ============================================================================
// ScoutOverlord — Sends a minimal creep to explore an invisible room
// ============================================================================

import { Overlord } from "../Overlord";
import type { Colony } from "../../colony/Colony";
import { Logger } from "../../../utils/Logger";

const log = new Logger("ScoutOverlord");

/**
 * Spawns a single [MOVE] creep to explore a target room.
 * Once the room is visible, no replacement is spawned.
 */
export class ScoutOverlord extends Overlord {
    targetRoom: string;

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `scout_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        // If room is already visible, no need for a scout
        if (Game.rooms[this.targetRoom]) {
            return;
        }

        // Check if we already have a scout assigned
        const scouts = this.zergs.filter(z => (z.memory as any).role === "scout");
        if (scouts.length > 0) {
            return; // Scout is already alive and traveling
        }

        // Request a minimal scout
        log.info(`Requesting scout for ${this.targetRoom}`);
        this.colony.hatchery.enqueue({
            priority: 10, // Low priority — scouting is cheap
            bodyTemplate: [MOVE], // Single MOVE part — cheapest possible
            overlord: this,
            name: `scout_${this.targetRoom}_${Game.time}`,
            memory: { role: "scout", targetRoom: this.targetRoom }
        });
    }

    run(): void {
        const scouts = this.zergs.filter(z => (z.memory as any).role === "scout");
        for (const scout of scouts) {
            // If already in target room, job is done — just idle
            if (scout.creep.room.name === this.targetRoom) {
                return;
            }

            // Travel to the target room center
            const targetPos = new RoomPosition(25, 25, this.targetRoom);
            scout.travelTo(targetPos, 20); // range 20 = just enter the room
        }
    }
}
