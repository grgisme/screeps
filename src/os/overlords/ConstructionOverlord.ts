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
    private checkFrequency = 20;

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

        // 2. Global Guard: yield 0 CPU while workers are busy
        const activeSites = this.colony.room?.find(FIND_MY_CONSTRUCTION_SITES).length ?? 0;
        if (activeSites >= 3) return;

        // Only run periodically or on RCL change
        if (Game.time % this.checkFrequency !== 0 && !this.colony.state.rclChanged) {
            return;
        }

        const budget = { count: 3 - activeSites };

        // 3. Parse anchor and RCL
        const anchor = this.colony.memory.anchor;
        const anchorPos = new RoomPosition(anchor.x, anchor.y, this.colony.name);
        const rcl = this.colony.room?.controller?.level || 0;

        // 4. Place structures
        this.checkBunker(anchorPos, rcl, budget);
        if (rcl >= 3 && budget.count > 0) {
            this.checkRoads(anchorPos, rcl, budget);
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

        // Scan x:8..41, y:8..41 to ensure the bunker leaves a 2-tile border near exits
        for (let x = 8; x < 42; x++) {
            for (let y = 8; y < 42; y++) {
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
        if (type === STRUCTURE_ROAD) return rcl >= 3 ? 2500 : 0;

        // Delay Ramparts & Walls until Storage Phase (RCL 4)
        if (type === STRUCTURE_WALL || type === STRUCTURE_RAMPART) {
            return rcl >= 4 ? 2500 : 0;
        }

        if (type === STRUCTURE_CONTAINER) return 5;
        const allowed = CONTROLLER_STRUCTURES[type as BuildableStructureConstant];
        if (typeof allowed === "number") return allowed;
        return allowed ? (allowed[rcl] || 0) : 0;
    }

    // ========================================================================
    // Bunker Construction — O(1) hash set, one site per tick
    // ========================================================================

    private checkBunker(anchor: RoomPosition, rcl: number, budget: { count: number }): void {
        const room = this.colony.room;
        if (!room) return;

        // O(1) cache — completely eliminates lookFor CPU bombs
        const existing = new Set([
            ...room.find(FIND_STRUCTURES).map(s => `${s.structureType}:${s.pos.x},${s.pos.y}`),
            ...room.find(FIND_MY_CONSTRUCTION_SITES).map(s => `${s.structureType}:${s.pos.x},${s.pos.y}`)
        ]);

        const layoutStructures = BunkerLayout.structures as Partial<Record<StructureConstant, any[]>>;

        // Sort structural placement by absolute priority
        const BUILD_PRIORITY: Partial<Record<StructureConstant, number>> = {
            [STRUCTURE_SPAWN]: 1,
            [STRUCTURE_TOWER]: 2,
            [STRUCTURE_EXTENSION]: 3,
            [STRUCTURE_STORAGE]: 4,
            [STRUCTURE_TERMINAL]: 5,
            [STRUCTURE_LINK]: 6,
            [STRUCTURE_LAB]: 7,
            [STRUCTURE_CONTAINER]: 8,
            [STRUCTURE_ROAD]: 9,
            [STRUCTURE_RAMPART]: 10,
            [STRUCTURE_WALL]: 11,
        };

        const sortedTypes = (Object.keys(layoutStructures) as StructureConstant[]).sort((a, b) =>
            (BUILD_PRIORITY[a] ?? 99) - (BUILD_PRIORITY[b] ?? 99)
        );

        for (const typeStr of sortedTypes) {
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
                    budget.count--;
                    if (budget.count <= 0) return;
                }
            }
        }
    }

    // ========================================================================
    // Road Construction — drip-feed placement
    // ========================================================================

    private checkRoads(anchor: RoomPosition, rcl: number, budget: { count: number }): void {
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

        // Cache CostMatrix outside the loop — same room, same tick
        let cachedMatrix: CostMatrix | null = null;

        for (const dest of destinations) {
            if (!dest) continue;
            const path = PathFinder.search(anchor, { pos: dest, range: 1 }, {
                plainCost: 2,
                swampCost: 5,
                roomCallback: (roomName) => {
                    if (roomName !== this.colony.name) return false;

                    if (cachedMatrix) return cachedMatrix;

                    const cm = new PathFinder.CostMatrix();
                    const cbRoom = Game.rooms[roomName];
                    if (!cbRoom) return cm;

                    cbRoom.find(FIND_STRUCTURES).forEach(s => {
                        if (s.structureType === STRUCTURE_ROAD) {
                            cm.set(s.pos.x, s.pos.y, 1);
                        } else if (s.structureType !== STRUCTURE_CONTAINER && s.structureType !== STRUCTURE_RAMPART) {
                            cm.set(s.pos.x, s.pos.y, 255);
                        }
                    });
                    cbRoom.find(FIND_MY_CONSTRUCTION_SITES).forEach(s => {
                        if (s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_CONTAINER) {
                            cm.set(s.pos.x, s.pos.y, 255);
                        }
                    });

                    cachedMatrix = cm;
                    return cm;
                }
            });

            for (const pos of path.path) {
                if (existing.has(`${pos.x},${pos.y}`)) continue;
                if (pos.createConstructionSite(STRUCTURE_ROAD) === OK) {
                    budget.count--;
                    if (budget.count <= 0) return;
                }
            }
        }
    }
}
