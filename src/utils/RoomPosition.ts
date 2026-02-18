// ============================================================================
// RoomPosition Extensions — O(1) directional position lookup
// ============================================================================

// This file must be an ES module for `declare global` to work.
// The empty export satisfies TypeScript's external module requirement.
export { };

/**
 * Extend the global RoomPosition interface so TypeScript recognizes
 * the prototype extension in all files without explicit casts.
 */
declare global {
    interface RoomPosition {
        getPositionAtDirection(direction: DirectionConstant): RoomPosition | null;
    }
}

/**
 * O(1) direction → delta lookup tables.
 *
 * Screeps DirectionConstants are 1-8 (TOP=1, TOP_RIGHT=2, ... TOP_LEFT=8).
 * Index 0 is unused padding so we can index directly by the constant value
 * without subtracting 1.
 *
 * This replaces 18 boolean comparisons with a single array index,
 * eliminating branch prediction misses in high-frequency pathfinding loops.
 */
//                      _   TOP  TR   R   BR   B   BL   L   TL
const DX: number[] = [0, 0, 1, 1, 1, 0, -1, -1, -1];
const DY: number[] = [0, -1, -1, 0, 1, 1, 1, 0, -1];

RoomPosition.prototype.getPositionAtDirection = function (
    direction: DirectionConstant
): RoomPosition | null {
    const x = this.x + DX[direction];
    const y = this.y + DY[direction];

    // Bounds check: room coordinates are 0-49
    if (x < 0 || x > 49 || y < 0 || y > 49) {
        return null;
    }

    return new RoomPosition(x, y, this.roomName);
};
