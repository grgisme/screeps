// ============================================================================
// ConstructionOverlord — The Architect
// Manages room planning (anchor placement) and automated construction.
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { distanceTransform } from "../../utils/Algorithms";
import { Logger } from "../../utils/Logger";

const log = new Logger("ConstructionOverlord");

export class ConstructionOverlord extends Overlord {
    private checkFrequency = 100;

    constructor(colony: Colony) {
        super(colony, "construction");
    }

    init(): void {
        // Build logic runs in run()
    }

    run(): void {
        // 1. If no anchor, plan the room first
        if (!this.colony.memory.anchor) {
            this.planRoom();
            return;
        }

        // Only run periodically or on RCL change
        if (Game.time % this.checkFrequency !== 0 && !this.colony.state.rclChanged) {
            return;
        }

        // 2. Global Guard: Never exceed 3 active sites per room
        const activeSites = this.colony.room?.find(FIND_MY_CONSTRUCTION_SITES).length ?? 0;
        if (activeSites >= 3) return;

        // 3. Parse anchor and RCL
        const anchor = this.colony.memory.anchor;
        const anchorPos = new RoomPosition(anchor.x, anchor.y, this.colony.name);
        const rcl = this.colony.room?.controller?.level || 0;

        // 4. Place structures
        this.checkBunker(anchorPos, rcl);
        if (rcl >= 3) {
            this.checkRoads(anchorPos, rcl);
        }

        // 5. Reset the RCL changed flag
        this.colony.state.rclChanged = false;
    }

    // ========================================================================
    // Room Planning — Distance Transform anchor placement
    // ========================================================================

    private planRoom(): void {
        const dt = distanceTransform(this.colony.name);

        let maxDist = 0;
        let bestPos: { x: number; y: number } | null = null;

        // Scan x:6..43, y:6..43 to ensure the 13x13 bunker fits
        for (let x = 6; x < 44; x++) {
            for (let y = 6; y < 44; y++) {
                if (dt.get(x, y) > maxDist) {
                    maxDist = dt.get(x, y);
                    bestPos = { x, y };
                }
            }
        }

        if (bestPos && maxDist >= 6) {
            log.info(`Anchor found at ${bestPos.x},${bestPos.y} (dist=${maxDist})`);
            this.colony.memory.anchor = { x: bestPos.x, y: bestPos.y };
        } else {
            log.warning(`No valid anchor in ${this.colony.name} (maxDist=${maxDist})`);
            if (bestPos) {
                this.colony.memory.anchor = { x: bestPos.x, y: bestPos.y };
            }
        }
    }

    // ========================================================================
    // CONTROLLER_STRUCTURES safe lookup
    // ========================================================================

    private getMaxStructures(type: StructureConstant, rcl: number): number {
        if (type === STRUCTURE_ROAD || type === STRUCTURE_WALL || type === STRUCTURE_RAMPART) return 2500;
        if (type === STRUCTURE_CONTAINER) return 5;
        const allowed = CONTROLLER_STRUCTURES[type as BuildableStructureConstant];
        if (typeof allowed === "number") return allowed;
        return allowed ? (allowed[rcl] || 0) : 0;
    }

    // ========================================================================
    // Bunker Construction — O(1) hash set, one site per tick
    // ========================================================================

    private checkBunker(anchor: RoomPosition, rcl: number): void {
        const room = this.colony.room;
        if (!room) return;

        // O(1) cache — completely eliminates lookFor CPU bombs
        const existing = new Set([
            ...room.find(FIND_STRUCTURES).map(s => `${s.structureType}:${s.pos.x},${s.pos.y}`),
            ...room.find(FIND_MY_CONSTRUCTION_SITES).map(s => `${s.structureType}:${s.pos.x},${s.pos.y}`)
        ]);

        const layoutStructures = BunkerLayout.structures as Partial<Record<StructureConstant, any[]>>;

        for (const typeStr of Object.keys(layoutStructures)) {
            const type = typeStr as BuildableStructureConstant;
            const maxAllowed = this.getMaxStructures(type, rcl);
            if (maxAllowed === 0) continue;

            const positions = layoutStructures[typeStr as StructureConstant] || [];
            // Slice to respect the exact RCL limit
            const allowedPositions = positions.slice(0, maxAllowed);

            for (const rel of allowedPositions) {
                const pos = BunkerLayout.getPos(anchor, rel);
                if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

                const key = `${type}:${pos.x},${pos.y}`;
                if (existing.has(key)) continue;

                if (Game.map.getRoomTerrain(this.colony.name).get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;

                if (pos.createConstructionSite(type) === OK) {
                    log.info(`Architect: Placed ${type} site at ${pos.x}, ${pos.y}`);
                    return; // 🛑 One site per tick — prevent queue flooding
                }
            }
        }
    }

    // ========================================================================
    // Road Construction — drip-feed placement
    // ========================================================================

    private checkRoads(anchor: RoomPosition, rcl: number): void {
        if (rcl < 3) return;
        const room = this.colony.room;
        if (!room) return;

        const existing = new Set([
            ...room.find(FIND_STRUCTURES).filter(s => s.structureType === STRUCTURE_ROAD).map(s => `${s.pos.x},${s.pos.y}`),
            ...room.find(FIND_MY_CONSTRUCTION_SITES).filter(s => s.structureType === STRUCTURE_ROAD).map(s => `${s.pos.x},${s.pos.y}`)
        ]);

        const destinations = [
            room.controller?.pos,
            ...room.find(FIND_SOURCES).map((s: Source) => s.pos)
        ];

        for (const dest of destinations) {
            if (!dest) continue;
            const path = PathFinder.search(anchor, { pos: dest, range: 1 }, { plainCost: 2, swampCost: 2 });

            for (const pos of path.path) {
                if (existing.has(`${pos.x},${pos.y}`)) continue;
                if (pos.createConstructionSite(STRUCTURE_ROAD) === OK) {
                    return; // Drip-feed: one road per tick
                }
            }
        }
    }
}
