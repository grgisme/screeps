// Extensions for RoomPosition
RoomPosition.prototype.getPositionAtDirection = function (direction: DirectionConstant): RoomPosition | null {
    const x = this.x + (direction === RIGHT || direction === TOP_RIGHT || direction === BOTTOM_RIGHT ? 1 :
        direction === LEFT || direction === TOP_LEFT || direction === BOTTOM_LEFT ? -1 : 0);
    const y = this.y + (direction === BOTTOM || direction === BOTTOM_LEFT || direction === BOTTOM_RIGHT ? 1 :
        direction === TOP || direction === TOP_LEFT || direction === TOP_RIGHT ? -1 : 0);

    if (x < 0 || x > 49 || y < 0 || y > 49) {
        return null;
    }
    return new RoomPosition(x, y, this.roomName);
};
