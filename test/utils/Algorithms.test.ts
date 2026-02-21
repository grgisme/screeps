import "../mock.setup";
import { expect } from "chai";
import { distanceTransform, floodFill, stableMatch, MatchProposer, MatchReceiver } from "../../src/utils/Algorithms";

describe("Algorithms", () => {
    beforeEach(() => {
        require("../mock.setup").resetMocks();
    });

    describe("distanceTransform", () => {
        it("should calculate distances correctly for a simple room", () => {
            // Mock Terrain
            // 5x5 room
            // Walls at edges and center (2,2)
            // 0 0 0 0 0
            // 0 1 1 1 0
            // 0 1 0 1 0
            // 0 1 1 1 0
            // 0 0 0 0 0

            // Distances should be:
            // 0 0 0 0 0
            // 0 1 1 1 0
            // 0 1 0 1 0
            // 0 1 1 1 0
            // 0 0 0 0 0

            // Wait, standard DT:
            // Walls are 0.
            // Neighbors of walls are 1.
            // Neighbors of 1s are 2.

            const cm = new PathFinder.CostMatrix();
            // Init with walls=0, walkables=255
            for (let x = 0; x < 5; x++) {
                for (let y = 0; y < 5; y++) {
                    if (x === 0 || x === 4 || y === 0 || y === 4 || (x === 2 && y === 2)) {
                        cm.set(x, y, 0);
                    } else {
                        cm.set(x, y, 255);
                    }
                }
            }

            const dt = distanceTransform("sim", cm);

            expect(dt.get(0, 0)).to.equal(0);
            expect(dt.get(1, 1)).to.equal(1);
            expect(dt.get(2, 1)).to.equal(1);
            expect(dt.get(3, 3)).to.equal(1);
            expect(dt.get(2, 2)).to.equal(0);
        });

        it("should handle larger open areas", () => {
            // 7x7 open area surrounded by walls
            const cm = new PathFinder.CostMatrix();
            for (let x = 0; x < 9; x++) {
                for (let y = 0; y < 9; y++) {
                    if (x === 0 || x === 8 || y === 0 || y === 8) {
                        cm.set(x, y, 0);
                    } else {
                        cm.set(x, y, 255);
                    }
                }
            }

            const dt = distanceTransform("sim", cm);

            // Center (4,4) should be 4
            // 0 1 2 3 4 3 2 1 0
            expect(dt.get(4, 4)).to.equal(4);
            expect(dt.get(1, 1)).to.equal(1);
        });
    });

    describe("stableMatch", () => {
        it("should match proposers to their preferred receivers", () => {
            const proposers: MatchProposer[] = [
                { id: "p1", preferences: ["r1", "r2"] },
                { id: "p2", preferences: ["r2", "r1"] }
            ];
            const receivers: MatchReceiver[] = [
                { id: "r1", capacity: 1, score: (pid) => pid === "p1" ? 10 : 5 },
                { id: "r2", capacity: 1, score: (pid) => pid === "p2" ? 10 : 5 }
            ];

            const result = stableMatch(proposers, receivers);
            expect(result.get("p1")).to.equal("r1");
            expect(result.get("p2")).to.equal("r2");
        });

        it("should reject lower-scored proposer when receiver is full", () => {
            // Both proposers want r1, but r1 has capacity 1
            // r1 prefers p1 (score 10 vs 5)
            const proposers: MatchProposer[] = [
                { id: "p1", preferences: ["r1"] },
                { id: "p2", preferences: ["r1", "r2"] }
            ];
            const receivers: MatchReceiver[] = [
                { id: "r1", capacity: 1, score: (pid) => pid === "p1" ? 10 : 5 },
                { id: "r2", capacity: 1, score: () => 1 }
            ];

            const result = stableMatch(proposers, receivers);
            expect(result.get("p1")).to.equal("r1"); // p1 wins r1
            expect(result.get("p2")).to.equal("r2"); // p2 falls back to r2
        });

        it("should support multi-capacity receivers", () => {
            const proposers: MatchProposer[] = [
                { id: "p1", preferences: ["r1"] },
                { id: "p2", preferences: ["r1"] },
                { id: "p3", preferences: ["r1"] }
            ];
            const receivers: MatchReceiver[] = [
                {
                    id: "r1", capacity: 2, score: (pid) => {
                        if (pid === "p1") return 10;
                        if (pid === "p2") return 8;
                        return 3;
                    }
                }
            ];

            const result = stableMatch(proposers, receivers);
            // p1 and p2 get in (higher scores), p3 rejected
            expect(result.get("p1")).to.equal("r1");
            expect(result.get("p2")).to.equal("r1");
            expect(result.has("p3")).to.be.false;
        });

        it("should handle empty inputs gracefully", () => {
            expect(stableMatch([], []).size).to.equal(0);
            expect(stableMatch([{ id: "p1", preferences: [] }], []).size).to.equal(0);
            expect(stableMatch([], [{ id: "r1", capacity: 1, score: () => 0 }]).size).to.equal(0);
        });

        it("should leave proposers unmatched when no receivers exist for their preferences", () => {
            const proposers: MatchProposer[] = [
                { id: "p1", preferences: ["nonexistent"] }
            ];
            const receivers: MatchReceiver[] = [
                { id: "r1", capacity: 1, score: () => 1 }
            ];

            const result = stableMatch(proposers, receivers);
            expect(result.has("p1")).to.be.false;
        });
    });

    describe("floodFill", () => {
        it("should set origin tiles to distance 0", () => {
            const origins = [{ x: 25, y: 25 }];
            const cm = floodFill("W1N1", origins);
            expect(cm.get(25, 25)).to.equal(0);
        });

        it("should calculate correct Chebyshev distances", () => {
            const origins = [{ x: 25, y: 25 }];
            const cm = floodFill("W1N1", origins);
            // Adjacent tiles = distance 1
            expect(cm.get(24, 25)).to.equal(1);
            expect(cm.get(26, 26)).to.equal(1); // diagonal
            // Distance 2
            expect(cm.get(23, 25)).to.equal(2);
        });

        it("should handle multiple origins", () => {
            const origins = [{ x: 10, y: 10 }, { x: 40, y: 40 }];
            const cm = floodFill("W1N1", origins);
            expect(cm.get(10, 10)).to.equal(0);
            expect(cm.get(40, 40)).to.equal(0);
            expect(cm.get(11, 10)).to.equal(1);
        });

        it("should leave border tiles unreachable", () => {
            const origins = [{ x: 25, y: 25 }];
            const cm = floodFill("W1N1", origins);
            expect(cm.get(0, 0)).to.equal(255);
        });
    });
});
