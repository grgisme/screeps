import "../mock.setup";
import { expect } from "chai";
import { distanceTransform } from "../../src/utils/Algorithms";

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
});
