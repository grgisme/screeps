import "../../mock.setup";
import { expect } from "chai";
import { BootstrappingOverlord } from "../../../src/os/overlords/BootstrappingOverlord";

describe("BootstrappingOverlord", () => {
    let mockColony: any;
    let room: Room;
    let spawn: StructureSpawn;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        spawn = {
            id: "spawn1" as Id<StructureSpawn>,
            structureType: STRUCTURE_SPAWN,
            spawning: null,
            store: { getFreeCapacity: () => 300 },
            pos: {
                getRangeTo: (_other: any) => 5,
                isNearTo: (_other: any) => false,
                inRangeTo: (_other: any, _range: number) => false
            }
        } as unknown as StructureSpawn;

        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_STRUCTURES) return [];
            if (type === FIND_MY_CREEPS) return [];
            if (type === FIND_DROPPED_RESOURCES) return [];
            if (type === FIND_TOMBSTONES) return [];
            return [];
        };
        room.energyAvailable = 1000;
        room.energyCapacityAvailable = 1000;

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "spawn1") return spawn;
            return null;
        };

        mockColony = {
            name: "W1N1",
            room: room,
            get creeps() { return []; },
            overlords: [],
            refillOrder: ["spawn1" as Id<StructureSpawn>],
            state: { isCriticalBlackout: false, rclChanged: false },
            hatchery: {
                spawns: [spawn],
                enqueue: (_req: any) => { },
                queue: []
            },
            logistics: { requestInput: () => { } },
            zergs: new Map()
        };
    });

    // ── init() tests ────────────────────────────────────────────────────────

    it("should not enqueue anything when isCriticalBlackout is false", () => {
        mockColony.state.isCriticalBlackout = false;

        let enqueueCalled = false;
        mockColony.hatchery.enqueue = () => { enqueueCalled = true; };

        const overlord = new BootstrappingOverlord(mockColony);
        overlord.init();

        expect(enqueueCalled).to.equal(false);
    });

    it("should enqueue [CARRY, MOVE] Hauler at priority 999 when buffer energy exists and energy >= 100", () => {
        mockColony.state.isCriticalBlackout = true;
        room.energyAvailable = 100;

        // Dropped energy > 50 counts as buffer energy
        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_STRUCTURES) return [];
            if (type === FIND_DROPPED_RESOURCES) return [{ id: "res1", resourceType: RESOURCE_ENERGY, amount: 80 }];
            if (type === FIND_TOMBSTONES) return [];
            return [];
        };

        let enqueuedRequest: any = null;
        mockColony.hatchery.enqueue = (req: any) => { enqueuedRequest = req; };

        const overlord = new BootstrappingOverlord(mockColony);
        overlord.init();

        expect(enqueuedRequest).to.not.be.null;
        expect(enqueuedRequest.priority).to.equal(999);
        expect(enqueuedRequest.bodyTemplate).to.deep.equal([CARRY, MOVE]);
        expect(enqueuedRequest.memory.role).to.equal("bootstrapper");
    });

    it("should enqueue [WORK, CARRY, MOVE] Pioneer at priority 999 when no buffer energy", () => {
        mockColony.state.isCriticalBlackout = true;
        room.energyAvailable = 300;

        // No dropped energy, no tombstones, no containers
        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_STRUCTURES) return [];
            if (type === FIND_DROPPED_RESOURCES) return [];
            if (type === FIND_TOMBSTONES) return [];
            return [];
        };

        let enqueuedRequest: any = null;
        mockColony.hatchery.enqueue = (req: any) => { enqueuedRequest = req; };

        const overlord = new BootstrappingOverlord(mockColony);
        overlord.init();

        expect(enqueuedRequest).to.not.be.null;
        expect(enqueuedRequest.priority).to.equal(999);
        expect(enqueuedRequest.bodyTemplate).to.deep.equal([WORK, CARRY, MOVE]);
    });

    it("should still enqueue when energy < 200 and no buffer (Hatchery will wait)", () => {
        mockColony.state.isCriticalBlackout = true;
        room.energyAvailable = 50; // Not enough for anything yet

        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_STRUCTURES) return [];
            if (type === FIND_DROPPED_RESOURCES) return [];
            if (type === FIND_TOMBSTONES) return [];
            return [];
        };

        let enqueuedRequest: any = null;
        mockColony.hatchery.enqueue = (req: any) => { enqueuedRequest = req; };

        const overlord = new BootstrappingOverlord(mockColony);
        overlord.init();

        // Should still enqueue so Hatchery stockpiles energy toward this request
        expect(enqueuedRequest).to.not.be.null;
        expect(enqueuedRequest.priority).to.equal(999);
        expect(enqueuedRequest.bodyTemplate).to.deep.equal([WORK, CARRY, MOVE]);
    });

    it("should not double-enqueue when a bootstrapper is already alive", () => {
        mockColony.state.isCriticalBlackout = true;

        let enqueuedCount = 0;
        mockColony.hatchery.enqueue = () => { enqueuedCount++; };

        const overlord = new BootstrappingOverlord(mockColony);

        // Simulate a live bootstrapper by registering a mock zerg
        (overlord as any)._zergs = [
            { isAlive: () => true, name: "bootstrap_pioneer_W1N1_1", memory: { _overlord: "bootstrapping" } }
        ];
        (overlord as any)._zergsTick = Game.time;

        overlord.init();

        expect(enqueuedCount).to.equal(0);
    });

    // ── run() tests ─────────────────────────────────────────────────────────

    it("should issue TransferTask to spawn (index 0 of refillOrder) when loaded", () => {
        // Set up a bootstrapper with full energy
        const creepMock = {
            name: "bootstrap_pioneer_W1N1_1",
            spawning: false,
            store: {
                getUsedCapacity: () => 50,
                getFreeCapacity: () => 0
            },
            getActiveBodyparts: (part: BodyPartConstant) => part === WORK ? 1 : 0,
            room: room,
            say: () => { }
        } as unknown as Creep;

        (globalThis as any).Game.creeps["bootstrap_pioneer_W1N1_1"] = creepMock;

        const mockZerg: any = {
            name: "bootstrap_pioneer_W1N1_1",
            isAlive: () => true,
            get creep() { return creepMock; },
            get pos() { return { inRangeTo: () => false, findClosestByRange: () => null }; },
            get memory() { return creepMock.memory; },
            get store() { return creepMock.store; },
            task: null,
            setTask: function (t: any) { this.task = t; },
            travelTo: () => { }
        };

        const overlord = new BootstrappingOverlord(mockColony);
        (overlord as any)._zergs = [mockZerg];
        (overlord as any)._zergsTick = Game.time;
        overlord.bootstrappers = [mockZerg];

        (creepMock as any).memory = { _overlord: "bootstrapping", collecting: false };

        overlord.run();

        expect(mockZerg.task).to.not.be.null;
        expect(mockZerg.task?.name).to.equal("Transfer");
    });
});
