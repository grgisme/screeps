export const managerMemory = {
    /**
     * Scans all creeps and ensures they have a valid role and basic memory structure.
     */
    run: function () {
        // Run every 50 ticks to save CPU, or every tick if we are in a recovery state
        if (Game.time % 50 === 0) {
            this.cleanupCreeps();
            this.cleanupRooms();
        }
    },

    cleanupCreeps: function () {
        for (const name in Memory.creeps) {
            if (!(name in Game.creeps)) {
                delete Memory.creeps[name];
            } else {
                const creep = Game.creeps[name];
                // Ensure Role exists
                if (!creep.memory.role) {
                    this.recoverCreep(creep);
                }
                // Ensure mandatory state flags exist
                if (creep.memory.working === undefined) {
                    creep.memory.working = false;
                }
            }
        }
    },

    cleanupRooms: function () {
        for (const roomName in Memory.rooms) {
            // Keep room memory if:
            // 1. We have visibility AND (it's ours OR we have a reservation)
            const room = Game.rooms[roomName];
            if (room) {
                const isMine = room.controller && room.controller.my;
                const isReserved = room.controller && room.controller.reservation && room.controller.reservation.username === 'Me';
                if (isMine || isReserved) continue;
            }

            // 2. We have creeps in it or headed to it
            const hasPresence = Object.values(Game.creeps).some(c => c.pos.roomName === roomName || (c.memory as any).targetRoom === roomName);
            if (hasPresence) continue;

            // 3. Special Case: Intel (Intel is separate, but if room memory is being used for scouting/planning)
            // If it's not a primary room and no presence, PURGE.
            console.log(`🧹 MEMORY: Purging stale room memory for ${roomName}`);
            delete Memory.rooms[roomName];
        }
    },

    /**
     * Attempts to deduce the role of a creep based on its name and body composition.
     */
    recoverCreep: function (creep: Creep) {
        const name = creep.name.toLowerCase();
        let deducedRole: string | null = null;

        // Try name-based deduction first
        if (name.includes('miner')) deducedRole = 'miner';
        else if (name.includes('hauler')) deducedRole = 'hauler';
        else if (name.includes('harvester')) deducedRole = 'harvester';
        else if (name.includes('upgrader')) deducedRole = 'upgrader';
        else if (name.includes('builder')) deducedRole = 'builder';
        else if (name.includes('scout')) deducedRole = 'scout';
        else if (name.includes('defender')) deducedRole = 'defender';

        // Body-based fallback
        if (!deducedRole) {
            const work = creep.getActiveBodyparts(WORK);
            const carry = creep.getActiveBodyparts(CARRY);

            if (work >= 5 && carry === 0) deducedRole = 'miner';
            else if (carry > 0 && work === 0) deducedRole = 'hauler';
            else if (work > 0 && carry > 0) deducedRole = 'harvester';
            else deducedRole = 'harvester'; // Default safe fallback
        }

        console.log(`🔧 RECOVERY: Deduced role '${deducedRole}' for creep ${creep.name} with lost memory.`);
        creep.memory.role = deducedRole as any;
        creep.memory.working = false;
    }
};
