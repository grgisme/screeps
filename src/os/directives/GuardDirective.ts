// ============================================================================
// GuardDirective — Deploys a combat creep to defend a remote room
// ============================================================================
// Triggered by placing a flag named "guard:RoomName" (e.g. "guard:W2N1").
// Reuses DestroyerOverlord for combat logic (retreat, kiting, healing).

import { Directive } from "./Directive";
import type { Colony } from "../colony/Colony";
import { DestroyerOverlord } from "../overlords/DestroyerOverlord";
import { Logger } from "../../utils/Logger";

const log = new Logger("GuardDirective");

export class GuardDirective extends Directive {
    private guardOverlord: DestroyerOverlord | null = null;

    constructor(flag: Flag, colony: Colony) {
        super(flag, colony);
    }

    init(): void {
        if (!this.guardOverlord) {
            const target = this.targetRoom;
            log.info(`Guard patrol activated for ${target}`);
            this.guardOverlord = new DestroyerOverlord(this.colony, target);
            this.registerOverlord(this.guardOverlord);
        }
    }

    run(): void {
        // DestroyerOverlord handles all combat logic — nothing extra needed
    }
}
