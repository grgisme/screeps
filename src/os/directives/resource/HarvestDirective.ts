// ============================================================================
// HarvestDirective — Orchestrates remote harvesting from a flag
// ============================================================================

import { Directive } from "../Directive";
import { Colony } from "../../colony/Colony";
import { ScoutOverlord } from "../../overlords/colonization/ScoutOverlord";
import { ReserverOverlord } from "../../overlords/colonization/ReserverOverlord";
import { RemoteMiningOverlord } from "../../overlords/colonization/RemoteMiningOverlord";
import { Logger } from "../../../utils/Logger";

const log = new Logger("HarvestDirective");

/**
 * HarvestDirective orchestrates remote room exploitation:
 *
 * 1. If the target room is invisible → spawn ScoutOverlord
 * 2. Once visible → spawn RemoteMiningOverlord + ReserverOverlord
 *
 * Triggered by placing a flag named "inc:RoomName" (e.g. "inc:W2N1").
 */
export class HarvestDirective extends Directive {
    private scoutOverlord: ScoutOverlord | null = null;
    private remoteMiningOverlord: RemoteMiningOverlord | null = null;
    private reserverOverlord: ReserverOverlord | null = null;
    private _initialized = false;
    private _distance: number = 0;

    constructor(flag: Flag, colony: Colony) {
        super(flag, colony);
    }

    init(): void {
        const target = this.targetRoom;

        if (!this.isTargetVisible) {
            // Phase 1: Room is invisible — send a scout
            if (!this.scoutOverlord) {
                this.scoutOverlord = new ScoutOverlord(this.colony, target);
                this.registerOverlord(this.scoutOverlord);
            }
            return;
        }

        // Phase 2: Room is visible — set up mining and reservation
        if (!this._initialized) {
            this._initialized = true;

            // Calculate distance from home colony to remote room
            const homeSpawn = this.colony.room.find(FIND_MY_SPAWNS)[0];
            const remoteRoom = Game.rooms[target];
            if (homeSpawn && remoteRoom) {
                const path = PathFinder.search(homeSpawn.pos, { pos: new RoomPosition(25, 25, target), range: 20 });
                this._distance = path.path.length;
            }

            // Instantiate RemoteMiningOverlord
            this.remoteMiningOverlord = new RemoteMiningOverlord(this.colony, target);
            this.registerOverlord(this.remoteMiningOverlord);

            // Instantiate ReserverOverlord if there's a controller to reserve
            if (remoteRoom && remoteRoom.controller && !remoteRoom.controller.my) {
                this.reserverOverlord = new ReserverOverlord(this.colony, target, this._distance);
                this.registerOverlord(this.reserverOverlord);
            }

            // Log the activation
            const reservation = remoteRoom?.controller?.reservation;
            const tickCount = reservation ? reservation.ticksToEnd : 0;
            log.info(`Directive: Remote Mining initiated in ${target}. Distance: ${this._distance}. Reservation Status: ${tickCount}.`);
            console.log(`Directive: Remote Mining initiated in ${target}. Distance: ${this._distance}. Reservation Status: ${tickCount}.`);
        }
    }

    run(): void {
        // Overlords are run by Colony — nothing extra needed here
    }
}
