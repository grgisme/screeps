import { trafficManager } from "./movement/TrafficManager";
import { micro } from "./MicroOptimizations";

export const roleDefender = {
    run: function (creep: Creep) {
        const hostiles = micro.find(creep.room, FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            // Target priority: Controller campers > Closest
            let target: AnyCreep | undefined = hostiles.find(h => creep.room.controller && h.pos.inRangeTo(creep.room.controller.pos, 3));
            if (!target) target = creep.pos.findClosestByRange(hostiles) || undefined;

            if (target) {
                if (creep.attack(target) === ERR_NOT_IN_RANGE) {
                    trafficManager.travelTo(creep, target.pos);
                }
            }
        } else {
            // Idle: wait at spawn or controller
            const targetPos = creep.room.controller?.pos || (micro.find(creep.room, FIND_MY_SPAWNS)[0]?.pos);
            if (targetPos) {
                trafficManager.travelTo(creep, targetPos, { range: 3 });
            }
        }
    }
};
