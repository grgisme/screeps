
import { expect } from "chai";
import { CombatZerg } from "../../../src/os/zerg/CombatZerg";
import "../../mock.setup";
import { resetMocks } from "../../mock.setup";

describe("CombatZerg", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("should be an instance of CombatZerg and resolve a live creep", () => {
        const creep = new Creep("defender1" as any);
        creep.pos = new RoomPosition(10, 10, "W1N1");
        (globalThis as any).Game.creeps["defender1"] = creep;

        const combatZerg = new CombatZerg("defender1");

        expect(combatZerg).to.be.instanceOf(CombatZerg);
        expect(combatZerg.creepName).to.equal("defender1");
        expect(combatZerg.isAlive()).to.be.true;
        expect(combatZerg.creep).to.equal(creep);
    });

    it("should report dead when creep is not in Game.creeps", () => {
        const combatZerg = new CombatZerg("ghost");

        expect(combatZerg.isAlive()).to.be.false;
        expect(combatZerg.creep).to.be.undefined;
    });

    it("should not have autonomous combat methods (IoC enforcement)", () => {
        const combatZerg = new CombatZerg("defender1");

        // CombatZerg is now an empty shell — no autoEngage, kite, or flee
        expect((combatZerg as any).autoEngage).to.be.undefined;
        expect((combatZerg as any).kite).to.be.undefined;
    });
});
