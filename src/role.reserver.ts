import { pathing } from "./pathing";

export const roleReserver = {
    run: function (creep: Creep) {
        if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
            pathing.run(creep, new RoomPosition(25, 25, creep.memory.targetRoom), 20);
            return;
        }

        if (creep.room.controller) {
            if (creep.reserveController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                pathing.run(creep, creep.room.controller.pos, 1);
            }
        }
    }
};
