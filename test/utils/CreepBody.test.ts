import "../mock.setup";
import { expect } from "chai";
import { CreepBody } from "../../src/utils/CreepBody";

describe("CreepBody", () => {

    it("should return empty array for empty template", () => {
        const result = CreepBody.grow([], 1000);
        expect(result).to.deep.equal([]);
    });

    it("should grow body within energy limit", () => {
        // [WORK, CARRY, MOVE] = 100 + 50 + 50 = 200
        const template = [WORK, CARRY, MOVE];
        const result = CreepBody.grow(template, 500);
        // Should be 2 repeats: 400 cost. 3 repeats = 600 (too much).
        expect(result).to.have.length(6);
        expect(result.filter(p => p === WORK)).to.have.length(2);
    });

    it("should cap at 50 parts", () => {
        const template = [MOVE]; // 50 cost
        const result = CreepBody.grow(template, 50000); // Plenty of energy
        expect(result).to.have.length(50);
    });

    it("should sort TOUGH parts to the front", () => {
        const template = [TOUGH, MOVE, ATTACK];
        const result = CreepBody.grow(template, 200); // 10+50+80=140. 1 repeat.

        // grow returns sorted.
        expect(result[0]).to.equal(TOUGH);
        // MOVE should be last based on current sort logic
        expect(result[result.length - 1]).to.equal(MOVE);
    });
});
