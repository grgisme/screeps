/**
 * RoomPlanner — Automated base layout planning.
 *
 * Uses the Distance Transform to find optimal bunker placement,
 * validates the BunkerStamp against terrain, plans roads from
 * the bunker center to Sources and Controller, and provides
 * a visual debugging overlay.
 *
 * Usage (console):
 *   Planner.visualize('W1N1')   — DT heatmap + ghost structures
 *   Planner.anchor('W1N1')      — Show/recalculate bunker anchor
 *   Planner.plan('W1N1')        — Get planned structures for current RCL
 */
import { getDistanceTransform, findMaxDistance, drawDistanceTransformHeatmap } from "../utils/DistanceTransform";
import { BUNKER_STAMP, StampEntry, getStampForRCL, getStampRadius } from "./BunkerStamp";
import { heap } from "../os/Heap";

// ─── TYPES ─────────────────────────────────────────────────────────

export interface PlannedStructure {
    x: number;
    y: number;
    structureType: BuildableStructureConstant;
    minRCL: number;
}

export interface PlannedRoad {
    x: number;
    y: number;
    roomName: string;
}

interface AnchorData {
    x: number;
    y: number;
    distance: number;
}

// ─── ROOM PLANNER ──────────────────────────────────────────────────

class RoomPlannerImpl {
    // ─── ANCHOR MANAGEMENT ─────────────────────────────────────────

    /**
     * Get the bunker anchor for a room.
     * Cached in heap.persistent so it survives global resets.
     */
    getAnchor(roomName: string): AnchorData | null {
        // Check persistent cache first
        const cached = heap.getPersistent('planner', `anchor-${roomName}`);
        if (cached) return cached as AnchorData;

        // Calculate anchor
        const anchor = this.calculateAnchor(roomName);
        if (anchor) {
            heap.setPersistent('planner', `anchor-${roomName}`, anchor);
        }
        return anchor;
    }

    /**
     * Force recalculate the anchor for a room.
     */
    recalculateAnchor(roomName: string): AnchorData | null {
        const anchor = this.calculateAnchor(roomName);
        if (anchor) {
            heap.setPersistent('planner', `anchor-${roomName}`, anchor);
        }
        return anchor;
    }

    /**
     * Calculate the optimal bunker anchor using the Distance Transform.
     * Finds the tile with max DT value (center of largest open area),
     * tie-breaking by proximity to the controller.
     */
    private calculateAnchor(roomName: string): AnchorData | null {
        const room = Game.rooms[roomName];
        if (!room) return null;

        const tiebreakPos = room.controller?.pos;
        const result = findMaxDistance(roomName, tiebreakPos);
        const stampRadius = getStampRadius();

        // Verify the anchor has enough clearance for the stamp
        if (result.distance < stampRadius) {
            console.log(`⚠️ PLANNER ${roomName}: Best DT=${result.distance}, need ${stampRadius}. Trying anyway.`);
        }

        // Validate that the stamp fits at this anchor
        if (!this.validateStamp(roomName, result.x, result.y)) {
            // Try nearby positions
            const dt = getDistanceTransform(roomName);
            let bestX = result.x, bestY = result.y;
            let bestDist = 0;

            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    const nx = result.x + dx;
                    const ny = result.y + dy;
                    if (nx < 6 || nx > 43 || ny < 6 || ny > 43) continue;
                    const d = dt[ny * 50 + nx];
                    if (d > bestDist && this.validateStamp(roomName, nx, ny)) {
                        bestDist = d;
                        bestX = nx;
                        bestY = ny;
                    }
                }
            }

            if (bestDist === 0) {
                console.log(`❌ PLANNER ${roomName}: No valid anchor found!`);
                return null;
            }

