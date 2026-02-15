export const managerDefense = {
    run: function (room: Room) {
        // 1. Tower Defense (Local)
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER
        });

        const hostiles = room.find(FIND_HOSTILE_CREEPS);

        if (hostiles.length > 0) {
            // Alert
            const username = hostiles[0].owner.username;
            // Filter harmless scouts (no ATTACK, RANGED_ATTACK, WORK, CARRY, CLAIM) -> Just MOVE?
            const isThreat = hostiles.some(c => c.getActiveBodyparts(ATTACK) > 0 ||
                c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                c.getActiveBodyparts(WORK) > 0 ||
                c.getActiveBodyparts(CLAIM) > 0 ||
                c.getActiveBodyparts(CARRY) > 0); // Carry could steal?

            if (isThreat) {
                console.log(`⚠️ DEFENSE ALERT: Hostile ${username} detected in ${room.name}!`);

                // Mark Room as Unsafe
                if (Memory.intel && Memory.intel[room.name]) {
                    Memory.intel[room.name].status = 'unsafe';
                    Memory.intel[room.name].unsafeUntil = Game.time + 1000;
                }

                // If no towers (Remote Room?), we should request help?
                if (towers.length === 0) {
                    console.log(`🛡️ REMOTE DEFENSE: Need backup in ${room.name}!`);
                    // TODO: Request Defender Spawn?
                }
            } else {
                console.log(`🕊️ PEACE: Observing harmless scout ${username} in ${room.name}.`);
            }

            // Tower Logic (if towers exist)
            if (towers.length > 0) {
                // Whitelist Check
                const whitelist = Memory.diplomacy?.whitelist || [];

                // Target priority: Healers > Attackers > Others (Excluding Whitelisted)
                let target = hostiles.find(c => !whitelist.includes(c.owner.username) && c.getActiveBodyparts(HEAL) > 0);
                if (!target) target = hostiles.find(c => !whitelist.includes(c.owner.username) && (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0));
                if (!target) target = hostiles.find(c => !whitelist.includes(c.owner.username));

                if (target) {
                    towers.forEach(tower => tower.attack(target!));
                }
            }
        } else {
            if (towers.length === 0) return;
            // Heal Friendlies
            const wounded = room.find(FIND_MY_CREEPS, { filter: c => c.hits < c.hitsMax });
            if (wounded.length > 0) {
                wounded.sort((a, b) => a.hits - b.hits);
                towers.forEach(tower => tower.heal(wounded[0]));
                return;
            }

            // Repair (only if energy is healthy > 50%)
            if (towers[0].store[RESOURCE_ENERGY] > towers[0].store.getCapacity(RESOURCE_ENERGY) * 0.5) {
                const damaged = room.find(FIND_STRUCTURES, {
                    filter: s => s.hits < s.hitsMax && s.hits < 5000 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART
                });

                if (damaged.length > 0) {
                    damaged.sort((a, b) => a.hits - b.hits);
                    towers.forEach(tower => tower.repair(damaged[0]));
                }
            }
        }
    }
};
