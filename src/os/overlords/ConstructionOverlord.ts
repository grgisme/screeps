// ============================================================================
// ConstructionOverlord — The Architect
// Manages room planning (anchor placement) and automated construction.
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { distanceTransform, minCutRamparts } from "../../utils/Algorithms";
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

        // 4. Source Containers — HIGHEST priority at RCL 2+.
        //    Placed before hub/ctrl containers and before extensions because:
        //    source container → miner can top up → transporter can withdraw →
        //    the entire energy pipeline depends on these existing first.
        //    ConstructionOverlord is the sole authority for construction sites;
        //    MiningOverlord never calls createConstructionSite.
        if (rcl >= 2 && budget.count > 0) {
            this.checkSourceContainers(budget);
        }

        // 5. Hub Container (RCL 2+, pre-Link) — filler's energy supply.
        //    Comes before controller container: filler feeds spawn/extensions
        //    directly, so hub container unblocks spawn throughput sooner.
        if (rcl >= 2 && rcl < 5 && budget.count > 0) {
            this.checkHubContainer(budget);
        }

        // 6. Controller Container (RCL 2+)
        if (rcl >= 2 && budget.count > 0) {
            this.checkControllerContainer(budget);
        }

        // 7. Bunker layout (extensions, spawns, towers, …)
        this.checkBunker(anchorPos, rcl, budget);

        // 8. Hub Container → Link swap at RCL 5+
        if (rcl >= 5) {
            this.cleanupHubContainer();
        }

        // 9. Roads (RCL 2+ — after core infrastructure is placed)
        if (rcl >= 2 && budget.count > 0) {
            this.checkRoads(anchorPos, rcl, budget);
        }

        // 9. Hatchery Container Cleanup (RCL 4+ when Storage built)
        //    Destroy legacy hatchery containers so they don't block BunkerLayout structures
        if (this.colony.room?.storage) {
            this.cleanupHatcheryContainer();
        }

        // 10. Min-Cut Ramparts (RCL 4+, compute once and cache)
        if (rcl >= 4 && this.colony.state.rclChanged) {
            this.computeMinCutRamparts(anchorPos);
        }

        // 11. Obsolete Structure Sweep (on RCL change or every 1000 ticks)
        if (this.colony.state.rclChanged || Game.time % 1000 === 0) {
            this.sweepObsoleteStructures(anchorPos, rcl);
        }

        // 12. Reset the RCL changed flag
        this.colony.state.rclChanged = false;
    }

    // ========================================================================
    // Room Planning — Distance Transform anchor placement
    // ========================================================================

    private planRoom(): void {
        const room = this.colony.room;
        if (!room) return;

        const spawns = room.find(FIND_MY_SPAWNS);

        // ── REVERSE-ANCHOR (first-room bootstrap) ──────────────────────────
        // When exactly one spawn exists empire-wide this is the starting room.
        // Derive the anchor by reversing each blueprint spawn offset instead of
        // running a full Distance Transform scan.
        if (spawns.length === 1 && Object.keys(Game.spawns).length === 1) {
            const anchor = this.reverseAnchorFromSpawn(room, spawns[0]);
            if (anchor) {
                log.info(`Reverse-anchor: ${this.colony.name} → ${anchor.x},${anchor.y} (from spawn at ${spawns[0].pos.x},${spawns[0].pos.y})`);
                this.colony.memory.anchor = { x: anchor.x, y: anchor.y };
                return;
            }
            log.warning(`Reverse-anchor: no valid fit in ${this.colony.name}, falling through to DT scan`);
        }

        // ── NORMAL DT SCAN (all future rooms) ──────────────────────────────
        const dt = distanceTransform(this.colony.name);

        // Find the existing spawn for proximity weighting
        const spawnPos = spawns.length > 0 ? spawns[0].pos : null;

        let maxScore = 0;
        let bestPos: { x: number; y: number } | null = null;

        // Scan x:8..41, y:8..41 to ensure the bunker leaves a 2-tile border near exits
        for (let x = 8; x < 42; x++) {
            for (let y = 8; y < 42; y++) {
                const dist = dt.get(x, y);
                if (dist < 6) continue; // Must fit a 13x13 bunker

                // Proximity bonus: prefer positions near the existing spawn
                // Max bonus of 3 points if within range 5; decays linearly
                let proximityBonus = 0;
                if (spawnPos) {
                    const range = Math.max(Math.abs(x - spawnPos.x), Math.abs(y - spawnPos.y));
                    proximityBonus = Math.max(0, 3 - (range * 0.3));
                }

                const score = dist + proximityBonus;
                if (score > maxScore) {
                    maxScore = score;
                    bestPos = { x, y };
                }
            }
        }

        if (bestPos && maxScore >= 6) {
            log.info(`Anchor found at ${bestPos.x},${bestPos.y} (score=${maxScore.toFixed(1)}${spawnPos ? `, spawn at ${spawnPos.x},${spawnPos.y}` : ''})`);
            this.colony.memory.anchor = { x: bestPos.x, y: bestPos.y };
        } else {
            log.warning(`No valid anchor in ${this.colony.name} (maxScore=${maxScore.toFixed(1)})`);
            if (bestPos) {
                this.colony.memory.anchor = { x: bestPos.x, y: bestPos.y };
            }
        }
    }

    /**
     * Reverse-anchor: derive the bunker anchor from an existing spawn position.
     *
     * Scores all blueprint spawn slots (anchor = spawn − offset) by wall-hit
     * count within the 13×13 footprint and in-bounds status.  Returns the
     * best in-bounds candidate (fewest wall hits).  Returns null only when
     * every candidate is out-of-bounds — planRoom() will fall through to the
     * Distance Transform scan in that case.
     */
    private reverseAnchorFromSpawn(room: Room, spawn: StructureSpawn): RoomPosition | null {
        const spawnOffsets = BunkerLayout.structures[STRUCTURE_SPAWN] ?? [];
        if (spawnOffsets.length === 0) return null;

        // Score every spawn slot
        const candidates = spawnOffsets.map(offset => {
            const ax = spawn.pos.x - offset.x;
            const ay = spawn.pos.y - offset.y;
            const score = this.scoreBlueprintFit(room.name, ax, ay);
            return { ax, ay, offset, ...score };
        });

        // Prefer in-bounds, then fewest wall hits
        const inBounds = candidates.filter(c => !c.outOfBounds);
        if (inBounds.length === 0) {
            // Every candidate is out-of-bounds — signal planRoom() to use DT scan
            log.warning(`Reverse-anchor: all ${candidates.length} spawn-slot anchors are out-of-bounds for spawn at (${spawn.pos.x},${spawn.pos.y}) — falling through to DT scan`);
            return null;
        }

        inBounds.sort((a, b) => a.wallHits - b.wallHits);
        const best = inBounds[0];

        if (best.wallHits > 0) {
            log.warning(`Reverse-anchor: best anchor (${best.ax},${best.ay}) has ${best.wallHits} wall conflict(s) — using it anyway`);
        }

        return new RoomPosition(best.ax, best.ay, room.name);
    }

    /**
     * Scores how well a 13×13 bunker centered at (ax, ay) fits the room.
     *
     * - `outOfBounds`: true when the anchor is outside the safe 7-tile border
     *   (ax/ay not in [7,42]).  In this case wallHits is not computed.
     * - `wallHits`: count of wall tiles in the 13×13 footprint (dx/dy ±6).
     *   Zero = perfect fit.
     */
    private scoreBlueprintFit(roomName: string, ax: number, ay: number): { outOfBounds: boolean; wallHits: number } {
        if (ax < 7 || ax > 42 || ay < 7 || ay > 42) {
            return { outOfBounds: true, wallHits: 0 };
        }
        const terrain = Game.map.getRoomTerrain(roomName);
        let wallHits = 0;
        for (let dx = -6; dx <= 6; dx++) {
            for (let dy = -6; dy <= 6; dy++) {
                if (terrain.get(ax + dx, ay + dy) === TERRAIN_MASK_WALL) wallHits++;
            }
        }
        return { outOfBounds: false, wallHits };
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
                const ax = anchorPos.x + rel.x;
                const ay = anchorPos.y + rel.y;
                if (ax < 1 || ax > 48 || ay < 1 || ay > 48) continue;
                const pos = BunkerLayout.getPos(anchorPos, rel);

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

        // Obsolete structures — red ✕ markers
        const obsoleteIds = ((this.colony.memory as any).obsoleteStructures || []) as string[];
        for (const id of obsoleteIds) {
            const s = Game.getObjectById(id as Id<Structure>);
            if (!s) continue;
            visual.circle(s.pos.x, s.pos.y, { radius: 0.5, fill: '#ff0000', opacity: 0.3, stroke: '#ff0000', strokeWidth: 0.15 });
            visual.text('✕', s.pos.x, s.pos.y + 0.15, { font: 0.5, color: '#ff0000', opacity: 0.9 });
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

        // Sort structural placement by absolute priority.
        // Containers intentionally rank above extensions: source/hub containers
        // unlock the energy pipeline before the colony can use more extensions.
        const BUILD_PRIORITY: Partial<Record<StructureConstant, number>> = {
            [STRUCTURE_SPAWN]: 1,
            [STRUCTURE_TOWER]: 2,
            [STRUCTURE_CONTAINER]: 3,
            [STRUCTURE_EXTENSION]: 4,
            [STRUCTURE_STORAGE]: 5,
            [STRUCTURE_TERMINAL]: 6,
            [STRUCTURE_LINK]: 7,
            [STRUCTURE_LAB]: 8,
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

            // Extensions are pre-sorted in BunkerLayout: filler ring first,
            // then by Chebyshev distance from Storage (floodfill ordering).
            // No additional sorting needed.
            let sortedPositions = positions;

            // Slice to respect the exact RCL limit
            const allowedPositions = sortedPositions.slice(0, maxAllowed);

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
        if (rcl < 2) return;
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
     * Place a container adjacent to each energy source (range 1-2).
     *
     * This is the HIGHEST priority container at RCL 2 because the source
     * container is the foundation of the drop-mining energy pipeline:
     *   miner drops on container → transporter withdraws → fills spawn/extensions
     *
     * Tile selection: PathFind from anchor toward source, pick the first tile
     * on that path within range 2 of the source. This places the container
     * exactly on the hauler's natural route — no wasted travel for either miner
     * or transporter.
     *
     * Skips sources that already have a container or site within range 2.
     * ConstructionOverlord is the sole authority for construction sites —
     * MiningOverlord never calls createConstructionSite.
     */
    private checkSourceContainers(budget: { count: number }): void {
        const room = this.colony.room;
        if (!room) return;

        const anchor = this.colony.memory.anchor;
        const anchorPos = anchor
            ? new RoomPosition(anchor.x, anchor.y, room.name)
            : room.find(FIND_MY_SPAWNS)?.[0]?.pos;
        if (!anchorPos) return;

        const sources = room.find(FIND_SOURCES);

        for (const source of sources) {
            if (budget.count <= 0) return;

            // Skip if a container already exists within range 2
            const nearbyContainer = source.pos.findInRange(FIND_STRUCTURES, 2, {
                filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
            });
            if (nearbyContainer.length > 0) continue;

            // Skip if a construction site already exists within range 2
            const nearbyCSite = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
                filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
            });
            if (nearbyCSite.length > 0) continue;

            // PathFind from anchor toward source — tile on hauler route
            const path = PathFinder.search(anchorPos, { pos: source.pos, range: 1 }, {
                plainCost: 2,
                swampCost: 5,
                roomCallback: (roomName) => {
                    if (roomName !== room.name) return false;
                    const cm = new PathFinder.CostMatrix();
                    room.find(FIND_STRUCTURES).forEach(s => {
                        if (s.structureType === STRUCTURE_ROAD) {
                            cm.set(s.pos.x, s.pos.y, 1);
                        } else if (s.structureType !== STRUCTURE_CONTAINER &&
                            s.structureType !== STRUCTURE_RAMPART) {
                            cm.set(s.pos.x, s.pos.y, 255);
                        }
                    });
                    return cm;
                }
            });

            // Walk backwards from source end of path — pick last tile within range 2
            let placed = false;
            for (let i = path.path.length - 1; i >= 0; i--) {
                const pos = path.path[i];
                if (pos.getRangeTo(source.pos) > 2) continue;
                if (pos.getRangeTo(source.pos) < 1) continue;

                // Verify walkable and unblocked
                const terrain = Game.map.getRoomTerrain(room.name).get(pos.x, pos.y);
                if (terrain === TERRAIN_MASK_WALL) continue;

                const blocked = pos.lookFor(LOOK_STRUCTURES)
                    .some((s: Structure) => s.structureType !== STRUCTURE_ROAD &&
                        s.structureType !== STRUCTURE_RAMPART);
                if (blocked) continue;

                const alreadySite = pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0;
                if (alreadySite) continue;

                const result = pos.createConstructionSite(STRUCTURE_CONTAINER);
                if (result === OK) {
                    log.info(`Architect: Placed Source Container at ${pos.x},${pos.y} (range ${pos.getRangeTo(source.pos)} from source ${source.id})`);
                    budget.count--;
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                log.warning(`Architect: Could not place Source Container near source ${source.id} at ${source.pos.x},${source.pos.y}`);
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
     * Place a Hub Container at BunkerLayout.hubPos (0,1).
     * Acts as the Fast Filler's energy hub until the Hub Link is built at RCL 5.
     * Filler at standing tile (0,0) is adjacent to this position within range 1.
     * Skipped once Link exists at this position.
     */
    private checkHubContainer(budget: { count: number }): void {
        const room = this.colony.room;
        if (!room) return;

        const anchor = this.colony.memory.anchor;
        if (!anchor) return;

        // Target position: hub tile (BunkerLayout.hubPos offset from anchor)
        const hubCoord = BunkerLayout.hubPos;
        const hubPos = new RoomPosition(anchor.x + hubCoord.x, anchor.y + hubCoord.y, room.name);

        // Skip if a Link already exists here (RCL 5+ upgrade complete)
        const hasLink = hubPos.lookFor(LOOK_STRUCTURES)
            .some(s => s.structureType === STRUCTURE_LINK);
        if (hasLink) return;

        // Check if container already exists at this position
        const existingContainer = hubPos.lookFor(LOOK_STRUCTURES)
            .some(s => s.structureType === STRUCTURE_CONTAINER);
        if (existingContainer) return;

        // Check if construction site already exists
        const existingSite = hubPos.lookFor(LOOK_CONSTRUCTION_SITES)
            .some(s => s.structureType === STRUCTURE_CONTAINER);
        if (existingSite) return;

        // Check terrain is walkable
        const terrain = Game.map.getRoomTerrain(room.name).get(hubPos.x, hubPos.y);
        if (terrain === TERRAIN_MASK_WALL) {
            log.warn(`Cannot place Hub Container at ${hubPos.x},${hubPos.y} — wall tile!`);
            return;
        }

        // Check not blocked by another structure
        const blocked = hubPos.lookFor(LOOK_STRUCTURES)
            .some((s: Structure) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART);
        if (blocked) return;

        const result = hubPos.createConstructionSite(STRUCTURE_CONTAINER);
        if (result === OK) {
            log.info(`Architect: Placed Hub Container at ${hubPos.x},${hubPos.y}`);
            budget.count--;
        }
    }

    /**
     * Destroy the Hub Container once the Hub Link is built (RCL 5+).
     * The container at hubPos becomes redundant when the link takes its place.
     */
    private cleanupHubContainer(): void {
        const room = this.colony.room;
        if (!room) return;

        const anchor = this.colony.memory.anchor;
        if (!anchor) return;

        const hubCoord = BunkerLayout.hubPos;
        const hubPos = new RoomPosition(anchor.x + hubCoord.x, anchor.y + hubCoord.y, room.name);

        // Only cleanup if the link is actually built
        const hasLink = hubPos.lookFor(LOOK_STRUCTURES)
            .some(s => s.structureType === STRUCTURE_LINK);
        if (!hasLink) return;

        const containers = hubPos.lookFor(LOOK_STRUCTURES)
            .filter(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
        for (const c of containers) {
            log.info(`Architect: Destroying Hub Container at ${c.pos.x},${c.pos.y} (Link built)`);
            c.destroy();
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

    // ========================================================================
    // Obsolete Structure Detection — Blueprint Validation Sweep
    // ========================================================================

    /**
     * Compare room structures against BunkerLayout blueprint.
     * Any structure at a bunker position that doesn't match the expected type
     * is flagged as obsolete. IDs stored in colony memory for workers to dismantle.
     *
     * Runs on RCL change or every 1000 ticks (low frequency to save CPU).
     */
    private sweepObsoleteStructures(anchor: RoomPosition, _rcl: number): void {
        const room = this.colony.room;
        if (!room) return;

        const obsoleteIds: string[] = [];
        const layoutStructures = BunkerLayout.structures as Partial<Record<StructureConstant, any[]>>;

        // Safety: count spawns so we never flag the last one
        const spawnCount = room.find(FIND_MY_SPAWNS).length;

        // Build a map of expected positions: "x,y" → Set of expected structure types
        const expectedAt = new Map<string, Set<StructureConstant>>();
        for (const type of Object.keys(layoutStructures) as StructureConstant[]) {
            const coords = layoutStructures[type] || [];
            for (const rel of coords) {
                const ax = anchor.x + rel.x;
                const ay = anchor.y + rel.y;
                if (ax < 0 || ax > 49 || ay < 0 || ay > 49) continue;
                const pos = BunkerLayout.getPos(anchor, rel);
                const key = `${pos.x},${pos.y}`;
                if (!expectedAt.has(key)) expectedAt.set(key, new Set());
                expectedAt.get(key)!.add(type);
            }
        }

        // Hub container is expected at hubPos for RCL 2-4
        {
            const hubCoord = BunkerLayout.hubPos;
            const hax = anchor.x + hubCoord.x;
            const hay = anchor.y + hubCoord.y;
            if (hax >= 0 && hax <= 49 && hay >= 0 && hay <= 49) {
                const hubAbsPos = BunkerLayout.getPos(anchor, hubCoord);
                const hubKey = `${hubAbsPos.x},${hubAbsPos.y}`;
                if (!expectedAt.has(hubKey)) expectedAt.set(hubKey, new Set());
                expectedAt.get(hubKey)!.add(STRUCTURE_CONTAINER);
            }
        }

        // Scan all structures in the room
        for (const s of room.find(FIND_STRUCTURES)) {
            // Skip structures we don't manage
            if (s.structureType === STRUCTURE_CONTROLLER) continue;
            if (s.structureType === STRUCTURE_WALL) continue;
            if (s.structureType === STRUCTURE_CONTAINER) continue; // Managed separately
            if (s.structureType === STRUCTURE_ROAD) continue;      // Roads are stackable, don't dismantle
            if (s.structureType === STRUCTURE_RAMPART) continue;    // Ramparts are defensive, don't dismantle

            // Only check our own structures
            if ('my' in s && !(s as OwnedStructure).my) continue;

            const key = `${s.pos.x},${s.pos.y}`;
            const expected = expectedAt.get(key);

            if (!expected || !expected.has(s.structureType)) {
                // SAFETY: Never flag the last spawn — colony dies without it
                if (s.structureType === STRUCTURE_SPAWN && spawnCount <= 1) {
                    log.warn(`Skipping obsolete spawn at ${s.pos.x},${s.pos.y} — it's the only spawn!`);
                    continue;
                }

                // This structure's type is NOT expected at this position per the blueprint
                obsoleteIds.push(s.id);
                log.info(`Obsolete: ${s.structureType} at ${s.pos.x},${s.pos.y} — not in blueprint`);
            }
        }

        // Store in colony memory for workers to pick up
        (this.colony.memory as any).obsoleteStructures = obsoleteIds;

        if (obsoleteIds.length > 0) {
            log.info(`Blueprint sweep: ${obsoleteIds.length} obsolete structure(s) flagged for dismantling`);
        }
    }

    // ========================================================================
    // Min-Cut Rampart Computation — cached in colony memory
    // ========================================================================

    /**
     * Compute the min-cut rampart positions using Edmonds-Karp.
     * Result is cached in colony memory and only recomputed on RCL change.
     * Updates BunkerLayout.structures[STRUCTURE_RAMPART] with the result,
     * keeping core protection ramparts and adding the perimeter cut.
     */
    private computeMinCutRamparts(anchor: RoomPosition): void {
        const room = this.colony.room;
        if (!room) return;

        // Collect all protected positions (absolute coordinates)
        const layoutStructures = BunkerLayout.structures as Partial<Record<StructureConstant, any[]>>;
        const protectedPositions: Array<{ x: number; y: number }> = [];

        for (const [typeStr, positions] of Object.entries(layoutStructures)) {
            if (typeStr === STRUCTURE_RAMPART || typeStr === STRUCTURE_ROAD) continue;
            for (const rel of positions as Array<{ x: number; y: number }>) {
                const ax = anchor.x + rel.x;
                const ay = anchor.y + rel.y;
                if (ax < 0 || ax > 49 || ay < 0 || ay > 49) continue;
                const pos = BunkerLayout.getPos(anchor, rel);
                protectedPositions.push({ x: pos.x, y: pos.y });
            }
        }

        // Add center standing tile
        const centerPos = BunkerLayout.getPos(anchor, BunkerLayout.centerTile);
        protectedPositions.push({ x: centerPos.x, y: centerPos.y });

        const result = minCutRamparts(this.colony.name, protectedPositions, 3);

        // Cache as relative coordinates in colony memory
        const relativeRamparts = result.ramparts.map(r => ({
            x: r.x - anchor.x,
            y: r.y - anchor.y
        }));

        (this.colony.memory as any).minCutRamparts = relativeRamparts;
        log.info(`Min-Cut: Computed ${relativeRamparts.length} rampart positions`);
    }
}