            return { x: bestX, y: bestY, distance: bestDist };
        }

        return result;
    }

    // ─── STAMP VALIDATION ──────────────────────────────────────────

    /**
     * Check if the BunkerStamp can be placed at (anchorX, anchorY)
     * without any structure landing on a wall tile.
     */
    validateStamp(roomName: string, anchorX: number, anchorY: number): boolean {
        const terrain = Game.map.getRoomTerrain(roomName);

        for (const entry of BUNKER_STAMP) {
            const x = anchorX + entry.dx;
            const y = anchorY + entry.dy;

            // Out of bounds
            if (x < 1 || x > 48 || y < 1 || y > 48) return false;

            // On a wall
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;
        }

        return true;
    }

    // ─── PLANNED STRUCTURES ────────────────────────────────────────

    /**
     * Get all planned structures for a room at the given RCL.
     * Returns world-coordinate positions (anchor + offset).
     */
    getPlannedStructures(roomName: string, rcl: number): PlannedStructure[] {
        const anchor = this.getAnchor(roomName);
        if (!anchor) return [];

        const stamp = getStampForRCL(rcl);
        return stamp.map(entry => ({
            x: anchor.x + entry.dx,
            y: anchor.y + entry.dy,
            structureType: entry.structureType,
            minRCL: entry.minRCL,
        }));
    }

    /**
     * Get structures that need to be built (not yet built and no construction site).
     */
    getMissingStructures(roomName: string, rcl: number): PlannedStructure[] {
        const room = Game.rooms[roomName];
        if (!room) return [];

        const planned = this.getPlannedStructures(roomName, rcl);
        const existing = room.find(FIND_STRUCTURES);
        const sites = room.find(FIND_CONSTRUCTION_SITES);

        // Build lookup sets
        const builtSet = new Set<string>();
        for (const s of existing) {
            builtSet.add(`${s.pos.x}:${s.pos.y}:${s.structureType}`);
        }
        for (const s of sites) {
            builtSet.add(`${s.pos.x}:${s.pos.y}:${s.structureType}`);
        }

        return planned.filter(p => !builtSet.has(`${p.x}:${p.y}:${p.structureType}`));
    }

    // ─── ROAD PLANNING ─────────────────────────────────────────────

    /**
     * Plan roads from the bunker center to all Sources and the Controller.
     * Uses PathFinder.search for optimal paths, deduplicating overlaps.
     */
    planRoads(roomName: string): PlannedRoad[] {
        const room = Game.rooms[roomName];
        if (!room) return [];

        const anchor = this.getAnchor(roomName);
        if (!anchor) return [];

        const anchorPos = new RoomPosition(anchor.x, anchor.y, roomName);
        const roadSet = new Set<string>();
        const roads: PlannedRoad[] = [];

        // Targets: Sources + Controller
        const targets: RoomPosition[] = [];
        const sources = room.find(FIND_SOURCES);
        for (const source of sources) {
            targets.push(source.pos);
        }
        if (room.controller) {
            targets.push(room.controller.pos);
        }

        // Path from anchor to each target
        for (const target of targets) {
            const result = PathFinder.search(
                anchorPos,
                { pos: target, range: 1 },
                {
                    plainCost: 2,
                    swampCost: 3, // Roads negate swamps
                    roomCallback: (rn) => {
                        if (rn !== roomName) return false;
                        const r = Game.rooms[rn];
                        if (!r) return false;

                        const costs = new PathFinder.CostMatrix();
                        const structs = r.find(FIND_STRUCTURES);
                        for (const s of structs) {
                            if (s.structureType === STRUCTURE_ROAD) {
                                costs.set(s.pos.x, s.pos.y, 1);
                            } else if (
                                s.structureType !== STRUCTURE_CONTAINER &&
                                s.structureType !== STRUCTURE_RAMPART
                            ) {
                                costs.set(s.pos.x, s.pos.y, 255);
                            }
                        }
                        return costs;
                    },
                }
            );

            for (const step of result.path) {
                const key = `${step.x}:${step.y}`;
                if (!roadSet.has(key)) {
                    roadSet.add(key);
                    roads.push({ x: step.x, y: step.y, roomName });
                }
            }
        }

        return roads;
    }

    /**
     * Get road positions that still need construction sites.
     */
    getMissingRoads(roomName: string): PlannedRoad[] {
        const room = Game.rooms[roomName];
        if (!room) return [];

        const allRoads = this.planRoads(roomName);

        // Build lookup for existing roads and sites
        const existingSet = new Set<string>();
        const structs = room.find(FIND_STRUCTURES);
        for (const s of structs) {
            if (s.structureType === STRUCTURE_ROAD) {
                existingSet.add(`${s.pos.x}:${s.pos.y}`);
            }
        }
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        for (const s of sites) {
            if (s.structureType === STRUCTURE_ROAD) {
                existingSet.add(`${s.pos.x}:${s.pos.y}`);
            }
        }

        return allRoads.filter(r => !existingSet.has(`${r.x}:${r.y}`));
    }

    // ─── VISUALIZATION ─────────────────────────────────────────────

    /**
     * Draw the complete plan overlay:
     *   1. Distance Transform heatmap
     *   2. Bunker anchor marker
     *   3. Ghost structures (planned but not built)
     *   4. Planned roads
     */
    visualize(roomName: string): string {
        const room = Game.rooms[roomName];
        if (!room) return `❌ No vision in ${roomName}`;

        const visual = new RoomVisual(roomName);
        const rcl = room.controller?.level || 0;

        // 1. DT Heatmap
        drawDistanceTransformHeatmap(roomName);

        // 2. Anchor
        const anchor = this.getAnchor(roomName);
        if (!anchor) return `❌ No valid anchor for ${roomName}`;

        visual.circle(anchor.x, anchor.y, {
            radius: 0.5,
            fill: '#ffff00',
            opacity: 0.8,
            stroke: '#ff8800',
            strokeWidth: 0.1,
        });
        visual.text('⚓', anchor.x, anchor.y + 0.15, {
            font: 0.6,
            opacity: 0.9,
        });
        visual.text(`DT=${anchor.distance}`, anchor.x, anchor.y + 0.7, {
            font: 0.3,
            color: '#ffff00',
            opacity: 0.7,
        });

        // 3. Ghost structures (up to RCL 8 for full preview)
        const allPlanned = this.getPlannedStructures(roomName, 8);
        const structColors: { [type: string]: string } = {
            [STRUCTURE_SPAWN]: '#ff4444',
            [STRUCTURE_EXTENSION]: '#ffaa00',
            [STRUCTURE_TOWER]: '#ff00ff',
            [STRUCTURE_STORAGE]: '#00ffff',
            [STRUCTURE_LINK]: '#44ff44',
            [STRUCTURE_TERMINAL]: '#ff8844',
            [STRUCTURE_LAB]: '#8844ff',
            [STRUCTURE_OBSERVER]: '#ffffff',
            [STRUCTURE_FACTORY]: '#888888',
            [STRUCTURE_NUKER]: '#ff0000',
            [STRUCTURE_POWER_SPAWN]: '#ffff00',
            [STRUCTURE_ROAD]: '#666666',
        };

        const structSymbols: { [type: string]: string } = {
            [STRUCTURE_SPAWN]: '🏠',
            [STRUCTURE_EXTENSION]: '◆',
            [STRUCTURE_TOWER]: '🗼',
            [STRUCTURE_STORAGE]: '📦',
            [STRUCTURE_LINK]: '🔗',
            [STRUCTURE_TERMINAL]: '💱',
            [STRUCTURE_LAB]: '🧪',
            [STRUCTURE_OBSERVER]: '👁',
            [STRUCTURE_FACTORY]: '🏭',
            [STRUCTURE_NUKER]: '☢',
            [STRUCTURE_POWER_SPAWN]: '⚡',
            [STRUCTURE_ROAD]: '·',
        };

        for (const p of allPlanned) {
            const color = structColors[p.structureType] || '#ffffff';
            const built = p.minRCL <= rcl;
            const opacity = built ? 0.7 : 0.3;

            if (p.structureType === STRUCTURE_ROAD) {
                visual.circle(p.x, p.y, {
                    radius: 0.15,
                    fill: color,
                    opacity: opacity * 0.5,
                });
            } else {
                visual.rect(p.x - 0.4, p.y - 0.4, 0.8, 0.8, {
                    fill: color,
                    opacity: opacity * 0.4,
                    stroke: color,
                    strokeWidth: built ? 0.08 : 0.04,
                });

                const symbol = structSymbols[p.structureType] || '?';
                visual.text(symbol, p.x, p.y + 0.1, {
                    font: 0.3,
                    opacity,
                });
            }

            // RCL label on non-road structures
            if (p.structureType !== STRUCTURE_ROAD) {
                visual.text(`${p.minRCL}`, p.x + 0.3, p.y - 0.25, {
                    font: 0.2,
                    color: '#ffffff',
                    opacity: 0.5,
                });
            }
        }

        // 4. Planned roads
        const roads = this.planRoads(roomName);
        for (const road of roads) {
            visual.circle(road.x, road.y, {
                radius: 0.1,
                fill: '#666666',
                opacity: 0.3,
            });
        }

        return `✅ Visualized ${allPlanned.length} structures + ${roads.length} road tiles for ${roomName} (anchor: ${anchor.x},${anchor.y} DT=${anchor.distance})`;
    }
}

/** Global singleton */
export const roomPlanner = new RoomPlannerImpl();
