import { managerIntel } from "./manager.intel";

export const roleScout = {
    run: function (creep: Creep) {
        // Scout Logic
        // 1. Check current room
        this.updateRoomMemory(creep.room);

        // 2. Decide where to go
        // Simple strategy: Go to a room that has 'unknown' state or old data.
        // Memory.remoteRooms should be populated by main or manager.remote?
        // Let's assume manager.remote handles assignment, or we do it here.
        // For starter, let's just pick a random exit and go, or use a target from memory.

        if (!creep.memory.targetId) {
            // Pick a neighbor
            const exits = Game.map.describeExits(creep.room.name);
            if (exits) {
                const dests = Object.values(exits);
                const target = dests[Math.floor(Math.random() * dests.length)];
                creep.memory.targetId = target as any; // Store room name as targetId (hacky but works for string)
            }
        }

        const targetRoomName = creep.memory.targetId as any as string;
        if (targetRoomName) {
            if (creep.room.name === targetRoomName) {
                // Arrived!
                this.updateRoomMemory(creep.room);
                creep.memory.targetId = undefined; // Done, pick next
            } else {
                // Move to room
                const exitDir = creep.room.findExitTo(targetRoomName);
                if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
                    const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
                    if (exit) {
                        creep.moveTo(exit);
                    }
                }
            }
        }
    },

    updateRoomMemory: function (room: Room) {
        managerIntel.scanRoom(room);
    }
};
