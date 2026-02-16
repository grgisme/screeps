import { trafficManager } from "./movement/TrafficManager";

export const roleClaimer = {
    run: function (creep: Creep) {
        const targetRoom = creep.memory.targetId as any as string; // Storing room name in targetId

        if (!targetRoom) return;

        if (creep.room.name !== targetRoom) {
            const exitDir = creep.room.findExitTo(targetRoom);
            if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
                const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
                if (exit) trafficManager.travelTo(creep, exit);
            }
        } else {
            // In Room
            if (creep.room.controller) {
                if (creep.claimController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, creep.room.controller.pos, { range: 1 });
                }
            }
        }
    }
};
