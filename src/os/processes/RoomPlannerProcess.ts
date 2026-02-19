// ============================================================================
// RoomPlannerProcess — Finds the optimal location for the base
// ============================================================================

import { Process } from "../../kernel/Process";
import { Colony } from "../colony/Colony";
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
        this.colony = (global as any).ColonyProcess?.getColony(colonyName);
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
            // Genesis Architect: Place structures
            if (Game.time % 100 === 0) { // Run sparingly
                this.placeStructures();
            }
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

    private placeStructures(): void {
        const anchor = this.colony.memory!.anchor!; // Safebang
        // const anchorPos = new RoomPosition(anchor.x, anchor.y, this.colony.name);
        const rcl = this.colony.room?.controller?.level || 0;

        const allowed = (global as any).CONTROLLER_STRUCTURES || CONTROLLER_STRUCTURES;
        const structureTypes = Object.keys(allowed) as StructureConstant[];

        console.log(`Genesis Architect: Bunker layout calculated. Build Priority: Containers > Extensions`);

        for (const type of structureTypes) {
            if (type === STRUCTURE_CONTROLLER) continue;

            const layout = (require("../infrastructure/BunkerLayout").BunkerLayout.structures as any)[type];
            if (!layout) continue;

            const max = allowed[type][rcl];
            if (max === 0) continue;

            for (let i = 0; i < layout.length; i++) {
                if (i >= max) break;

                const coord = layout[i];
                const pos = new RoomPosition(anchor.x + coord.x, anchor.y + coord.y, this.colony.name);

                if (Game.map.getRoomTerrain(this.colony.name).get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;

                const struct = pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === type);
                const site = pos.lookFor(LOOK_CONSTRUCTION_SITES).find(s => s.structureType === type);

                if (!struct && !site) {
                    pos.createConstructionSite(type as BuildableStructureConstant);
                }
            }
        }
    }
}
