export const utilsTargeting = {
    findUnreserved: function <T extends RoomObject>(
        creep: Creep,
        type: FindConstant,
        filter: (o: any) => boolean = () => true
    ): T | null {
        // Get all potential targets
        const potential = creep.room.find(type, { filter: filter }) as unknown as T[];
        if (potential.length === 0) return null;

        // Calculate Reserved Amount per Target ID
        const reserved = new Map<string, number>();

        for (const name in Game.creeps) {
            if (name === creep.name) continue; // Don't count self
            const other = Game.creeps[name];
            if (other.memory.targetId) {
                const current = reserved.get(other.memory.targetId) || 0;
                reserved.set(other.memory.targetId, current + other.store.getFreeCapacity(RESOURCE_ENERGY));
            }
        }

        // Filter out targets that are fully reserved
        const available = potential.filter(t => {
            const id = (t as any).id;
            const reservedAmount = reserved.get(id) || 0;

            let actualAmount = 0;
            if (t instanceof Resource) {
                actualAmount = t.amount;
            } else if ((t as any).store) {
                actualAmount = (t as any).store[RESOURCE_ENERGY] || 0;
            } else if (t instanceof Source) {
                // Sources regenerate, so "locking" them by capacity is tricky. 
                // Usually we don't lock sources. But if we did, we'd check energy.
                actualAmount = t.energy;
            }

            // Allow if there is still energy left after everyone else takes their share
            return reservedAmount < actualAmount;
        });

        if (available.length === 0) return null;

        // Return closest
        return creep.pos.findClosestByPath(available) || available[0];
    }
};
