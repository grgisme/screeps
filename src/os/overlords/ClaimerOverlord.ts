// ============================================================================
// ClaimerOverlord — Spawns a single claimer to claim a target room's controller
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";

const log = new Logger("ClaimerOverlord");

export class ClaimerOverlord extends Overlord {
    targetRoom: string;
    claimers: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `claimer_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        this.claimers = this.zergs.filter(
            z => z.isAlive() && (z.memory as any)?.role === "claimer"
        );

        // Only spawn if no claimer exists and GCL allows expansion
        const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my).length;
        if (this.claimers.length > 0) return;
        if (ownedRooms >= Game.gcl.level) {
            log.warning(`Cannot claim ${this.targetRoom} — GCL ${Game.gcl.level} limit reached (${ownedRooms} rooms owned)`);
            return;
        }

        // Check if already claimed
        const targetRoom = Game.rooms[this.targetRoom];
        if (targetRoom?.controller?.my) {
            log.info(`${this.targetRoom} already claimed — claimer not needed`);
            return;
        }

        log.info(`Requesting claimer for ${this.targetRoom}`);
        this.colony.hatchery.enqueue({
            priority: 60,
            bodyTemplate: [CLAIM, MOVE],  // 650 energy
            overlord: this,
            name: `claimer_${this.targetRoom}_${Game.time}`,
            memory: { role: "claimer", targetRoom: this.targetRoom }
        });
    }

    run(): void {
        for (const claimer of this.claimers) {
            if (!claimer.isAlive()) continue;
            const creep = claimer.creep;
            if (!creep) continue;

            // Travel to target room
            if (creep.room.name !== this.targetRoom) {
                claimer.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                continue;
            }

            // Find the controller and claim it
            const controller = creep.room.controller;
            if (!controller) {
                log.warning(`No controller in ${this.targetRoom}!`);
                continue;
            }

            if (controller.my) {
                log.info(`${this.targetRoom} successfully claimed!`);
                continue;
            }

            // Move to controller and claim
            if (creep.pos.isNearTo(controller)) {
                const result = creep.claimController(controller);
                if (result === OK) {
                    log.info(`🏴 Claimed controller in ${this.targetRoom}!`);
                } else if (result === ERR_GCL_NOT_ENOUGH) {
                    log.warning(`GCL too low to claim ${this.targetRoom}`);
                } else {
                    log.warning(`Claim failed in ${this.targetRoom}: ${result}`);
                }
            } else {
                claimer.travelTo(controller.pos, 1);
            }
        }
    }
}
