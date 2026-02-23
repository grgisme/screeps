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

            const capacity = this.colony.room?.energyCapacityAvailable ?? 300;
            this.colony.hatchery.enqueue({
                priority: 30,
                bodyTemplate: this.getReserverBody(capacity, ticksToEnd),
                overlord: this,
                name: `reserver_${this.targetRoom}_${Game.time}`,
                memory: { role: "reserver", targetRoom: this.targetRoom }
            });
        }
    }

    /**
     * Scale CLAIM count based on buffer urgency and available energy.
     *
     * Net buffer gain/tick = (CLAIM parts - 1)  [decay rate = 1 tick/tick]
     *
     * | CLAIM | Cost  | Net gain | Ticks to fill 5,000 |
     * |-------|-------|----------|---------------------|
     * |   1   |  650  |    0     | never (maintenance) |
     * |   2   | 1300  |   +1     |       5,000         |
     * |   3   | 1950  |   +2     |       2,500         |
     * |   4   | 2600  |   +3     |       1,667         |
     * |   5   | 3250  |   +4     |       1,250         |
     *
     * When buffer < 1,000 ticks (critical — near expiry), use the
     * maximum CLAIM count the room can afford to reset as fast as possible.
     * Otherwise 2 CLAIM is sufficient to build the buffer steadily.
     */
    private getReserverBody(capacity: number, ticksToEnd: number): BodyPartConstant[] {
        const claimBody = (n: number): BodyPartConstant[] => [
            ...Array<BodyPartConstant>(n).fill(CLAIM),
            ...Array<BodyPartConstant>(n).fill(MOVE),
        ];

        // Critical: buffer nearly gone — fill as fast as the room can afford
        if (ticksToEnd < 1000) {
            if (capacity >= 3250) return claimBody(5);
            if (capacity >= 2600) return claimBody(4);
            if (capacity >= 1950) return claimBody(3);
            if (capacity >= 1300) return claimBody(2);
        } else {
            // Below threshold but not critical — 2 CLAIM builds the buffer at +1/tick
            if (capacity >= 1300) return claimBody(2);
        }

        // Low-capacity rooms / maintenance: 1 CLAIM offsets decay
        return [CLAIM, MOVE];
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
