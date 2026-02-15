import { pathing } from "./pathing";

export const roleReserver = {
    run: function (creep: Creep) {
        const mem = creep.memory as any;
        if (mem.targetRoom && creep.room.name !== mem.targetRoom) {
            pathing.run(creep, new RoomPosition(25, 25, mem.targetRoom as string), 20);
            return;
        }

        if (creep.room.controller) {
            if (creep.reserveController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                pathing.run(creep, creep.room.controller.pos, 1);
            }
        }
    }
};
