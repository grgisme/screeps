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
    flagName: string; // Heap-safe: Store string ID, not the live Flag object
    colony: Colony;
    roomName: string;
    overlords: Overlord[] = [];

    constructor(flag: Flag, colony: Colony) {
        this.flagName = flag.name;
        this.colony = colony;
        this.roomName = flag.pos.roomName;
        log.info(`Directive created: ${this.constructor.name} for ${this.targetRoom}`);
    }

    // -----------------------------------------------------------------------
    // Getters — resolve live Game objects each tick (no V8 leaks)
    // -----------------------------------------------------------------------

    get flag(): Flag | undefined {
        return Game.flags[this.flagName];
    }

    get pos(): RoomPosition | undefined {
        return this.flag?.pos;
    }

    /** Target room name extracted from flag name (e.g. "inc:W2N1" → "W2N1") */
    get targetRoom(): string {
        const parts = this.flagName.split(":");
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
