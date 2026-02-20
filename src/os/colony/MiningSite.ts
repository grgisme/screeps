// ============================================================================
// MiningSite — Represents a single Source and its mining infrastructure
// ============================================================================
//
// ⚠️ GETTER PATTERN (V8 MEMORY LEAK PREVENTION)
// ══════════════════════════════════════════════
// MiningSite persists in the Global Heap (owned by MiningOverlord).
// NEVER cache live Source, Container, or Link objects. Store IDs only.
// ============================================================================

import type { Colony } from "./Colony";
import { Logger } from "../../utils/Logger";

const log = new Logger("MiningSite");

export class MiningSite {
    colony: Colony;

    // ── Stored IDs only — never live Game objects ──────────────────────
    readonly sourceId: Id<Source>;
    containerId?: Id<StructureContainer>;
    linkId?: Id<StructureLink>;

    /** Calculated position for the container (safe to store — it's coords + room string). */
    containerPos: RoomPosition | undefined;
    linkPos: RoomPosition | undefined;

    /** Cached path length to storage/spawn. */
    distance: number = 0;

    /**
     * Route terrain analysis (cached in heap — calculated once).
     * roadCoverage: 0.0–1.0 ratio of road tiles along the hauling route.
     * hasSwamp: true if any non-road swamp tile exists on the route.
     */
    roadCoverage: number = -1; // -1 = not yet calculated
    hasSwamp: boolean = false;

    /** First scan flag — ensures container detection runs immediately after reset */
    private _scanned = false;

    constructor(colony: Colony, sourceId: Id<Source>) {
        this.colony = colony;
        this.sourceId = sourceId;

        // Calculate container position immediately (one-time expensive op)
        this.calculateContainerPos();
        this.calculateDistance();
    }

    // -----------------------------------------------------------------------
    // Getters — resolve live Game objects each tick (no heap leak)
    // -----------------------------------------------------------------------

    /** Resolve the live Source from Game. Returns null if not visible. */
    get source(): Source | null {
        return Game.getObjectById(this.sourceId);
    }

    /** Resolve the live Container from its cached ID. */
    get container(): StructureContainer | null {
        return this.containerId ? Game.getObjectById(this.containerId) : null;
    }

    /** Resolve the live Link from its cached ID. */
    get link(): StructureLink | null {
        return this.linkId ? Game.getObjectById(this.linkId) : null;
    }

    // -----------------------------------------------------------------------
    // Throttled Structure Discovery — runs every 50 ticks
    // -----------------------------------------------------------------------

