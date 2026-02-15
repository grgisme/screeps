import { managerIntel } from "./manager.intel";

export const managerExpansion = {
    run: function (homeRoom: Room) {
        // Run rarely (every 100 ticks?)
        if (Game.time % 100 !== 0) return;

        const readiness = managerIntel.checkExpansionReadiness(homeRoom);
        if (!readiness.claim) return;

        console.log(`🌍 EXPANSION: ${homeRoom.name} is ready to expand! Searching for candidates...`);

        const bestRoom = this.findBestExpansionTarget(homeRoom);
        if (bestRoom) {
            console.log(`🎯 EXPANSION TARGET FOUND: ${bestRoom}. (Implementation pending: Spawn Claimer)`);
            // Set memory target?
            // (homeRoom.memory as any).expansionTarget = bestRoom;
        } else {
            console.log(`🌍 EXPANSION: No suitable candidates found.`);
        }
    },

    evaluateExpansionCandidate: function (targetRoomName: string, homeRoomName: string): boolean {
        const intel = Memory.intel[targetRoomName];
        if (!intel) return false;

        // 1. Must have 2 Sources (Perfect Room Filter)
        if (intel.sources < 2) return false;

        // 2. Score must be better than current room? Or just high?
        // Let's require score > 15 (arbitrary "good" threshold)
        if (intel.score < 15) return false;

        // 3. Distance check (don't claim cross-map)
        const dist = Game.map.getRoomLinearDistance(homeRoomName, targetRoomName);
        if (dist > 5) return false;

        return true;
    },

    findBestExpansionTarget: function (homeRoom: Room): string | null {
        let bestRoom = null;
        let bestScore = -999;

        for (const roomName in Memory.intel) {
            if (this.evaluateExpansionCandidate(roomName, homeRoom.name)) {
                const score = Memory.intel[roomName].score;
                if (score > bestScore) {
                    bestScore = score;
                    bestRoom = roomName;
                }
            }
        }
        return bestRoom;
    }
};
