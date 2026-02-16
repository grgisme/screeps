import { trafficManager } from "./movement/TrafficManager";

export const roleReserver = {
    run: function (creep: Creep) {
        const mem = creep.memory as any;
        if (mem.targetRoom && creep.room.name !== mem.targetRoom) {
            trafficManager.travelTo(creep, new RoomPosition(25, 25, mem.targetRoom as string), { range: 20 });
            return;
        }

        if (creep.room.controller) {
            if (creep.reserveController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                trafficManager.travelTo(creep, creep.room.controller.pos, { range: 1 });
            }
        }
    }
};
