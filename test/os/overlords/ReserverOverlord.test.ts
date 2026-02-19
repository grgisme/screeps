import "../../mock.setup";
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { ReserverOverlord } from "../../../src/os/overlords/ReserverOverlord";

describe("ReserverOverlord", () => {
    let mockColony: any;
    let hatcheryQueue: any[];

    beforeEach(() => {
        resetMocks();
        hatcheryQueue = [];

        const homeRoom = new Room("W1N1");
        homeRoom.find = (type: number) => {
            if (type === FIND_MY_SPAWNS) return [{ pos: new RoomPosition(25, 25, "W1N1") }];
            return [];
        };
        (homeRoom as any).energyAvailable = 1300;
        (homeRoom as any).energyCapacityAvailable = 1300;
        (globalThis as any).Game.rooms["W1N1"] = homeRoom;

        mockColony = {
            name: "W1N1",
            room: homeRoom,
            overlords: [],
            registerOverlord: () => { },
            hatchery: {
                enqueue: (req: any) => { hatcheryQueue.push(req); return req.name; }
            }
        };
    });

    it("should calculate threshold as Distance + SpawnTime + 500", () => {
        const overlord = new ReserverOverlord(mockColony, "W2N1", 50);
        // Threshold = 50 + 12 + 500 = 562
        expect(overlord.getThreshold()).to.equal(562);
    });

    it("should request reserver when ticksToEnd is below threshold", () => {
        const distance = 50;
        const overlord = new ReserverOverlord(mockColony, "W2N1", distance);
        overlord.zergs = [];

        // Make remote room visible with controller reservation below threshold
        const remoteRoom = new Room("W2N1");
        (remoteRoom as any).controller = {
            pos: new RoomPosition(25, 25, "W2N1"),
            reservation: { ticksToEnd: 400, username: "TestUser" } // Below 562 threshold
        };
        (globalThis as any).Game.rooms["W2N1"] = remoteRoom;

        overlord.init();

        expect(hatcheryQueue).to.have.length(1);
        expect(hatcheryQueue[0].memory.role).to.equal("reserver");
        expect(hatcheryQueue[0].bodyTemplate).to.deep.equal([CLAIM, CLAIM, MOVE, MOVE]);
    });

    it("should NOT request reserver when ticksToEnd is above threshold", () => {
        const distance = 50;
        const overlord = new ReserverOverlord(mockColony, "W2N1", distance);
        overlord.zergs = [];

        // Make remote room visible with controller reservation above threshold
        const remoteRoom = new Room("W2N1");
        (remoteRoom as any).controller = {
            pos: new RoomPosition(25, 25, "W2N1"),
            reservation: { ticksToEnd: 3000, username: "TestUser" } // Well above 562 threshold
        };
        (globalThis as any).Game.rooms["W2N1"] = remoteRoom;

        overlord.init();

        expect(hatcheryQueue).to.have.length(0);
    });

    it("should request reserver when no reservation exists", () => {
        const distance = 50;
        const overlord = new ReserverOverlord(mockColony, "W2N1", distance);
        overlord.zergs = [];

        // Make remote room visible with NO reservation
        const remoteRoom = new Room("W2N1");
        (remoteRoom as any).controller = {
            pos: new RoomPosition(25, 25, "W2N1"),
            reservation: undefined
        };
        (globalThis as any).Game.rooms["W2N1"] = remoteRoom;

        overlord.init();

        // ticksToEnd=0 < 562 → should request
        expect(hatcheryQueue).to.have.length(1);
    });

    it("should not request reserver when one is already alive", () => {
        const distance = 50;
        const overlord = new ReserverOverlord(mockColony, "W2N1", distance);
        overlord.zergs = [{ memory: { role: "reserver" } }] as any;

        const remoteRoom = new Room("W2N1");
        (remoteRoom as any).controller = {
            pos: new RoomPosition(25, 25, "W2N1"),
            reservation: { ticksToEnd: 100, username: "TestUser" }
        };
        (globalThis as any).Game.rooms["W2N1"] = remoteRoom;

        overlord.init();

        expect(hatcheryQueue).to.have.length(0); // Already has one
    });

    it("should scale threshold with distance", () => {
        const short = new ReserverOverlord(mockColony, "W2N1", 20);
        const long = new ReserverOverlord(mockColony, "W3N1", 150);

        // short: 20 + 12 + 500 = 532
        expect(short.getThreshold()).to.equal(532);
        // long: 150 + 12 + 500 = 662
        expect(long.getThreshold()).to.equal(662);
    });
});
