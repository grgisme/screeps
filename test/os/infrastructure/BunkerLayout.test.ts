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
    });

    it("should have valid coordinates within range", () => {
        // Range mostly within -6 to +6
        for (const type of Object.keys(BunkerLayout.structures) as StructureConstant[]) {
            const coords = BunkerLayout.structures[type] || [];
            for (const c of coords) {
                expect(c.x).to.be.within(-7, 7);
                expect(c.y).to.be.within(-7, 7);
            }
        }
    });
});
