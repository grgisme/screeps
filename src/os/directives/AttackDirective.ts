// ============================================================================
// AttackDirective — Offensive strike on a target room
// ============================================================================
// Triggered by placing a flag named "atk:RoomName" (e.g. "atk:W3N2").
// Phase 1: ScoutOverlord if room is invisible.
// Phase 2: DestroyerOverlord once visible.

import { Directive } from "./Directive";
import type { Colony } from "../colony/Colony";
import { ScoutOverlord } from "../overlords/ScoutOverlord";
import { DestroyerOverlord } from "../overlords/DestroyerOverlord";
import { Logger } from "../../utils/Logger";

const log = new Logger("AttackDirective");

export class AttackDirective extends Directive {
    private scoutOverlord: ScoutOverlord | null = null;
    private attackOverlord: DestroyerOverlord | null = null;
    private _initialized = false;

    constructor(flag: Flag, colony: Colony) {
        super(flag, colony);
    }

    init(): void {
        const target = this.targetRoom;

        // Phase 1: Room is invisible — send a scout first
        if (!this.isTargetVisible) {
            if (!this.scoutOverlord) {
                log.info(`Attack target ${target} invisible — dispatching scout`);
                this.scoutOverlord = new ScoutOverlord(this.colony, target);
                this.registerOverlord(this.scoutOverlord);
            }
            return;
        }

        // Phase 2: Room is visible — deploy the strike team
        if (!this._initialized) {
            this._initialized = true;
            log.info(`Attack target ${target} visible — deploying destroyer`);
            this.attackOverlord = new DestroyerOverlord(this.colony, target);
            this.registerOverlord(this.attackOverlord);
        }
    }

    run(): void {
        // Overlords are run by Colony — nothing extra needed
    }
}
