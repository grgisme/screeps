import "../mock.setup";
import { expect } from "chai";
import { RoomPlannerProcess } from "../../src/os/processes/RoomPlannerProcess";
import { Colony } from "../../src/os/colony/Colony";

// Mock Algorithms if possible, or use real one with mock terrain?
// We need to mock 'distanceTransform' from Algorithms.ts if we don't want to rely on real one + mock map.
// But Algorithms.ts imports Game.map.
// We need to mock Game.map.getRoomTerrain.

describe("RoomPlannerProcess", () => {
    let process: RoomPlannerProcess;
    let colony: Colony;

    beforeEach(() => {
        // Reset globals
        require("../mock.setup").resetMocks();

        // Mock Map
        (globalThis as any).Game.map = {
            getRoomTerrain: (_roomName: string) => {
                return {
                    get: (x: number, y: number) => {
                        // Return wall (1) at edges, plain (0) elsewhere?
                        // TERRAIN_MASK_WALL = 1
                        if (x === 0 || x === 49 || y === 0 || y === 49) return 1;
                        return 0;
                    }
                };
            }
        };

        (globalThis as any).Game.rooms = {
            "W1N1": {
                find: (_type: number) => [] // Return empty array for FIND_SOURCES
            }
        };
        (globalThis as any).TERRAIN_MASK_WALL = 1;
        (globalThis as any).TERRAIN_MASK_SWAMP = 2;

        // Mock ColonyProcess registry (since RoomPlanner uses it)
        (globalThis as any).ColonyProcess = {
            colonies: {},
            getColony: (name: string) => (globalThis as any).ColonyProcess.colonies[name]
        };

        // Create Colony logic mock
        colony = new Colony("W1N1");
        (globalThis as any).ColonyProcess.colonies["W1N1"] = colony;

        process = new RoomPlannerProcess(1, 1, 0, "W1N1");
    });

    it("should find an anchor and save it to memory", () => {
        process.run();

        const savedAnchor = colony.memory.anchor;
        expect(savedAnchor).to.not.be.undefined;
        if (savedAnchor) {
            expect(savedAnchor.x).to.be.within(6, 44);
            expect(savedAnchor.y).to.be.within(6, 44);
        }
    });

    it("should not re-plan if anchor exists", () => {
        colony.memory.anchor = { x: 25, y: 25 };

        // Spy on log or something? 
        // Or check that it didn't change (which it shouldn't anyway if it was optimal)
        process.run();

        expect(colony.memory.anchor.x).to.equal(25);
        expect(colony.memory.anchor.y).to.equal(25);
    });
});
