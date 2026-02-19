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

    it("should request hauler if capacity is low", () => {
        const overlord = new MiningOverlord(mockColony);
        (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;

        // Mock site to require power
        overlord.init();
        const site = overlord.sites[0];
        site.containerId = "container1" as Id<StructureContainer>; // Container gate requires this
        site.containerPos = new RoomPosition(11, 11, "W1N1");
        site.distance = 10;
        // Mock calculateHaulingPowerNeeded
        site.calculateHaulingPowerNeeded = () => 200;

        // Clear initial miner request
        hatcheryQueue = [];

        // Re-run init/spawn logic (conceptually)
        // MiningOverlord calls handleSpawning in init
        // We need to re-trigger it or simulate it. 
        // Actually init() only runs once usually. 
        // Let's create a new overlord for this test case or manually call handleSpawning

        (overlord as any).handleSpawning(site);

        // Should request hauler
        const haulerRequest = hatcheryQueue.find(r => r.memory.role === "hauler");
        expect(haulerRequest).to.not.be.undefined;
        expect(haulerRequest.priority).to.equal(50);
    });

    it("should not request hauler if capacity is sufficient", () => {
        const overlord = new MiningOverlord(mockColony);

        // Mock existing hauler
        const haulerCreep = {
            store: { getCapacity: () => 200 },
            memory: { role: "hauler", state: { siteId: source.id } }
        } as any;

        (overlord as any)._zergs = [{
            creepName: "hauler1",
            name: "hauler1",
            creep: haulerCreep,
            memory: haulerCreep.memory,
            store: haulerCreep.store,
            isAlive: () => true
        } as any];
        (overlord as any)._zergsTick = Game.time;
        overlord.init();
        const site = overlord.sites[0];
        site.containerPos = new RoomPosition(11, 11, "W1N1");
        site.calculateHaulingPowerNeeded = () => 200;

        hatcheryQueue = [];
        (overlord as any).handleSpawning(site);

        const haulerRequest = hatcheryQueue.find(r => r.memory.role === "hauler");
        expect(haulerRequest).to.be.undefined;
    });
});
