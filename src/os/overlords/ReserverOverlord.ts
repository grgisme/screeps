import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { ReserveTask } from "../tasks/ReserveTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("ReserverOverlord");
const RESERVER_SPAWN_TIME = 12;
const SAFETY_BUFFER = 500;

export class ReserverOverlord extends Overlord {
    targetRoom: string;
    distance: number;
    reservers: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string, distance: number) {
        super(colony, `reserver_${targetRoom}`);
        this.targetRoom = targetRoom;
        this.distance = distance;
    }

    getThreshold(): number { return this.distance + RESERVER_SPAWN_TIME + SAFETY_BUFFER; }

    init(): void {
        this.reservers = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "reserver");
        if (this.reservers.length > 0) return;

        const room = Game.rooms[this.targetRoom];
        if (!room || !room.controller) return;

        const reservation = room.controller.reservation;
        const ticksToEnd = reservation ? reservation.ticksToEnd : 0;

        if (ticksToEnd < this.getThreshold()) {
            log.info(`Reservation low in ${this.targetRoom}: ${ticksToEnd} < ${this.getThreshold()}. Requesting reserver.`);

            // ── FIX: Scale body to prevent RCL 3 Deadlock ──
            const capacity = this.colony.room?.energyCapacityAvailable ?? 300;
            const template = capacity >= 1300 ? [CLAIM, CLAIM, MOVE, MOVE] : [CLAIM, MOVE];

            this.colony.hatchery.enqueue({
                priority: 30,
                bodyTemplate: template,
                overlord: this,
                name: `reserver_${this.targetRoom}_${Game.time}`,
                memory: { role: "reserver", targetRoom: this.targetRoom }
            });
        }
    }

    run(): void {
        for (const reserver of this.reservers) {
            if (!reserver.isAlive() || reserver.task) continue;
            const room = Game.rooms[this.targetRoom];
            if (room && room.controller && reserver.room?.name === this.targetRoom) {
                reserver.setTask(new ReserveTask(room.controller.id));
            } else {
                reserver.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
            }
        }
    }
}
