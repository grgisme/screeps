export const managerMemory = {
    /**
     * Scans all creeps and ensures they have a valid role and basic memory structure.
     */
    run: function () {
        // Run every 50 ticks to save CPU, or every tick if we are in a recovery state
        if (Game.time % 50 !== 0) return;

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];

            // 1. Ensure memory object exists (Screeps usually handles this, but let's be safe)
            if (!creep.memory) {
                console.log(`🚨 ALERT: Creep ${creep.name} has NO memory object! Attempting to fix.`);
                // In Screeps, Memory.creeps[name] is the source of truth
                Memory.creeps[name] = Memory.creeps[name] || {};
            }

            // 2. Ensure Role exists
            if (!creep.memory.role) {
                this.recoverCreep(creep);
            }

            // 3. Ensure mandatory state flags exist
            if (creep.memory.working === undefined) {
                creep.memory.working = false;
            }
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
