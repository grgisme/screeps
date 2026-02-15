export interface RoomIntel {
    roomName: string;
    sources: number;
    terrainScore: number; // Percentage of swamp? Or walkable tiles?
    controllerOwner?: string;
    score: number;
    time: number;
    status: 'safe' | 'unsafe' | 'occupied';
    unsafeUntil?: number;
}

export const managerIntel = {
    scanRoom: function (room: Room): RoomIntel {
        // If we have recent intel with scores, skip terrain scan (Terrain never changes!)
        if (Memory.intel && Memory.intel[room.name] && Memory.intel[room.name].terrainScore !== undefined) {
            const existing = Memory.intel[room.name];
            // Update dynamic data but keep terrain score
            existing.controllerOwner = room.controller?.owner?.username;
            existing.time = Game.time;
            return existing;
        }

        const sources = room.find(FIND_SOURCES).length;

        // Terrain Analysis (Expensive! Run rarely)
        // Count Swamp vs Plains
        const terrain = room.getTerrain();
        let swampCount = 0;
        let wallCount = 0;
        let plainCount = 0;

        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                const t = terrain.get(x, y);
                if (t === TERRAIN_MASK_WALL) wallCount++;
                else if (t === TERRAIN_MASK_SWAMP) swampCount++;
                else plainCount++;
            }
        }

        const totalWalkable = swampCount + plainCount;
        const swampRatio = totalWalkable > 0 ? swampCount / totalWalkable : 1;

        // Scoring
        // Base: Sources * 10
        // Terrain: 10 - (SwampRatio * 10)
        let score = (sources * 10) + (10 - (swampRatio * 10));

        // Controller Bonus
        if (room.controller) {
            if (room.controller.owner) {
                score = -100; // Occupied
            } else if (room.controller.reservation) {
                score = -50; // Reserved
            }
        } else {
            score = -100; // No controller
        }

        const intel: RoomIntel = {
            roomName: room.name,
            sources: sources,
            terrainScore: 1 - swampRatio,
            controllerOwner: room.controller?.owner?.username,
            score: Math.floor(score),
            time: Game.time,
            status: 'safe'
        };

        // Novice/Respawn Zone Check
        const status = Game.map.getRoomStatus(room.name);
        if (status.status !== 'normal') {
            // If novice/respawn, mark as occupied/ignored for now unless it's about to end?
            // Actually, if it's novice, *I* can be in it if I'm novice.
            // But if I am establishing a remote, I might not be able to if outside.
            // Simple logic: If status.timestamp is far in future, ignore.
            if (status.timestamp && status.timestamp > Game.time + 50000) {
                intel.status = 'occupied'; // Treat as occupied to avoid expanding into locked zones
            }
        }

        // Save to Memory
        if (!Memory.intel) Memory.intel = {};
        Memory.intel[room.name] = intel;

        return intel;
    },

    checkExpansionReadiness: function (room: Room): { reserve: boolean, claim: boolean } {
        const rcl = room.controller?.level || 0;
        const energyCapacity = room.energyCapacityAvailable;
        const storage = room.storage;

        // Reservation Gate: RCL 3 + 650 Energy (Claim + Move = 600 + 50)
        const canReserve = rcl >= 3 && energyCapacity >= 650;

        // Claiming Gate: RCL 4 + Storage > 50k + GCL check
        const gclAvailable = Game.gcl.level > Object.keys(Game.rooms).filter(r => Game.rooms[r].controller?.my).length;
        const canClaim = rcl >= 4 && storage !== undefined && storage.store[RESOURCE_ENERGY] > 50000 && gclAvailable;

        return { reserve: canReserve, claim: canClaim };
    },

    getBestExpansionRoom: function (): string | null {
        if (!Memory.intel) return null;

        let bestRoom = null;
        let bestScore = -Infinity;

        for (const roomName in Memory.intel) {
            const data = Memory.intel[roomName];
            // Ignore unsafe rooms
            if (data.status === 'unsafe' && data.unsafeUntil && Game.time < data.unsafeUntil) continue;
            if (data.status === 'occupied') continue;

            // Ignore my own rooms
            if (Game.rooms[roomName] && Game.rooms[roomName].controller?.my) continue;

            // Distance check? (Approximated by Map Distance)
            // For now just raw score.
            if (data.score > bestScore && data.score > 15) { // Threshold 15 ensures at least 2 sources or great terrain
                bestScore = data.score;
                bestRoom = roomName;
            }
        }

        return bestRoom;
    }
};
