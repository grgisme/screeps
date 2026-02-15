import { expect } from "chai";
import { pathing } from "../src/pathing";

// Mocking Screeps Globals
const mockRoomName = "W1N1";
const mockGame = {
    rooms: {
        [mockRoomName]: {
            name: mockRoomName,
            find: (type: number) => [], // Return empty for now
            memory: {}
        }
    },
    time: 100
};

// @ts-ignore
global.Game = mockGame;
// @ts-ignore
global.PathFinder = {
    CostMatrix: class {
        _bits: Uint8Array;
        constructor() { this._bits = new Uint8Array(2500); }
        set(x: number, y: number, val: number) { this._bits[y * 50 + x] = val; }
        get(x: number, y: number) { return this._bits[y * 50 + x]; }
    },
    search: () => ({ path: [], ops: 0, cost: 0, incomplete: false })
};
// @ts-ignore
global.FIND_STRUCTURES = 107;
// @ts-ignore
global.FIND_CREEPS = 101;
// @ts-ignore
global.FIND_CONSTRUCTION_SITES = 111;
// @ts-ignore
global.STRUCTURE_ROAD = 'road';
// @ts-ignore
global.STRUCTURE_CONTAINER = 'container';
// @ts-ignore
global.STRUCTURE_RAMPART = 'rampart';


describe("Pathing Logic", () => {
    it("should generate a CostMatrix", () => {
        const costs = pathing.getCostMatrix(mockRoomName);
        expect(costs).to.not.be.undefined;
    });

    it("should return cached CostMatrix on same tick", () => {
        const costs1 = pathing.getCostMatrix(mockRoomName);
        const costs2 = pathing.getCostMatrix(mockRoomName);
        expect(costs1).to.equal(costs2); // strict equality for cache check
    });

    it("should refresh cache on new tick", () => {
        const costs1 = pathing.getCostMatrix(mockRoomName);
        // @ts-ignore
        global.Game.time = 101;
        const costs2 = pathing.getCostMatrix(mockRoomName);
        expect(costs1).to.not.equal(costs2);
    });
});
