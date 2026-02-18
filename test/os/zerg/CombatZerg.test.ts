
import { expect } from "chai";
import { CombatZerg } from "../../../src/os/zerg/CombatZerg";
import "../../mock.setup";
import { resetMocks } from "../../mock.setup";

describe("CombatZerg", () => {
    let room: Room;
    let creep: Creep;
    let combatZerg: CombatZerg;
    let hostile: Creep;

    beforeEach(() => {
        resetMocks();
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        creep = new Creep("defender1" as any);
        creep.room = room;
        creep.body = [
            { type: HEAL, hits: 100 },
            { type: RANGED_ATTACK, hits: 100 },
            { type: MOVE, hits: 100 }
        ] as any;
        creep.pos = new RoomPosition(10, 10, "W1N1");
        (globalThis as any).Game.creeps["defender1"] = creep;

        combatZerg = new CombatZerg(creep);

        hostile = new Creep("hostile1" as any);
        hostile.room = room;
        hostile.pos = new RoomPosition(10, 10, "W1N1"); // Range 0
    });

    it("should pre-heal self when damaged", () => {
        creep.hits = 50;
        creep.hitsMax = 100;
        creep.getActiveBodyparts = () => 1; // 1 HEAL part

        let healCalled = false;
        creep.heal = (target) => {
            if (target === creep) healCalled = true;
            return OK;
        };

        combatZerg.autoEngage([hostile]);

        expect(healCalled).to.be.true;
    });

    it("should attack and kite (ranged behavior)", () => {
        creep.getActiveBodyparts = (part) => {
            if (part === RANGED_ATTACK) return 1;
            if (part === ATTACK) return 0;
            return 1;
        };

        // Hostile at range 1 (too close)
        hostile.pos = new RoomPosition(11, 10, "W1N1");

        let rangedAttackCalled = false;
        creep.rangedAttack = (t) => {
            if (t === hostile) rangedAttackCalled = true;
            return OK;
        };

        let moveCalled = false; // Should flee/kite
        creep.move = () => {
            moveCalled = true;
            return OK;
        };
        // Mock pathfinder for flee
        (globalThis as any).PathFinder.search = () => ({ path: [new RoomPosition(9, 10, "W1N1")] });

        combatZerg.autoEngage([hostile]);

        expect(rangedAttackCalled).to.be.true;
        expect(moveCalled).to.be.true;
    });
});
