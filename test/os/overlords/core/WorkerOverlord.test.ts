import { expect } from "chai";
import { WorkerOverlord } from "../../../../src/os/overlords/core/WorkerOverlord";
import { MiningOverlord } from "../../../../src/os/overlords/MiningOverlord";
import { Colony } from "../../../../src/os/colony/Colony";
import { MockColony, MockRoom, MockCreep } from "../../../mock.setup";

describe("WorkerOverlord", () => {
    let colony: Colony;
    let overlord: WorkerOverlord;
    let mockMiningOverlord: any;

    beforeEach(() => {
        // Reset Global Mocks
        (global as any).Game = {
            rooms: {},
            creeps: {},
            time: 100
        };
        (global as any).Memory = {
            creeps: {},
            rooms: {}
        };

        // Setup Mock Room
        const room = new MockRoom("W1N1");
        Game.rooms["W1N1"] = room as any;
        room.find = (_: number) => [];

        // Setup Mock Colony
        colony = new MockColony("W1N1") as any;
        colony.room = room as any;
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
        colony.room.find = (type: number) => {
            if (type === FIND_MY_CREEPS) return [orphan];
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
        // Total remaining = 6000. 6000 / 2000 = 3 extras + 4 base (suspended) = 7 -> cap 6.

        colony.room.find = (type: number) => {
            if (type === FIND_MY_CONSTRUCTION_SITES) return [site1, site2];
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

    it("should cap workers at 5 when mining is active", () => {
        // Give MiningOverlord a site with a container (mining active)
        mockMiningOverlord.sites = [{ container: { id: "c1" }, link: undefined }];

        // Mock massive construction
        const site = { progress: 0, progressTotal: 50000 }; // 25 extras -> Cap 5

        colony.room.find = (type: number) => {
            if (type === FIND_MY_CONSTRUCTION_SITES) return [site];
            return [];
        };

        let request: any = null;
        colony.hatchery.enqueue = (req: any) => { request = req; return "test"; };

        overlord.init();

        expect(request).to.not.be.null;
    });

    it("should spawn workers at high priority when mining is suspended (Genesis)", () => {
        // MiningOverlord has no containers → isSuspended = true
        mockMiningOverlord.sites = [{ container: undefined, link: undefined }];

        colony.room.find = (_type: number) => [];

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

