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
        if (Game.time % 50 !== 0) return;

        // If we failed to calculate a position previously (e.g. no spawn existed yet), retry!
        if (!this.containerPos) {
            this.calculateContainerPos();
        }

        // 1. Find container at the calculated position
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

        // 4. Recalculate distance if not yet computed
        if (this.distance === 0) {
            this.calculateDistance();
        }
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
