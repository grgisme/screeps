import { roleScout } from "./role.scout";
import { managerIntel } from "./manager.intel";
import { managerExpansion } from "./manager.expansion";

export const managerRemote = {
    run: function (myRooms: Room[]) {
        myRooms.forEach(room => {
            // 1. Expansion Check
            // Gated by CPU in main? Or here?
            // Let's run it, but managerExpansion should probably check CPU too if expensive.
            managerExpansion.run(room);

            // 2. Squatter Protocol (Reservation)
            const readiness = managerIntel.checkExpansionReadiness(room);

            if (readiness.reserve) {
                const exits = Game.map.describeExits(room.name);
                if (exits) {
                    for (const dir in exits) {
                        const neighborName = exits[dir as any as ExitConstant]!;
                        if (!Memory.intel) Memory.intel = {};
                        const intel = Memory.intel[neighborName];

                        // Reserve if good room and not occupied
                        if (intel && intel.sources >= 2 && !intel.controllerOwner) {
                            const existingReserver = Object.values(Game.creeps).find(c => c.memory.role === 'reserver' && c.memory.targetRoom === neighborName);

                            if (!existingReserver) {
                                let needsReserver = true;
                                if (Game.rooms[neighborName]) {
                                    const controller = Game.rooms[neighborName].controller;
                                    if (controller && controller.reservation && controller.reservation.username === 'Me' && controller.reservation.ticksToEnd > 3000) {
                                        needsReserver = false;
                                    }
                                }

                                if (needsReserver) {
                                    const requests = (room.memory as any).spawnRequests || [];
                                    const alreadyRequested = requests.find((r: any) => r.role === 'reserver' && r.targetRoom === neighborName);

                                    if (!alreadyRequested) {
                                        console.log(`🏴 SQUATTER: Requesting Reserver for ${neighborName} from ${room.name}`);
                                        if (!(room.memory as any).spawnRequests) (room.memory as any).spawnRequests = [];
                                        (room.memory as any).spawnRequests.push({ role: 'reserver', targetRoom: neighborName, priority: 50 });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Run Scouts
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory.role === 'scout') roleScout.run(creep);
        }
    }
};
