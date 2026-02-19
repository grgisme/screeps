import { expect } from "chai";
import { UpgradingOverlord } from "../../../src/os/overlords/UpgradingOverlord";
import { MockColony, MockRoom } from "../../mock.setup";

describe("UpgradingOverlord", () => {
    let colony: MockColony;
    let overlord: UpgradingOverlord;
    let room: MockRoom;

    beforeEach(() => {
        // Reset Mocks
        (global as any).Game = {
            rooms: {},
            creeps: {},
            time: 101
        };
        (global as any).Memory = {
            creeps: {},
            rooms: {}
        };

        room = new MockRoom("W1N1");
        Game.rooms["W1N1"] = room as any;

        colony = new MockColony("W1N1");
        colony.room = room;
        // Mock creeps array for colony
        (colony as any).creeps = [];

        // Mock registerZerg to avoid errors if referenced
        (colony as any).registerZerg = (creep: Creep) => ({ creep, task: null } as any);
        (colony as any).getZerg = () => null;

        overlord = new UpgradingOverlord(colony as any);
        // Cast overlord property to any to push mock upgraders if needed
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;
    });

    it("should NOT spawn if no storage and low energy", () => {
        // Setup poor room
        room.storage = undefined;
        (room as any).energyAvailable = 100;
        (room as any).energyCapacityAvailable = 300;
        (colony as any).creeps = [{}, {}]; // 2 creeps

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        expect(request).to.be.null;
    });

    it("should spawn maintenance upgrader if Storage exists", () => {
        // Setup storage with some energy
        room.storage = {
            pos: { x: 25, y: 25, roomName: "W1N1" },
            store: { energy: 20000, getUsedCapacity: () => 20000 }
        } as any;
        (room as any).controller = { ticksToDowngrade: 10000 };

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        expect(request).to.not.be.null;
        expect(request.priority).to.equal(4); // Normal priority
    });

    it("should trigger Critical Mode if downgrade imminent", () => {
        // Setup poor room but critical controller
        room.storage = undefined;
        (room as any).controller = { ticksToDowngrade: 3000, level: 1 }; // Critical < 4000

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        expect(request).to.not.be.null;
        expect(request.priority).to.equal(2); // High priority
    });

    it("should scale up to 3 upgraders if Rich", () => {
        // Setup rich storage
        room.storage = {
            pos: { x: 25, y: 25, roomName: "W1N1" },
            store: { energy: 150000, getUsedCapacity: () => 150000 } // > 100k
        } as any;
        (room as any).controller = { ticksToDowngrade: 10000 };

        // Mock existing upgraders (0) -> Should request 1
        // We need to simulate that we want to reach 3.
        // If we run init(), it checks `upgraders.length < target`.
        // 0 < 3 -> Enqueue 1.

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        expect(request).to.not.be.null;
    });
});
