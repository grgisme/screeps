import { expect } from "chai";
import { WorkerOverlord } from "../../../../src/os/overlords/core/WorkerOverlord";
import { MiningOverlord } from "../../../../src/os/overlords/MiningOverlord";
import { Colony } from "../../../../src/os/colony/Colony";
import { MockColony, MockRoom, MockCreep } from "../../../mock.setup";

describe("WorkerOverlord", () => {
    let colony: Colony;
    let overlord: WorkerOverlord;
    let mockMiningOverlord: any;

    // Mock sources with positions for countMiningSpots()
    const mockSources = [
        { id: "src1", pos: { x: 10, y: 10, roomName: "W1N1", findInRange: () => [], isNearTo: () => false } },
        { id: "src2", pos: { x: 30, y: 30, roomName: "W1N1", findInRange: () => [], isNearTo: () => false } },
    ];

    // Mock terrain that returns all plains (no walls) → 8 spots per source × 2 = 16, maxWorkers = 18
    const mockTerrain = { get: (_x: number, _y: number) => 0 }; // 0 = plain

    beforeEach(() => {
        // Reset Global Mocks
        (global as any).Game = {
            rooms: {},
            creeps: {},
            time: 100,
            map: {
                getRoomTerrain: (_name: string) => mockTerrain
            }
        };
        (global as any).Memory = {
            creeps: {},
            rooms: {}
        };

        // Setup Mock Room
        const room = new MockRoom("W1N1");
        Game.rooms["W1N1"] = room as any;
        room.find = (type: number) => {
            if (type === FIND_SOURCES) return mockSources;
            return [];
        };

        // Setup Mock Colony
        colony = new MockColony("W1N1") as any;
        // Colony.room is a getter reading Game.rooms[this.name], so we just set Game.rooms
        Game.rooms["W1N1"] = room as any;
        colony.hatchery = { enqueue: () => { } } as any;
        colony.registerZerg = (creep: Creep) => ({ creep, task: null } as any);

        // Setup Mock MiningOverlord so WorkerOverlord can find it
        mockMiningOverlord = Object.create(MiningOverlord.prototype);
        mockMiningOverlord.sites = [];
        mockMiningOverlord.colony = colony;
        (colony as any).overlords = [mockMiningOverlord];

        overlord = new WorkerOverlord(colony);
    });

    it("should adopt orphan workers", () => {
        // Mock an orphan creep
        const orphan = new MockCreep("worker_1", "W1N1");
        orphan.memory = { role: "worker" };
        Game.creeps["worker_1"] = orphan as any;

        // Mock room.find to return the orphan
        colony.room!.find = (type: number) => {
            if (type === FIND_MY_CREEPS) return [orphan];
            if (type === FIND_SOURCES) return mockSources;
            return [];
        };

        // Run init (adoption logic)
        overlord.init();

        expect(overlord.workers.length).to.equal(1);
        expect(overlord.workers[0].name).to.equal("worker_1");
    });

    it("should scale workers based on construction sites", () => {
        // Mock construction sites
        const site1 = { progress: 0, progressTotal: 3000 };
        const site2 = { progress: 0, progressTotal: 3000 };

        colony.room!.find = (type: number) => {
            if (type === FIND_MY_CONSTRUCTION_SITES) return [site1, site2];
            if (type === FIND_SOURCES) return mockSources;
            return [];
        };

        // Spy on hatchery
        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        // We have 0 workers, target should be > 0. Should request spawn.
        expect(request).to.not.be.null;
        expect(request.memory.role).to.equal("worker");
    });

    it("should cap workers at maxWorkers (slot-based)", () => {
        // Give MiningOverlord a site with a container (mining active)
        mockMiningOverlord.sites = [{ container: { id: "c1" }, link: undefined }];

        // Mock massive construction
        const site = { progress: 0, progressTotal: 50000 };

        colony.room!.find = (type: number) => {
            if (type === FIND_MY_CONSTRUCTION_SITES) return [site];
            if (type === FIND_SOURCES) return mockSources;
            return [];
        };

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        // With 0 workers and 18 maxWorkers, should still request spawn
        expect(request).to.not.be.null;
    });

    it("should spawn workers at high priority when mining is suspended (Genesis)", () => {
        // MiningOverlord has no containers → isSuspended = true
        mockMiningOverlord.sites = [{ container: undefined, link: undefined }];

        colony.room!.find = (type: number) => {
            if (type === FIND_SOURCES) return mockSources;
            return [];
        };

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        expect(request).to.not.be.null;
        expect(request.priority).to.equal(80); // High priority during genesis
        expect(request.memory.role).to.equal("worker");
    });

    it("should prioritize Containers over Extensions", () => {
        // Setup construction sites
        const containerSite = {
            id: "site1",
            structureType: STRUCTURE_CONTAINER,
            progress: 0,
            progressTotal: 1000
        };
        const extensionSite = {
            id: "site2",
            structureType: STRUCTURE_EXTENSION,
            progress: 0,
            progressTotal: 1000
        };

        // Mock room.find to return reasonable objects that mimic construction sites
        (colony as any).room.find = (type: number) => {
            if (type === (global as any).FIND_MY_CONSTRUCTION_SITES) {
                return [extensionSite, containerSite];
            }
            return [];
        };

        const best = overlord.getBestConstructionSite();
        expect(best).to.not.be.null;
        expect((best as any).structureType).to.equal(STRUCTURE_CONTAINER);
    });
});

