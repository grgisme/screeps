// ============================================================================
// RoomPosition Utilities — O(1) directional position lookup
// ============================================================================

/**
 * O(1) direction → delta lookup tables.
 *
 * Screeps DirectionConstants are 1-8 (TOP=1, TOP_RIGHT=2, ... TOP_LEFT=8).
 * Index 0 is unused padding so we can index directly by the constant value.
 */
const DX: number[] = [0, 0, 1, 1, 1, 0, -1, -1, -1];
const DY: number[] = [0, -1, -1, 0, 1, 1, 1, 0, -1];

/**
 * Safely gets the RoomPosition one step in the given direction.
 * Returns null if the result would be out of room bounds (0-49).
 * Replaces fragile prototype extensions which can be lost during V8 isolate 
 * recycling or Rollup tree-shaking.
 */
export function getPositionAtDirection(pos: RoomPosition, direction: DirectionConstant): RoomPosition | null {
    const x = pos.x + DX[direction as number];
    const y = pos.y + DY[direction as number];

    // Bounds check: room coordinates are 0-49
    if (x < 0 || x > 49 || y < 0 || y > 49) {
        return null;
    }

    return new RoomPosition(x, y, pos.roomName);
}
