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

        // Bunker Plan Visualization (every 5 ticks — RoomVisual is ~0 CPU, client-side only)
        if (Game.time % 5 === 0) {
            this.drawBunkerPlan();
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

        // 5. Controller Container (RCL 2+)
        if (rcl >= 2 && budget.count > 0) {
            this.checkControllerContainer(budget);
        }

        // 6. Hatchery Container (RCL 2+, pre-Storage only)
        if (rcl >= 2 && budget.count > 0 && !this.colony.room?.storage) {
            this.checkHatcheryContainer(budget);
        }

        // 7. Hatchery Container Cleanup (RCL 4+ when Storage built)
        //    Destroy hatchery containers so they don't block BunkerLayout structures
        if (this.colony.room?.storage) {
            this.cleanupHatcheryContainer();
        }

        // 8. Reset the RCL changed flag
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
    // Bunker Plan Visualization — RoomVisual overlay (~0 CPU)
    // ========================================================================

    private drawBunkerPlan(): void {
        const anchor = this.colony.memory.anchor;
        if (!anchor) return;

        const visual = new RoomVisual(this.colony.name);
        const anchorPos = new RoomPosition(anchor.x, anchor.y, this.colony.name);

        // Color mapping by structure type
        const COLORS: Partial<Record<StructureConstant, string>> = {
            [STRUCTURE_SPAWN]: '#00ff00',
            [STRUCTURE_EXTENSION]: '#ffcc00',
            [STRUCTURE_TOWER]: '#ff3333',
            [STRUCTURE_STORAGE]: '#00ccff',
            [STRUCTURE_TERMINAL]: '#0099ff',
            [STRUCTURE_LINK]: '#66ddff',
            [STRUCTURE_LAB]: '#cc66ff',
            [STRUCTURE_ROAD]: '#666666',
            [STRUCTURE_RAMPART]: '#336633',
            [STRUCTURE_CONTAINER]: '#996633',
        };

        const LABELS: Partial<Record<StructureConstant, string>> = {
            [STRUCTURE_SPAWN]: 'Spn',
            [STRUCTURE_EXTENSION]: 'Ext',
            [STRUCTURE_TOWER]: 'Twr',
            [STRUCTURE_STORAGE]: 'Sto',
            [STRUCTURE_TERMINAL]: 'Trm',
            [STRUCTURE_LINK]: 'Lnk',
            [STRUCTURE_LAB]: 'Lab',
            [STRUCTURE_ROAD]: '·',
            [STRUCTURE_RAMPART]: '',
            [STRUCTURE_CONTAINER]: 'Con',
        };

        const layoutStructures = BunkerLayout.structures as Partial<Record<StructureConstant, any[]>>;

        for (const [typeStr, positions] of Object.entries(layoutStructures)) {
            const type = typeStr as StructureConstant;
            const color = COLORS[type] || '#ffffff';
            const label = LABELS[type] ?? typeStr.substring(0, 3);
            const isRoad = type === STRUCTURE_ROAD;
            const isRampart = type === STRUCTURE_RAMPART;

            for (const rel of positions as Array<{ x: number, y: number }>) {
                const pos = BunkerLayout.getPos(anchorPos, rel);
                if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

                if (isRampart) {
                    // Ramparts: subtle border squares
                    visual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {
                        fill: color, opacity: 0.08, stroke: color, strokeWidth: 0.05
                    });
                } else if (isRoad) {
                    // Roads: small dots
                    visual.circle(pos.x, pos.y, { radius: 0.1, fill: color, opacity: 0.4 });
                } else {
                    // Structures: colored circles with labels
                    visual.circle(pos.x, pos.y, { radius: 0.4, fill: color, opacity: 0.25, stroke: color, strokeWidth: 0.1 });
                    if (label) {
                        visual.text(label, pos.x, pos.y + 0.1, { font: 0.28, color: color, opacity: 0.8 });
                    }
                }
            }
        }

        // Anchor crosshair
        visual.circle(anchor.x, anchor.y, { radius: 0.6, fill: '', stroke: '#ffffff', strokeWidth: 0.15, opacity: 0.6 });
        visual.text('⚓', anchor.x, anchor.y + 0.15, { font: 0.5, opacity: 0.7 });
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

        // O(1) caches:
        // - existing: type+position for exact duplicate check
        // - blockedTiles: positions with non-stackable structures/sites (can't place new structure here)
        const existing = new Set<string>();
        const blockedTiles = new Set<string>();
        for (const s of room.find(FIND_STRUCTURES)) {
            existing.add(`${s.structureType}:${s.pos.x},${s.pos.y}`);
            // Roads and ramparts can coexist with other structures
            if (s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART) {
                blockedTiles.add(`${s.pos.x},${s.pos.y}`);
            }
        }
        for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
            existing.add(`${s.structureType}:${s.pos.x},${s.pos.y}`);
            // ANY construction site blocks new site placement on that tile
            blockedTiles.add(`${s.pos.x},${s.pos.y}`);
        }

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

        // Pre-count existing structures + sites by type (room-wide, not position-specific)
        // This catches structures placed outside the bunker layout (e.g., starting spawn)
        const structureCount = new Map<string, number>();
        for (const s of room.find(FIND_STRUCTURES)) {
            structureCount.set(s.structureType, (structureCount.get(s.structureType) || 0) + 1);
        }
        for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
            structureCount.set(s.structureType, (structureCount.get(s.structureType) || 0) + 1);
        }

        for (const typeStr of sortedTypes) {
            const type = typeStr as BuildableStructureConstant;
            const maxAllowed = this.getMaxStructures(type, rcl);
            if (maxAllowed === 0) continue;

            // Room-wide cap check: skip if we already have enough of this type
            const currentCount = structureCount.get(type) || 0;
            if (currentCount >= maxAllowed) continue;

            const positions = layoutStructures[typeStr as StructureConstant] || [];
            // Slice to respect the exact RCL limit
            const allowedPositions = positions.slice(0, maxAllowed);

            for (const rel of allowedPositions) {
                const pos = BunkerLayout.getPos(anchor, rel);
                if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

                const key = `${type}:${pos.x},${pos.y}`;
                if (existing.has(key)) continue;

                // Skip tiles blocked by existing non-stackable structures or construction sites
                const tileKey = `${pos.x},${pos.y}`;
                if (type !== STRUCTURE_ROAD && type !== STRUCTURE_RAMPART && blockedTiles.has(tileKey)) continue;

                if (Game.map.getRoomTerrain(this.colony.name).get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;

                const result = pos.createConstructionSite(type);
                if (result === OK) {
                    log.info(`Architect: Placed ${type} site at ${pos.x}, ${pos.y}`);
                    budget.count--;
                    if (budget.count <= 0) return;
                } else {
                    log.warning(`Architect: FAILED to place ${type} at ${pos.x},${pos.y} — error ${result}`);
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

    /**
     * Place a container within 2 tiles of the controller for upgrader energy supply.
     * Picks the tile on the path from controller to the nearest source container
     * (optimal for hauler routes). Skips if a container already exists nearby.
     */
    private checkControllerContainer(budget: { count: number }): void {
        const room = this.colony.room;
        if (!room || !room.controller) return;

        const controller = room.controller;

        // Check if a container already exists within 3 tiles of controller
        const nearbyContainers = controller.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        });
        if (nearbyContainers.length > 0) return;

        // Also skip if a construction site already exists
        const nearbySites = controller.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
            filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
        });
        if (nearbySites.length > 0) return;

        // Find the nearest source to path from controller toward it
        const sources = room.find(FIND_SOURCES);
        if (sources.length === 0) return;

        const nearest = controller.pos.findClosestByRange(sources);
        if (!nearest) return;

        const path = PathFinder.search(controller.pos, { pos: nearest.pos, range: 2 }, {
            plainCost: 2,
            swampCost: 10,
            roomCallback: (roomName) => {
                const r = Game.rooms[roomName];
                if (!r) return false;
                const cm = new PathFinder.CostMatrix();
                r.find(FIND_STRUCTURES).forEach(s => {
                    if (s.structureType === STRUCTURE_WALL) cm.set(s.pos.x, s.pos.y, 255);
                });
                return cm;
            }
        });

        // Pick the first path tile within 2 tiles of controller (optimal hauler route position)
        for (const pos of path.path) {
            if (pos.getRangeTo(controller.pos) <= 2 && pos.getRangeTo(controller.pos) >= 1) {
                // Verify the tile isn't blocked
                const terrain = Game.map.getRoomTerrain(room.name).get(pos.x, pos.y);
                if (terrain === TERRAIN_MASK_WALL) continue;

                const blocked = pos.lookFor(LOOK_STRUCTURES)
                    .some((s: Structure) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART);
                if (blocked) continue;

                const result = pos.createConstructionSite(STRUCTURE_CONTAINER);
                if (result === OK) {
                    log.info(`Architect: Placed Controller Container at ${pos.x},${pos.y}`);
                    budget.count--;
                    return;
                }
            }
        }
    }

    /**
     * Place a Hatchery Container within 2 tiles of the spawn.
     * Acts as a central energy buffer for workers refilling extensions.
     * Skipped if Storage exists (RCL 4+ makes this redundant).
     */
    private checkHatcheryContainer(budget: { count: number }): void {
        const room = this.colony.room;
        if (!room) return;

        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        const spawn = spawns[0];

        // Check if a non-source, non-controller container already exists near spawn
        const controller = room.controller;
        const nearbyContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        }).filter(c => {
            // Exclude source containers (within 2 of a source)
            const nearSource = c.pos.findInRange(FIND_SOURCES, 2).length > 0;
            // Exclude controller containers (within 3 of controller)
            const nearCtrl = controller && c.pos.getRangeTo(controller) <= 3;
            return !nearSource && !nearCtrl;
        });
        if (nearbyContainers.length > 0) return;

        // Also skip if construction site already exists
        const nearbySites = spawn.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
            filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
        });
        if (nearbySites.length > 0) return;

        // Find optimal position: on path from spawn toward nearest source
        const sources = room.find(FIND_SOURCES);
        if (sources.length === 0) return;

        const nearest = spawn.pos.findClosestByRange(sources);
        if (!nearest) return;

        const path = PathFinder.search(spawn.pos, { pos: nearest.pos, range: 2 }, {
            plainCost: 2,
            swampCost: 10,
            roomCallback: (roomName) => {
                const r = Game.rooms[roomName];
                if (!r) return false;
                const cm = new PathFinder.CostMatrix();
                r.find(FIND_STRUCTURES).forEach(s => {
                    if (s.structureType === STRUCTURE_WALL) cm.set(s.pos.x, s.pos.y, 255);
                });
                return cm;
            }
        });

        // Pick a tile within 2 of spawn that isn't blocked
        for (const pos of path.path) {
            if (pos.getRangeTo(spawn.pos) <= 2 && pos.getRangeTo(spawn.pos) >= 1) {
                const terrain = Game.map.getRoomTerrain(room.name).get(pos.x, pos.y);
                if (terrain === TERRAIN_MASK_WALL) continue;

                const blocked = pos.lookFor(LOOK_STRUCTURES)
                    .some((s: Structure) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART);
                if (blocked) continue;

                const result = pos.createConstructionSite(STRUCTURE_CONTAINER);
                if (result === OK) {
                    log.info(`Architect: Placed Hatchery Container at ${pos.x},${pos.y}`);
                    budget.count--;
                    return;
                }
            }
        }
    }

    /**
     * Destroy hatchery containers once Storage is built (RCL 4+).
     * They are redundant and may block BunkerLayout structure placement.
     */
    private cleanupHatcheryContainer(): void {
        const room = this.colony.room;
        if (!room) return;

        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        const spawn = spawns[0];
        const controller = room.controller;

        const hatchContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        }).filter(c => {
            const nearSource = c.pos.findInRange(FIND_SOURCES, 2).length > 0;
            const nearCtrl = controller && c.pos.getRangeTo(controller) <= 3;
            return !nearSource && !nearCtrl;
        });

        for (const c of hatchContainers) {
            log.info(`Architect: Destroying obsolete Hatchery Container at ${c.pos.x},${c.pos.y} (Storage built)`);
            c.destroy();
        }
    }
}
