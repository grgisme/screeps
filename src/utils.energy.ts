import { managerQueue } from "./manager.queue";

export const utilsEnergy = {
    /**
     * Checks if the room has surplus energy in spawn/extensions that workers can use.
     */
    isSurplus: function (room: Room): boolean {
        // If we have MORE than what the spawn queue needs, it's surplus.
        return managerQueue.getSurplus(room) > 50; // Buffer of 50
    },

    /**
     * Returns available spawn/extension energy structures if surplus is available.
     */
    getSurplusStructures: function (room: Room): (StructureSpawn | StructureExtension)[] {
        if (!this.isSurplus(room)) return [];

        return room.find(FIND_MY_STRUCTURES, {
            filter: (s): s is StructureSpawn | StructureExtension =>
                (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                s.store[RESOURCE_ENERGY] > 0
        });
    }
};
