export const managerQueue = {
    // Shared state for the current tick
    _roomGoals: {} as { [roomName: string]: number },

    /**
     * Registers a required amount of energy for a high-priority task (e.g. Spawning).
     */
    setGoal: function (roomName: string, amount: number) {
        this._roomGoals[roomName] = amount;
    },

    /**
     * Returns the current energy goal for the room.
     */
    getGoal: function (roomName: string): number {
        return this._roomGoals[roomName] || 0;
    },

    /**
     * Calculates the surplus energy available for low-priority workers.
     */
    getSurplus: function (room: Room): number {
        const goal = this.getGoal(room.name);
        return Math.max(0, room.energyAvailable - goal);
    }
};
