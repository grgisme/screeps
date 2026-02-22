import { expect } from "chai";
import { WorkerOverlord } from "../../../src/os/overlords/WorkerOverlord";
import { MiningOverlord } from "../../../src/os/overlords/MiningOverlord";
import { Colony } from "../../../src/os/colony/Colony";
import { MockColony, MockRoom, MockCreep } from "../../mock.setup";

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
        // Reset Global Mocks — use time NOT divisible by 100 to skip adoptOrphans throttle
        (global as any).Game = {
            rooms: {},
            creeps: {},
            time: 101,
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
        Game.rooms["W1N1"] = room as any;
        colony.hatchery = { enqueue: () => { } } as any;
        colony.registerZerg = ((creep: any) => ({ creepName: creep.name, name: creep.name, creep, task: null, isAlive: () => true, memory: creep.memory, store: creep.store, pos: creep.pos })) as any;
        // Provide creeps array for adoptOrphans
        (colony as any).creeps = [];
        (colony as any).getZerg = () => null;

        // Setup Mock MiningOverlord so WorkerOverlord can find it
        mockMiningOverlord = Object.create(MiningOverlord.prototype);
        mockMiningOverlord.sites = [];
        mockMiningOverlord.colony = colony;
        (colony as any).overlords = [mockMiningOverlord];

        overlord = new WorkerOverlord(colony);
    });

    it("should adopt workers via subreaper _overlord tag", () => {
        // Simulate a creep with the correct _overlord tag
        const workerCreep = new MockCreep("worker_1", "W1N1");
        workerCreep.memory = { role: "worker", _overlord: `worker:${colony.name}` };
        Game.creeps["worker_1"] = workerCreep as any;

        // Register the creep in colony.creeps
        (colony as any).creeps = [workerCreep];

        // Set up the subreaper backing field with a mock zerg
        const mockZerg = {
            creepName: "worker_1",
            name: "worker_1",
            creep: workerCreep,
            memory: workerCreep.memory,
            store: workerCreep.store,
            isAlive: () => true
        } as any;
        (overlord as any)._zergs = [mockZerg]; (overlord as any)._zergsTick = Game.time;

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

    it("should prioritize Spawns over Extensions", () => {
        // Setup construction sites
        const spawnSite = {
            id: "site1",
            structureType: STRUCTURE_SPAWN,
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
                return [extensionSite, spawnSite];
            }
            return [];
        };

        // RCL1 guard returns null — set level to 2 so site priority logic actually runs
        (colony as any).room.controller = { level: 2, my: true };

        // Bump tick to invalidate per-tick memoization cache
        (global as any).Game.time = 999;

        const best = overlord.getBestConstructionSite();
        expect(best).to.not.be.null;
        expect((best as any).structureType).to.equal(STRUCTURE_SPAWN);
    });
});
