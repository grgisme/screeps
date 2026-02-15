// Global Cache for high-performance data storage that resets on code refresh but persists across ticks
export const micro = {
    // Cache for Room.find results
    _findCache: {} as { [roomName: string]: { [type: number]: any[] } },
    _findCacheTick: -1,

    // CostMatrix cache (persists longer?)
    _cmCache: {} as { [key: string]: { cm: CostMatrix, time: number } },

    find: function <T extends FindConstant>(room: Room, type: T, opts?: FilterOptions<T>): Array<CheckTypes<T>> {
        if (this._findCacheTick !== Game.time) {
            this._findCache = {};
            this._findCacheTick = Game.time;
        }

        if (!this._findCache[room.name]) {
            this._findCache[room.name] = {};
        }

        // Only cache basic finds without complex opts filter (unless we hash opts?)
        // For simplicity, only cache standard structural finds
        if (opts) {
            return room.find(type, opts) as Array<CheckTypes<T>>;
        }

        if (!this._findCache[room.name][type]) {
            this._findCache[room.name][type] = room.find(type);
        }

        return this._findCache[room.name][type] as Array<CheckTypes<T>>;
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
