// ============================================================================
// RoomPlannerProcess — Finds the optimal location for the base
// ============================================================================

import { Process } from "../../kernel/Process";
import { Colony } from "../Colony";
import { distanceTransform } from "../../utils/Algorithms";
import { Logger } from "../../utils/Logger";

const log = new Logger("RoomPlanner");

export class RoomPlannerProcess extends Process {
    colonyName: string;
    colony: Colony;
    processName = "roomPlanner";

    constructor(pid: number, priority: number, parentPID: number, colonyName: string) {
        super(pid, priority, parentPID);
        this.colonyName = colonyName;
        // Resolve colony reference (unsafe in constructor? usually fine if we don't use it yet)
        // Better to resolve in run()
        this.colony = (globalThis as any).ColonyProcess?.getColony(colonyName);
        // Note: ColonyProcess might not be globally available like this. 
        // We might need a registry or pass it. 
        // For now, let's assume we can look it up or pass it in data.
    }

    run(): void {
        // Re-acquire colony if needed
        if (!this.colony) {
            // Try to find it via global map or similar.
            // For now, let's assume one exists or we get it from game object
            // Actually, best pattern is to look up usage. 
            // We probably don't have a global registry yet. 
            return;
        }

        const room = Game.rooms[this.colonyName];
        if (!room) return; // No visibility

        // Check if anchor is already set
        if (this.colony.memory && this.colony.memory.anchor) {
            // Plan is set. We can sleep or suspend.
            // For visualization re-requests, we can keep running but do nothing heavy.
            return;
        }

        log.info(`Planning room ${this.colonyName}...`);
        // Run Distance Transform
        const dt = distanceTransform(this.colonyName);

        // Find best spot
        let maxDist = 0;
        let bestPos: { x: number, y: number } | null = null;

        for (let x = 6; x < 44; x++) {
            for (let y = 6; y < 44; y++) {
                if (dt.get(x, y) > maxDist) {
                    maxDist = dt.get(x, y);
                    bestPos = { x, y };
                }
            }
        }

        if (bestPos && maxDist >= 6) { // Need at least 6 radius for 13x13? (Center + 6)
            log.info(`Found anchor at ${bestPos.x}, ${bestPos.y} with distance ${maxDist}`);

            // Persist
            if (!this.colony.memory) this.colony.memory = {} as any;
            this.colony.memory.anchor = { x: bestPos.x, y: bestPos.y };
        } else {
            log.warning(`Could not find perfect anchor in ${this.colonyName}. Max dist: ${maxDist}. Picking best available.`);
            if (bestPos) {
                if (!this.colony.memory) this.colony.memory = {} as any;
                this.colony.memory.anchor = { x: bestPos.x, y: bestPos.y };
            }
        }
    }
}
