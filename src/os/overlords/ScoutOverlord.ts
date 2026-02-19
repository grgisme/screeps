import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";

const log = new Logger("ScoutOverlord");

export class ScoutOverlord extends Overlord {
    targetRoom: string;
    scouts: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `scout_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        this.scouts = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "scout");
        if (Game.rooms[this.targetRoom] || this.scouts.length > 0) return;

        log.info(`Room ${this.targetRoom} invisible, requesting scout.`);

        this.colony.hatchery.enqueue({
            priority: 10,
            bodyTemplate: [MOVE],
            overlord: this,
            name: `scout_${this.targetRoom}_${Game.time}`,
            memory: { role: "scout", targetRoom: this.targetRoom }
        });
    }

    run(): void {
        for (const scout of this.scouts) {
            if (!scout.isAlive() || scout.task) continue;
            if (scout.room?.name !== this.targetRoom) {
                scout.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
            }
        }
    }
}
