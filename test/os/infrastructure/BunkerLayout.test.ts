import "../../mock.setup";
import { expect } from "chai";
import { BunkerLayout } from "../../../src/os/infrastructure/BunkerLayout";

describe("BunkerLayout", () => {
    it("should return correct absolute positions", () => {
        const anchor = new RoomPosition(25, 25, "W1N1");
        const rel = { x: -1, y: 0 };
        const pos = BunkerLayout.getPos(anchor, rel);
        expect(pos.x).to.equal(24);
        expect(pos.y).to.equal(25);
        expect(pos.roomName).to.equal("W1N1");
    });

    it("should define core structures", () => {
        expect(BunkerLayout.structures[STRUCTURE_SPAWN]).to.not.be.undefined;
        expect(BunkerLayout.structures[STRUCTURE_STORAGE]).to.not.be.undefined;
        expect(BunkerLayout.structures[STRUCTURE_TERMINAL]).to.not.be.undefined;
        expect(BunkerLayout.structures[STRUCTURE_LINK]).to.not.be.undefined;
    });

    it("should have all coordinates within 13×13 bounds (±6)", () => {
        for (const type of Object.keys(BunkerLayout.structures) as StructureConstant[]) {
            const coords = BunkerLayout.structures[type] || [];
            for (const c of coords) {
                expect(c.x, `${type} x=${c.x}`).to.be.within(-6, 6);
                expect(c.y, `${type} y=${c.y}`).to.be.within(-6, 6);
            }
        }
    });

    it("should have center tile at (0,0) for the primary filler", () => {
        expect(BunkerLayout.centerTile.x).to.equal(0);
        expect(BunkerLayout.centerTile.y).to.equal(0);
        expect(BunkerLayout.fillerTiles[0].x).to.equal(0);
        expect(BunkerLayout.fillerTiles[0].y).to.equal(0);
    });

    it("should have hub link at (0,1) adjacent to center tile", () => {
        const hub = BunkerLayout.hubPos;
        expect(hub.x).to.equal(0);
        expect(hub.y).to.equal(1);
        // Chebyshev distance from center (0,0) to hub (0,1) = 1
        const dist = Math.max(Math.abs(hub.x - 0), Math.abs(hub.y - 0));
        expect(dist).to.equal(1);
    });

    it("should surround center tile with 8 structures at Chebyshev range 1", () => {
        // The 8 positions adjacent to (0,0) should contain:
        // 7 extensions (filler ring) + 1 link (hub)
        const adjacentPositions = new Set<string>();
        const allCoords: Array<{ type: string; x: number; y: number }> = [];

        for (const type of Object.keys(BunkerLayout.structures) as StructureConstant[]) {
            for (const c of BunkerLayout.structures[type] || []) {
                const dist = Math.max(Math.abs(c.x), Math.abs(c.y));
                if (dist === 1) {
                    adjacentPositions.add(`${c.x},${c.y}`);
                    allCoords.push({ type, x: c.x, y: c.y });
                }
            }
        }

        // All 8 surrounding tiles accounted for
        expect(adjacentPositions.size).to.equal(8);
    });

    it("should have Storage and Terminal adjacent to each other and hub link", () => {
        const storage = BunkerLayout.structures[STRUCTURE_STORAGE]![0];
        const terminal = BunkerLayout.structures[STRUCTURE_TERMINAL]![0];
        const hub = BunkerLayout.hubPos;

        // Storage-Terminal adjacency
        const stDist = Math.max(Math.abs(storage.x - terminal.x), Math.abs(storage.y - terminal.y));
        expect(stDist, "Storage and Terminal must be adjacent").to.equal(1);

        // Storage-Hub adjacency
        const shDist = Math.max(Math.abs(storage.x - hub.x), Math.abs(storage.y - hub.y));
        expect(shDist, "Storage must be adjacent to Hub Link").to.equal(1);

        // Terminal-Hub adjacency
        const thDist = Math.max(Math.abs(terminal.x - hub.x), Math.abs(terminal.y - hub.y));
        expect(thDist, "Terminal must be adjacent to Hub Link").to.equal(1);
    });

    it("should have lab inputs within range 2 of all lab outputs", () => {
        const labs = BunkerLayout.structures[STRUCTURE_LAB]!;
        expect(labs.length).to.equal(10);

        // First 2 are inputs
        const inputs = labs.slice(0, 2);
        const outputs = labs.slice(2);

        for (const input of inputs) {
            for (const output of outputs) {
                const dist = Math.max(Math.abs(input.x - output.x), Math.abs(input.y - output.y));
                expect(dist, `Input (${input.x},${input.y}) to Output (${output.x},${output.y})`).to.be.at.most(2);
            }
        }
    });

    it("should have 60 total extensions", () => {
        const extensions = BunkerLayout.structures[STRUCTURE_EXTENSION]!;
        expect(extensions.length).to.equal(60);
    });

    it("should have 3 spawns, 6 towers, 1 storage, 1 terminal, 1 link", () => {
        expect(BunkerLayout.structures[STRUCTURE_SPAWN]!.length).to.equal(3);
        expect(BunkerLayout.structures[STRUCTURE_TOWER]!.length).to.equal(6);
        expect(BunkerLayout.structures[STRUCTURE_STORAGE]!.length).to.equal(1);
        expect(BunkerLayout.structures[STRUCTURE_TERMINAL]!.length).to.equal(1);
        expect(BunkerLayout.structures[STRUCTURE_LINK]!.length).to.equal(1);
    });

    it("should have no coordinate collisions between non-stackable structures", () => {
        const occupied = new Map<string, string>(); // "x,y" → structure type
        const stackable = new Set<string>([STRUCTURE_ROAD, STRUCTURE_RAMPART]);

        for (const type of Object.keys(BunkerLayout.structures) as StructureConstant[]) {
            if (stackable.has(type)) continue;
            for (const c of BunkerLayout.structures[type] || []) {
                const key = `${c.x},${c.y}`;
                expect(occupied.has(key), `Collision at (${c.x},${c.y}): ${type} vs ${occupied.get(key)}`).to.be.false;
                occupied.set(key, type);
            }
        }
    });
});
