import { Colony } from "./Colony";


export class MiningSite {
    colony: Colony;
    source: Source;
    container: StructureContainer | undefined;
    link: StructureLink | undefined;
    containerPos: RoomPosition | undefined;
    linkPos: RoomPosition | undefined;

    // Cached path length to storage/spawn
    distance: number = 0;

    constructor(colony: Colony, source: Source) {
        this.colony = colony;
        this.source = source;
        this.refresh();
    }

    refresh(): void {
        const freshSource = Game.getObjectById(this.source.id) as Source;
        if (freshSource) this.source = freshSource;
        // else keep existing source object (for tests or missing visibility)
        // Re-acquire structures
        if (this.containerPos) {
            this.container = this.containerPos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer;
            this.link = this.linkPos ? this.linkPos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_LINK) as StructureLink : undefined;
        } else {
            this.calculateContainerPos();
        }

        // 3. Ensure Container Site exists (Static Mining Alignment)
        if (this.containerPos && !this.container) {
            const site = this.containerPos.lookFor(LOOK_CONSTRUCTION_SITES).find(s => s.structureType === STRUCTURE_CONTAINER);
            if (!site) {
                this.containerPos.createConstructionSite(STRUCTURE_CONTAINER);
                console.log(`MiningSite: Placing container site at ${this.containerPos.x}, ${this.containerPos.y}`);
            }
        }

        if (this.distance === 0) {
            this.calculateDistance();
        }
    }

    private calculateContainerPos(): void {
        const dropoff = this.colony.room.storage || this.colony.room.find(FIND_MY_SPAWNS)[0];
        if (!dropoff) return;

        const path = PathFinder.search(this.source.pos, { pos: dropoff.pos, range: 1 }, {
            plainCost: 2,
            swampCost: 10,
            roomCallback: (roomName) => {
                const room = Game.rooms[roomName];
                if (!room) return false;
                const costMatrix = new PathFinder.CostMatrix();
                // Avoid walls, but don't treat creeps as blockers for static analysis
                room.find(FIND_STRUCTURES).forEach(s => {
                    if (s.structureType === STRUCTURE_WALL) {
                        costMatrix.set(s.pos.x, s.pos.y, 255);
                    }
                });
                return costMatrix;
            }
        });

        if (path.path.length > 0) {
            // The first step away from the source is usually a good container spot if it's not a wall
            // Actually, we want a spot adjacent to the source that is closest to the storage.
            // PathFinder path[0] is the first step *towards* the target.
            this.containerPos = path.path[0];
        }
    }

    private calculateDistance(): void {
        const dropoff = this.colony.room.storage || this.colony.room.find(FIND_MY_SPAWNS)[0];
        if (!dropoff || !this.containerPos) return;

        // Use cached path calculation if possible, but for now simple range or path length
        // We precise path length for hauling calculations
        const path = PathFinder.search(this.containerPos, { pos: dropoff.pos, range: 1 });
        this.distance = path.path.length;
    }

    /**
     * Calculate required hauling power in carry parts * ticks
     * Formula: (EnergyPerTick * 2 * Distance)
     */
    calculateHaulingPowerNeeded(): number {
        if (!this.containerPos) return 0; // Not established yet

        // EnergyPerTick: 10 for reserved (Source Keeper or Owned), 5 for Unreserved.
        // For now, assume owned room (10) or check reservation.
        // TODO: specific reservation check for remote rooms.
        const energyPerTick = (this.colony.room.controller && (this.colony.room.controller.my || this.colony.room.controller.reservation)) ? 10 : 5;

        return energyPerTick * 2 * this.distance;
    }
}
