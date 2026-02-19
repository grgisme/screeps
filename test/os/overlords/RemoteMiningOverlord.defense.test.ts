import { expect } from "chai";
import { RemoteMiningOverlord } from "../../../src/os/overlords/RemoteMiningOverlord";
import { Colony } from "../../../src/os/colony/Colony";
import { MockColony, MockRoom, MockCreep, MockRoomPosition } from "../../mock.setup";

describe("RemoteMiningOverlord - Defense System", () => {
    let colony: Colony;
    let overlord: RemoteMiningOverlord;
    let room: any;

    beforeEach(() => {
        // Reset Game and Memory
        (global as any).Game = {
            rooms: {},
            creeps: {},
            time: 100,
            map: { getRoomTerrain: () => ({ get: () => 0 }) }
        };
        (global as any).Memory = { rooms: {} };

        // Mock Colony
        colony = new MockColony("W1N1") as any;
        colony.hatchery = { enqueue: () => { } } as any; // Mock hatchery

        // Mock Target Room
        room = new MockRoom("W2N1");
        Game.rooms["W2N1"] = room;
        room.find = (_type: number) => []; // Default: empty
        (global as any).Memory.rooms["W2N1"] = {};

        overlord = new RemoteMiningOverlord(colony, "W2N1");
    });

    it("should detect invaders and trigger alarm", () => {
        // Setup Hostile with ATTACK part
        const hostile = new MockCreep("Invader", "W2N1");
        hostile.body = [{ type: ATTACK, hits: 100 }];
        room.find = (type: number) => {
            if (type === FIND_HOSTILE_CREEPS) return [hostile];
            return [];
        };

        // Run Init
        overlord.init();

        // Check Memory
        expect(Memory.rooms["W2N1"].isDangerous).to.be.true;
        expect(Memory.rooms["W2N1"].dangerUntil).to.be.greaterThan(100);
    });

    it("should ignore harmless hostiles (scouts)", () => {
        // Setup Hostile with MOVE only
        const hostile = new MockCreep("Scout", "W2N1");
        // Wait, MockCreep might not have body property unless I set it. MockCreep usually has body array.
        (hostile as any).body = [{ type: MOVE, hits: 100 }];

        room.find = (type: number) => {
            if (type === FIND_HOSTILE_CREEPS) return [hostile];
            return [];
        };

        overlord.init();

        expect(Memory.rooms["W2N1"].isDangerous).to.be.undefined;
    });

    it("should lift alarm after danger expires", () => {
        // Setup: Alarm active, expired
        Memory.rooms["W2N1"].isDangerous = true;
        Memory.rooms["W2N1"].dangerUntil = 90; // Expired (Game.time is 100)

        // No hostiles
        room.find = (_type: number) => [];

        overlord.init();

        expect(Memory.rooms["W2N1"].isDangerous).to.be.undefined;
    });

    it("should suspend spawning when dangerous", () => {
        // Setup: Active hostile with combat parts in room
        const hostile = new MockCreep("Invader", "W2N1");
        hostile.body = [{ type: ATTACK, hits: 100 }];

        // Spy on hatchery
        let queued = false;
        colony.hatchery.enqueue = () => { queued = true; return "mock-id"; };

        // Mock sources to trigger spawn logic if it were safe
        const source = { id: "source1", pos: new MockRoomPosition(10, 10, "W2N1") };
        room.find = (type: number) => {
            if (type === FIND_HOSTILE_CREEPS) return [hostile];
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        // Also mock existing miners as empty logic to trigger spawn
        overlord.zergs = [];

        overlord.init();

        // Hostile present → isDangerous set, spawning suspended (returned early before sites loop)
        expect(Memory.rooms["W2N1"].isDangerous).to.be.true;
        expect(queued).to.be.false;
    });
});
