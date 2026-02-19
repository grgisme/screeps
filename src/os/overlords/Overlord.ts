// ============================================================================
// Overlord — Base class for task managers
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import type { Colony } from "../colony/Colony";

export abstract class Overlord {
    colony: Colony;
    processId: string;

    private _zergs: Zerg[] = [];
    private _zergsTick: number = 0;

    constructor(colony: Colony, processId: string) {
        this.colony = colony;
        this.processId = processId;
    }

    /** 
     * Subreaper Logic (Orphan Adoption)
     * Dynamically resolves all creeps belonging to this Overlord by checking 
     * the `_overlord` memory flag. This guarantees that creeps are instantly 
     * re-adopted after a Global Reset (heap wipe).
     */
    get zergs(): Zerg[] {
        if (this._zergsTick !== Game.time) {
            const allCreeps = this.colony.creeps ?? [];
            const myCreeps = allCreeps.filter(c => (c.memory as any)._overlord === this.processId);
            this._zergs = myCreeps.map(c => this.colony.registerZerg(c));
            this._zergsTick = Game.time;
        }
        return this._zergs;
    }

    /** Refresh state at start of tick */
    abstract init(): void;

    /** Execute logic (assign tasks) */
    abstract run(): void;

    /** Add a Zerg to this overlord's control manually if needed */
    addZerg(zerg: Zerg): void {
        if (zerg.memory) {
            (zerg.memory as any)._overlord = this.processId;
        }
        if (!this._zergs.some(z => z.name === zerg.name)) {
            this._zergs.push(zerg);
        }
    }
}
