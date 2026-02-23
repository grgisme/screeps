import "../mock.setup";
import { expect } from "chai";
import { scoreRoom, rankRooms } from "../../src/utils/RoomScorer";

describe("RoomScorer", () => {
    // FIND_EXIT_TOP/RIGHT/BOTTOM/LEFT and TERRAIN_MASK_WALL/SWAMP are set by mock.setup

    /**
     * Build a minimal mock Room. `swampFraction` controls what fraction of
     * non-wall tiles getTerrain().get() reports as swamp (0.0 – 1.0).
     */
    function makeRoom(opts: {
        name: string;
        sources?: number;
        swampFraction?: number;  // 0.0 = no swamp, 1.0 = all swamp
        exitDirs?: ExitConstant[];
    }): Room {
        const { name, sources = 1, swampFraction = 0, exitDirs = [FIND_EXIT_TOP] } = opts;

        const terrain = {
            get: (x: number, y: number): number => {
                // Map a fraction of tiles to swamp based on position
                const idx = y * 50 + x;
                const total = 50 * 50;
                if (idx < Math.floor(swampFraction * total)) return TERRAIN_MASK_SWAMP;
                return 0; // plain
            }
        };

        const mockSources = Array.from({ length: sources }, (_, i) => ({
            id: `src${i}`, pos: new RoomPosition(25, 25, name)
        }));
        const exitTile = { x: 25, y: 0, roomName: name };

        return {
            name,
            find: (type: FindConstant) => {
                if (type === FIND_SOURCES) return mockSources;
                if (exitDirs.includes(type as ExitConstant)) return [exitTile];
                return [];
            },
            getTerrain: () => terrain,
            controller: { level: 0 }
        } as any;
    }

    it("should return null when room is not visible", () => {
        (globalThis as any).Game.rooms = {};
        expect(scoreRoom("W99N99")).to.be.null;
    });

    it("2-source room should score higher than 1-source room", () => {
        (globalThis as any).Game.rooms = {
            "W1N1": makeRoom({ name: "W1N1", sources: 2, exitDirs: [FIND_EXIT_TOP] }),
            "W2N2": makeRoom({ name: "W2N2", sources: 1, exitDirs: [FIND_EXIT_TOP] }),
        };
        const two = scoreRoom("W1N1")!;
        const one = scoreRoom("W2N2")!;
        expect(two.score).to.be.greaterThan(one.score);
        expect(two.sourceCount).to.equal(2);
        expect(one.sourceCount).to.equal(1);
    });

    it("high swamp fraction should reduce score vs low swamp", () => {
        (globalThis as any).Game.rooms = {
            "LowSwamp": makeRoom({ name: "LowSwamp", sources: 1, swampFraction: 0.0, exitDirs: [FIND_EXIT_TOP] }),
            "HighSwamp": makeRoom({ name: "HighSwamp", sources: 1, swampFraction: 0.8, exitDirs: [FIND_EXIT_TOP] }),
        };
        const low = scoreRoom("LowSwamp")!;
        const high = scoreRoom("HighSwamp")!;
        expect(low.swampRatio).to.be.lessThan(high.swampRatio);
        expect(low.score).to.be.greaterThan(high.score);
    });

    it("more exits should reduce score", () => {
        (globalThis as any).Game.rooms = {
            "C": makeRoom({ name: "C", sources: 1, exitDirs: [FIND_EXIT_TOP] }),
            "D": makeRoom({ name: "D", sources: 1, exitDirs: [FIND_EXIT_TOP, FIND_EXIT_RIGHT, FIND_EXIT_BOTTOM, FIND_EXIT_LEFT] }),
        };
        const few = scoreRoom("C")!;
        const many = scoreRoom("D")!;
        expect(few.score).to.be.greaterThan(many.score);
    });

    it("rankRooms should sort by descending score", () => {
        (globalThis as any).Game.rooms = {
            "X": makeRoom({ name: "X", sources: 1, exitDirs: [FIND_EXIT_TOP] }),
            "Y": makeRoom({ name: "Y", sources: 2, exitDirs: [FIND_EXIT_TOP] }),
        };
        const ranked = rankRooms(["X", "Y"]);
        expect(ranked[0].roomName).to.equal("Y"); // 2-source room first
        expect(ranked[1].roomName).to.equal("X");
    });

    it("rankRooms should skip invisible rooms", () => {
        (globalThis as any).Game.rooms = {
            "Visible": makeRoom({ name: "Visible", sources: 1, exitDirs: [FIND_EXIT_TOP] }),
        };
        const ranked = rankRooms(["Visible", "Invisible"]);
        expect(ranked).to.have.lengthOf(1);
        expect(ranked[0].roomName).to.equal("Visible");
    });
});
