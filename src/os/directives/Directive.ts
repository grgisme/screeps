// ============================================================================
// Directive — Base class for flag-driven mission objectives
// ============================================================================

import type { Colony } from "../colony/Colony";
import { Overlord } from "../overlords/Overlord";
import { Logger } from "../../utils/Logger";

const log = new Logger("Directive");

/**
 * A Directive wraps a Flag and represents a strategic objective.
 * It registers with a Colony and instantiates the Overlords needed
 * to fulfill the mission. This keeps Colony.ts clean — it just scans
 * for active Directives and delegates all logic.
 */
export abstract class Directive {
    flag: Flag;
    colony: Colony;
    pos: RoomPosition;
    roomName: string;
    overlords: Overlord[] = [];

    constructor(flag: Flag, colony: Colony) {
        this.flag = flag;
        this.colony = colony;
        this.pos = flag.pos;
        this.roomName = flag.pos.roomName;
        log.info(`Directive created: ${this.constructor.name} for ${this.roomName}`);
    }

    /** Target room name extracted from flag name (e.g. "inc:W2N1" → "W2N1") */
    get targetRoom(): string {
        const parts = this.flag.name.split(":");
        return parts.length > 1 ? parts[1] : this.roomName;
    }

    /** Whether we currently have visibility into the target room */
    get isTargetVisible(): boolean {
        return !!Game.rooms[this.targetRoom];
    }

    /** Register an overlord under this directive */
    registerOverlord(overlord: Overlord): void {
        this.overlords.push(overlord);
        this.colony.registerOverlord(overlord);
    }

    /** Refresh state at start of tick — override for custom refresh */
    abstract init(): void;

    /** Execute directive logic */
    abstract run(): void;
}