    /**
     * Discover built containers/links and place construction sites.
     * Throttled to once every 50 ticks to avoid CPU bombs from lookFor.
     */
    refreshStructureIds(): void {
        // Always run first scan immediately; then throttle to every 50 ticks
        if (this._scanned && Game.time % 50 !== 0) return;
        this._scanned = true;

        // Recalculate container position every refresh — roads may have changed the path
        this.calculateContainerPos();

        // 1. Validate existing container is at the optimal position
        //    (path may have changed after roads were built)
        if (this.containerId && this.containerPos) {
            const existing = this.container;
            if (existing && !existing.pos.isEqualTo(this.containerPos)) {
                log.info(`Container ${this.containerId.slice(-4)} at ${existing.pos.x},${existing.pos.y} is misplaced (should be ${this.containerPos.x},${this.containerPos.y}) — destroying`);
                existing.destroy();
                this.containerId = undefined;
            }
        }

        // 2. Find container at the calculated position
        if (this.containerPos && !this.containerId) {
            const found = this.containerPos
                .lookFor(LOOK_STRUCTURES)
                .find(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer | undefined;
            if (found) {
                this.containerId = found.id;
                log.info(`Discovered container ${found.id.slice(-4)} at site ${this.sourceId.slice(-4)}`);
            } else {
                // Ensure construction site exists
                const site = this.containerPos
                    .lookFor(LOOK_CONSTRUCTION_SITES)
                    .find(s => s.structureType === STRUCTURE_CONTAINER);
                if (!site) {
                    this.containerPos.createConstructionSite(STRUCTURE_CONTAINER);
                    log.info(`Placing container site at ${this.containerPos.x}, ${this.containerPos.y}`);
                }
            }
        }

        // 2. Find link at the calculated position
        if (this.linkPos && !this.linkId) {
            const found = this.linkPos
                .lookFor(LOOK_STRUCTURES)
                .find(s => s.structureType === STRUCTURE_LINK) as StructureLink | undefined;
            if (found) {
                this.linkId = found.id;
                log.info(`Discovered link ${found.id.slice(-4)} at site ${this.sourceId.slice(-4)}`);
            }
        }

        // 3. Re-validate existing IDs (structure may have been destroyed)
        if (this.containerId && !this.container) {
            this.containerId = undefined;
        }
        if (this.linkId && !this.link) {
            this.linkId = undefined;
        }

        // 4. Recalculate distance and route terrain if not yet computed
        if (this.distance === 0) {
            this.calculateDistance();
        }

        // 5. Recalculate route terrain (roads may have been built since last check)
        this.calculateRouteTerrain();
    }

    // -----------------------------------------------------------------------
    // One-time calculations
    // -----------------------------------------------------------------------

    private calculateContainerPos(): void {
        const room = this.colony.room;
        if (!room) return;

        const source = this.source;
        if (!source) return;

        const dropoff = room.storage || room.find(FIND_MY_SPAWNS)[0];
        if (!dropoff) return;

        const path = PathFinder.search(source.pos, { pos: dropoff.pos, range: 1 }, {
            plainCost: 2,
            swampCost: 10,
            roomCallback: (roomName) => {
                const r = Game.rooms[roomName];
                if (!r) return false;
                const costMatrix = new PathFinder.CostMatrix();
                r.find(FIND_STRUCTURES).forEach(s => {
                    if (s.structureType === STRUCTURE_WALL) {
                        costMatrix.set(s.pos.x, s.pos.y, 255);
                    } else if (s.structureType === STRUCTURE_ROAD) {
                        costMatrix.set(s.pos.x, s.pos.y, 1);
                    }
                });
                return costMatrix;
            }
        });

        if (path.path.length > 0) {
            this.containerPos = path.path[0];
        }
    }

    private calculateDistance(): void {
        const room = this.colony.room;
        if (!room) return;

        const dropoff = room.storage || room.find(FIND_MY_SPAWNS)?.[0];
        if (!dropoff || !this.containerPos) return;

        const path = PathFinder.search(this.containerPos, { pos: dropoff.pos, range: 1 });

        // Fallback to a linear distance heuristic if the path is incomplete/blocked
        if (path.incomplete) {
            this.distance = Math.round(this.containerPos.getRangeTo(dropoff.pos) * 1.5);
            if (this.distance === 0) this.distance = 10; // Safe minimum
        } else {
            this.distance = path.path.length;
        }
    }

    /**
     * Analyze terrain composition along the hauling route.
     * Walks the path from containerPos to dropoff and checks each tile
     * for road structures and terrain type.
     *
     * Cached in heap — only recalculates every 50 ticks (during refreshStructureIds)
     * to detect newly built roads without burning CPU every tick.
     */
    private calculateRouteTerrain(): void {
        const room = this.colony.room;
        if (!room || !this.containerPos) return;

        const dropoff = room.storage || room.find(FIND_MY_SPAWNS)?.[0];
        if (!dropoff) return;

        const path = PathFinder.search(this.containerPos, { pos: dropoff.pos, range: 1 });
        if (path.incomplete || path.path.length === 0) {
            this.roadCoverage = 0;
            return;
        }

        const terrain = Game.map.getRoomTerrain(room.name);
        let roadTiles = 0;
        let swampTiles = 0;

        for (const pos of path.path) {
            // Check for road structure at this position
            const hasRoad = pos.lookFor(LOOK_STRUCTURES)
                .some((s: Structure) => s.structureType === STRUCTURE_ROAD);

            if (hasRoad) {
                roadTiles++;
            } else {
                // No road — check raw terrain
                const terrainType = terrain.get(pos.x, pos.y);
                if (terrainType === TERRAIN_MASK_SWAMP) {
                    swampTiles++;
                }
            }
        }

        this.roadCoverage = path.path.length > 0 ? roadTiles / path.path.length : 0;
        this.hasSwamp = swampTiles > 0;
    }

    /**
     * Calculate required hauling power in carry parts * ticks.
     * Formula: (EnergyPerTick * 2 * Distance)
     */
    calculateHaulingPowerNeeded(): number {
        if (!this.containerPos) return 0;

        const room = this.colony.room;
        const energyPerTick = (room?.controller && (room.controller.my || room.controller.reservation)) ? 10 : 5;

        return energyPerTick * 2 * this.distance;
    }

    // -----------------------------------------------------------------------
    // Logistics Integration
    // -----------------------------------------------------------------------

    /**
     * Broadcasts the site's energy to the central Logistics Network.
     * (Called by the local MiningOverlord).
     */
    registerOutputRequests(): void {
        // Links transfer instantly, no haulers needed
        if (this.linkId) return;

        if (this.containerId) {
            const container = this.container;
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.colony.logistics.requestOutput(this.containerId);
            }
        } else {
            // Early game fallback: broadcast dropped energy near source (if visible)
            const source = this.source;
            if (source && Game.rooms[source.pos.roomName]) {
                const dropped = source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)
                    .find(r => r.resourceType === RESOURCE_ENERGY && r.amount > 50);
                if (dropped) {
                    this.colony.logistics.requestOutput(dropped.id as Id<Resource>);
                }
            }
        }
    }
}
