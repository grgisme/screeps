/**
 * RoomPosition prototype extensions.
 *
 * These are applied once on global reset and provide utility methods
 * available on all RoomPosition instances throughout the codebase.
 */

// Extend the RoomPosition prototype with helper methods
declare global {
    interface RoomPosition {
        /** Get all walkable positions in range */
        getWalkableInRange(range: number): RoomPosition[];
        /** Get Manhattan distance to another position */
        manhattanDistance(pos: RoomPosition): number;
        /** Check if this position is an exit tile */
        isExit(): boolean;
    }
}

RoomPosition.prototype.getWalkableInRange = function (range: number): RoomPosition[] {
    const positions: RoomPosition[] = [];
    const terrain = Game.map.getRoomTerrain(this.roomName);

    for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
            const x = this.x + dx;
            const y = this.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                positions.push(new RoomPosition(x, y, this.roomName));
            }
        }
    }

    return positions;
};

RoomPosition.prototype.manhattanDistance = function (pos: RoomPosition): number {
    if (this.roomName !== pos.roomName) return Infinity;
    return Math.abs(this.x - pos.x) + Math.abs(this.y - pos.y);
};

RoomPosition.prototype.isExit = function (): boolean {
    return this.x === 0 || this.x === 49 || this.y === 0 || this.y === 49;
};

// Export to signal that prototypes have been applied
export const prototypesLoaded = true;
