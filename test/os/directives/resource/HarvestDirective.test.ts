import "../../../mock.setup";
import { resetMocks } from "../../../mock.setup";
import { expect } from "chai";
import { HarvestDirective } from "../../../../src/os/directives/resource/HarvestDirective";

describe("HarvestDirective", () => {
    let mockColony: any;
    let mockFlag: any;
    let hatcheryQueue: any[];
    let logOutput: string[];

    beforeEach(() => {
        resetMocks();
        logOutput = [];
        console.log = (...args: any[]) => { logOutput.push(args.join(" ")); };

        hatcheryQueue = [];

        const homeRoom = new Room("W1N1");
        const spawn = {
            id: "spawn1" as any,
            pos: new RoomPosition(25, 25, "W1N1"),
            structureType: "spawn",
            store: { getFreeCapacity: () => 0 }
        };

        homeRoom.find = (type: number) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_SOURCES) return [];
            if (type === FIND_MY_CREEPS) return [];
            if (type === FIND_MY_STRUCTURES) return [];
            return [];
        };

        (homeRoom as any).energyAvailable = 300;
        (homeRoom as any).energyCapacityAvailable = 300;
        (globalThis as any).Game.rooms["W1N1"] = homeRoom;

        mockColony = {
            name: "W1N1",
            room: homeRoom,
            overlords: [],
            directives: [],
            zergs: new Map(),
            registerOverlord: (o: any) => { mockColony.overlords.push(o); },
            hatchery: {
                enqueue: (req: any) => { hatcheryQueue.push(req); return req.name; }
            },
            logistics: {
                requestInput: () => { },
                refresh: () => { },
                init: () => { }
            }
        };

        mockFlag = {
            name: "inc:W2N1",
            pos: new RoomPosition(25, 25, "W1N1"),
            color: 1,
            secondaryColor: 1
        };
    });

    it("should spawn ScoutOverlord when target room is invisible", () => {
        const directive = new HarvestDirective(mockFlag, mockColony);
        directive.init();

        // Should have registered a ScoutOverlord
        expect(mockColony.overlords).to.have.length(1);
        expect(mockColony.overlords[0].processId).to.equal("scout_W2N1");
    });

    it("should not spawn RemoteMiningOverlord when room is invisible", () => {
        const directive = new HarvestDirective(mockFlag, mockColony);
        directive.init();

        // Should only have scout, not mining or reserver
        const processIds = mockColony.overlords.map((o: any) => o.processId);
        expect(processIds).to.not.include("remoteMining_W2N1");
        expect(processIds).to.not.include("reserver_W2N1");
    });

    it("should spawn RemoteMiningOverlord and ReserverOverlord when room is visible", () => {
        // Make target room visible
        const remoteRoom = new Room("W2N1");
        const source = {
            id: "remoteSrc1" as Id<Source>,
            pos: new RoomPosition(10, 10, "W2N1"),
            energy: 3000
        } as unknown as Source;
        remoteRoom.find = (type: number) => {
            if (type === FIND_SOURCES) return [source];
            return [];
        };
        (remoteRoom as any).controller = {
            my: false,
            pos: new RoomPosition(25, 25, "W2N1"),
            reservation: { ticksToEnd: 100, username: "TestUser" }
        };
        (globalThis as any).Game.rooms["W2N1"] = remoteRoom;

        const directive = new HarvestDirective(mockFlag, mockColony);
        directive.init();

        const processIds = mockColony.overlords.map((o: any) => o.processId);
        expect(processIds).to.include("remoteMining_W2N1");
        expect(processIds).to.include("reserver_W2N1");
    });

    it("should log the required console message on initialization", () => {
        const remoteRoom = new Room("W2N1");
        remoteRoom.find = (type: number) => {
            if (type === FIND_SOURCES) return [];
            return [];
        };
        (remoteRoom as any).controller = {
            my: false,
            pos: new RoomPosition(25, 25, "W2N1"),
            reservation: { ticksToEnd: 4500, username: "TestUser" }
        };
        (globalThis as any).Game.rooms["W2N1"] = remoteRoom;

        const directive = new HarvestDirective(mockFlag, mockColony);
        directive.init();

        const logMsg = logOutput.find(l => l.includes("Directive: Remote Mining initiated"));
        expect(logMsg).to.exist;
        expect(logMsg).to.include("W2N1");
        expect(logMsg).to.include("Reservation Status: 4500");
    });
});
