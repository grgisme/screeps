// ============================================================================
// ConstructionOverlord — Manages automated construction
// ============================================================================

import { Overlord } from "../../os/processes/Overlord";
import { Colony } from "../../os/Colony";
import { BunkerLayout } from "../../os/infrastructure/BunkerLayout";
import { Logger } from "../../utils/Logger";

const log = new Logger("ConstructionOverlord");

export class ConstructionOverlord extends Overlord {
    private checkFrequency = 100;

    constructor(colony: Colony) {
        super(colony, "construction"); // Priority defaults to 5 in base, needed?
        // Overlord constructor: (colony, processId)
        // processId should probably be unique if we have multiple, but one per colony is fine.
    }

    init(): void {
        // Build logic runs in run()
    }

    run(): void {
        if (Game.time % this.checkFrequency !== 0 && !this.colony.state.rclChanged) {
            return;
        }

        const anchor = this.colony.memory?.anchor;
        if (!anchor) {
            log.debug(`No anchor set for ${this.colony.name}, skipping construction.`);
            return;
        }

        const anchorPos = new RoomPosition(anchor.x, anchor.y, this.colony.name);
        const rcl = this.colony.room.controller?.level || 0;

        // 1. Check Bunker Structures
        this.checkBunker(anchorPos, rcl);

        // 2. Check Roads (Anchor -> Sources / Controller)
        this.checkRoads(anchorPos);

        // Reset change flag
        this.colony.state.rclChanged = false;
    }

    private checkBunker(anchor: RoomPosition, rcl: number): void {
        const allowed = CONTROLLER_STRUCTURES;
        const layoutStructures = BunkerLayout.structures as Partial<Record<StructureConstant, any[]>>;

        for (const type of Object.keys(layoutStructures) as StructureConstant[]) {
            // Check if type is buildable
            if (type === STRUCTURE_KEEPER_LAIR ||
                type === STRUCTURE_CONTROLLER ||
                type === STRUCTURE_POWER_BANK ||
                type === STRUCTURE_PORTAL ||
                type === STRUCTURE_INVADER_CORE) {
                continue;
            }

            // We know it's BuildableStructureConstant now effectively, but TS needs satisfying
            // Let's use 'in' check which is safer at runtime too
            if (!(type in allowed)) continue;

            const buildableType = type as BuildableStructureConstant;
            const max = allowed[buildableType][rcl];
            const positions = BunkerLayout.structures[type] || [];
            let count = 0;

            for (const rel of positions) {
                if (count >= max) break;

                const pos = BunkerLayout.getPos(anchor, rel);

                // Check if structure exists
                const struct = pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === type);
                // Check if site exists
                const site = pos.lookFor(LOOK_CONSTRUCTION_SITES).find(s => s.structureType === type);

                if (!struct && !site) {
                    // Check if path is blocked by wall (shouldn't be if planner is good)
                    if (pos.lookFor(LOOK_TERRAIN)[0] !== "wall") {
                        const match = pos.createConstructionSite(type);
                        if (match === OK) {
                            log.info(`Placed ${type} at ${pos.x}, ${pos.y}`);
                        }
                    }
                }

                if (struct || site || type === STRUCTURE_ROAD || type === STRUCTURE_RAMPART) {
                    // Roads/Ramparts don't count towards the 'max' limit in the same way (no global cap usually for roads)
                    // But for extensions/spawns/towers they do.
                    if (type !== STRUCTURE_ROAD && type !== STRUCTURE_RAMPART && type !== STRUCTURE_WALL) {
                        count++;
                    }
                }
            }
        }
    }

    private checkRoads(anchor: RoomPosition): void {
        const destinations = [
            this.colony.room.controller?.pos,
            ...this.colony.room.find(FIND_SOURCES).map(s => s.pos)
        ];

        for (const dest of destinations) {
            if (!dest) continue;

            const path = PathFinder.search(anchor, { pos: dest, range: 1 }, {
                plainCost: 2,
                swampCost: 2,
                roomCallback: (name) => {
                    if (name !== this.colony.name) return false;
                    const cm = new PathFinder.CostMatrix();
                    // Avoid walls? Terrain implies it.
                    return cm;
                }
            });

            if (!path.incomplete) {
                for (const pos of path.path) {
                    pos.createConstructionSite(STRUCTURE_ROAD);
                }
            }
        }
    }
}
