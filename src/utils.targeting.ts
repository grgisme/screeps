import { micro } from "./MicroOptimizations";

export const utilsTargeting = {
    findUnreserved: function <T extends RoomObject>(
        creep: Creep,
        type: FindConstant,
        filter: (o: any) => boolean = () => true
    ): T | null {
        // 1. Get targets from CACHE
        const potential = micro.find(creep.room, type).filter(filter) as unknown as T[];
        if (potential.length === 0) return null;

        // 2. Get Reservations from per-tick CACHE
        const reserved = micro.getRoomReservations(creep.room);

        // 3. Filter out targets that are fully reserved
        const available = potential.filter(t => {
            const id = (t as any).id;
            const reservedAmount = reserved.get(id) || 0;

            let actualAmount = 0;
            if (t instanceof Resource) {
                actualAmount = t.amount;
            } else if ((t as any).store) {
                actualAmount = (t as any).store[RESOURCE_ENERGY] || 0;
            } else if (t instanceof Source) {
                actualAmount = t.energy;
            }

            return reservedAmount < actualAmount;
        });

        if (available.length === 0) return null;

        // 4. Return closest by RANGE (much cheaper than Path)
        return creep.pos.findClosestByRange(available) as T;
    }
};
