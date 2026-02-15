// Global Cache for high-performance data storage that resets on code refresh but persists across ticks
export const micro = {
    // Cache for Room.find results
    _findCache: {} as { [roomName: string]: { [type: number]: any[] } },
    _findCacheTick: -1,

    // Cache for Energy Reservations (per targetId)
    _reserveCache: {} as { [roomName: string]: Map<string, number> },
    _reserveCacheTick: -1,

    // CostMatrix cache
    _cmCache: {} as { [key: string]: { cm: CostMatrix, time: number } },

    find: function <T extends FindConstant>(room: Room, type: T, opts?: FilterOptions<T>): Array<CheckTypes<T>> {
        if (this._findCacheTick !== Game.time) {
            this._findCache = {};
            this._findCacheTick = Game.time;
        }

        if (!this._findCache[room.name]) {
            this._findCache[room.name] = {};
        }

        // Only cache basic finds without complex opts filter
        if (opts) {
            return room.find(type, opts) as Array<CheckTypes<T>>;
        }

        if (!this._findCache[room.name][type]) {
            this._findCache[room.name][type] = room.find(type);
        }

        return this._findCache[room.name][type] as Array<CheckTypes<T>>;
    },

    /**
     * Calculates energy reservations for a specific room once per tick.
     */
    getRoomReservations: function (room: Room): Map<string, number> {
        if (this._reserveCacheTick !== Game.time) {
            this._reserveCache = {};
            this._reserveCacheTick = Game.time;
        }

        if (this._reserveCache[room.name]) {
            return this._reserveCache[room.name];
        }

        const map = new Map<string, number>();
        const creeps = this.find(room, FIND_MY_CREEPS);

        for (const creep of creeps) {
            if (creep.memory.targetId) {
                const current = map.get(creep.memory.targetId) || 0;
                // Count how much energy this creep INTENDS to take
                map.set(creep.memory.targetId, current + creep.store.getFreeCapacity(RESOURCE_ENERGY));
            }
        }

        this._reserveCache[room.name] = map;
        return map;
    },

    getCostMatrix: function (roomName: string, callback: () => CostMatrix): CostMatrix {
        // Cache for 10 ticks? Or until invalid?
        // Simple modification check: check if Game.time changed? 
        // Let's cache for 5 ticks for now to save CPU on heavy pathing
        if (this._cmCache[roomName] && Game.time - this._cmCache[roomName].time < 5) {
            return this._cmCache[roomName].cm;
        }

        const cm = callback();
        this._cmCache[roomName] = { cm, time: Game.time };
        return cm;
    }
};

type CheckTypes<T> = T extends FIND_STRUCTURES ? Structure :
    T extends FIND_MY_STRUCTURES ? Structure :
    T extends FIND_HOSTILE_CREEPS ? Creep :
    T extends FIND_SOURCES ? Source :
    any;
