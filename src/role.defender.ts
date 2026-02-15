import { pathing } from "./pathing";

export const roleDefender = {
    run: function (creep: Creep) {
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            // Attack closest?
            const target = creep.pos.findClosestByRange(hostiles);
            if (target) {
                if (creep.attack(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);
                    // OR pathing.run(creep, target.pos, 1);
                    // Allow default moveTo for military as it handles moving targets better than static path sometimes?
                    // But our pathing has stuck detection.
                    // pathing.run(creep, target.pos, 1); 
                    // Actually, move to target implies range 1.
                }
            }
        } else {
            // Idle: Recycle or wait at bunker
            const center = (creep.room.memory as any).planning?.bunkerCenter;
            if (center) {
                pathing.run(creep, new RoomPosition(center.x, center.y, creep.room.name), 3);
            }
            // Or recycle if no hostiles for X ticks?
        }
    }
};
