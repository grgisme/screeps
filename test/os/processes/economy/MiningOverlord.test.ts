import "../../../mock.setup";
import { expect } from "chai";
import { MiningOverlord } from "../../../../src/os/overlords/MiningOverlord";

describe("MiningOverlord", () => {
    let mockColony: any;
    let room: Room;
    let source: Source;
    let hatcheryQueue: any[];

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        source = {
            id: "src1" as Id<Source>,
            pos: new RoomPosition(10, 10, "W1N1"),
            energy: 3000
        } as unknown as Source;

        room.find = (type: number) => {
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "src1") return source;
            if (id === "container1") return { id: "container1", structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 1000 } };
            return null;
        };

        hatcheryQueue = [];
        mockColony = {
            name: "W1N1",
            room: room,
            hatchery: {
                enqueue: (req: any) => { hatcheryQueue.push(req); }
            },
            overlords: [],
            registerOverlord: () => { },
            getZerg: () => undefined
        };
    });

    it("should instantiate and initialize sites", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time; // Mock zergs property from base class
        overlord.init();

        expect(overlord.sites).to.have.length(1);
        expect(overlord.sites[0].sourceId).to.equal("src1");
    });

    it("should NOT request miner without a container (Genesis gate)", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;
        overlord.init();

        // No containers exist — mining should be suspended
        const minerRequest = hatcheryQueue.find(r => r.memory.role === "miner");
        expect(minerRequest).to.be.undefined;
        expect(overlord.isSuspended).to.be.true;
    });

    it("should request miner when container exists", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;
        overlord.init();

        // Simulate a built container on the site
        const site = overlord.sites[0];
        site.containerId = "container1" as Id<StructureContainer>;

        hatcheryQueue = [];
        (overlord as any).handleSpawning(site);

        const minerRequest = hatcheryQueue.find(r => r.memory.role === "miner");
        expect(minerRequest).to.not.be.undefined;
        expect(minerRequest.priority).to.equal(100);
        expect(overlord.isSuspended).to.be.false;
    });

    it("should spawn 5-WORK miner when capacity >= 700", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;

        // Set energyCapacityAvailable to 700
        (room as any).energyCapacityAvailable = 700;

        overlord.init();
        const site = overlord.sites[0];
        site.containerId = "container1" as Id<StructureContainer>;

        hatcheryQueue = [];
        (overlord as any).handleSpawning(site);

        const minerRequest = hatcheryQueue.find(r => r.memory.role === "miner");
        expect(minerRequest).to.not.be.undefined;
        // Should have 5 WORK parts + 1 CARRY + 3 MOVE
        const workParts = minerRequest.bodyTemplate.filter((p: string) => p === "work").length;
        expect(workParts).to.equal(5);
        const carryParts = minerRequest.bodyTemplate.filter((p: string) => p === "carry").length;
        expect(carryParts).to.equal(1);
    });

    it("should NOT spawn local haulers (handled by TransporterOverlord)", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;

        overlord.init();
        const site = overlord.sites[0];
        site.containerId = "container1" as Id<StructureContainer>;
        site.containerPos = new RoomPosition(11, 11, "W1N1");
        site.distance = 10;

        hatcheryQueue = [];
        (overlord as any).handleSpawning(site);

        // No hauler requests — handled globally by TransporterOverlord
        const haulerRequest = hatcheryQueue.find(r => r.memory.role === "hauler");
        expect(haulerRequest).to.be.undefined;
    });

    it("miner with CARRY should pickup dropped energy on container tile (sweep duty)", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;

        const containerPos = new RoomPosition(11, 11, "W1N1");
        const droppedResource = {
            id: "drop1",
            resourceType: RESOURCE_ENERGY,
            amount: 150,
            pos: containerPos
        };

        const container = {
            id: "container1",
            structureType: STRUCTURE_CONTAINER,
            pos: containerPos,
            hits: 250000, hitsMax: 250000,
            store: {
                [RESOURCE_ENERGY]: 500,
                getUsedCapacity: () => 500,
                getFreeCapacity: (_res?: string) => 1500 // Has room
            }
        };

        let pickupCalled = false;
        const mockNativeCreep = {
            getActiveBodyparts: (type: string) => type === CARRY ? 1 : 0,
            pickup: (_r: any) => { pickupCalled = true; return OK; },
            withdraw: () => OK,
            harvest: () => OK
        };

        // Mock the miner zerg
        const mockMiner = {
            isAlive: () => true,
            creep: mockNativeCreep,
            pos: containerPos,
            task: null,
            memory: { role: "miner", state: { siteId: "src1" } },
            store: { getFreeCapacity: () => 50, energy: 0 },
            setTask: (_t: any) => { },
            travelTo: () => { }
        } as any;

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "src1") return source;
            if (id === "container1") return container;
            return null;
        };

        // Patch containerPos.lookFor so LOOK_RESOURCES returns the dropped pile
        (containerPos as any).lookFor = (type: string) => {
            if (type === LOOK_RESOURCES) return [droppedResource];
            if (type === LOOK_TOMBSTONES) return [];
            return [];
        };
        // Patch containerPos.isEqualTo so miner.pos.isEqualTo(site.container.pos) passes
        (containerPos as any).isEqualTo = (other: any) =>
            other.x === containerPos.x && other.y === containerPos.y;

        // Push a mock site directly into overlord.sites so run() can find it by siteId
        const mockSite = {
            sourceId: "src1",
            containerId: "container1",
            get container() { return container; },
            get link() { return null; },
            get source() { return source; },
        } as any;
        overlord.sites = [mockSite];
        overlord.miners = [mockMiner];

        overlord.run();

        expect(pickupCalled).to.be.true;
    });
});
