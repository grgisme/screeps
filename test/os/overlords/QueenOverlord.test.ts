import "../../mock.setup";
import { expect } from "chai";
import { QueenOverlord } from "../../../src/os/overlords/QueenOverlord";
import { LogisticsNetwork } from "../../../src/os/colony/LogisticsNetwork";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStorage(energy: number, cap: number = 1000000) {
    return {
        id: "storage1",
        structureType: STRUCTURE_STORAGE,
        store: {
            getUsedCapacity: (res: string) => res === RESOURCE_ENERGY ? energy : 0,
            getFreeCapacity: (res?: string) => (!res || res === RESOURCE_ENERGY) ? cap - energy : 0,
            [RESOURCE_ENERGY]: energy,
        },
        pos: new RoomPosition(25, 27, "W1N1"),
    };
}

function makeExt(id: string, pos: RoomPosition, freeCapacity: number) {
    return {
        id,
        structureType: STRUCTURE_EXTENSION,
        store: {
            getUsedCapacity: () => 50 - freeCapacity,
            getFreeCapacity: () => freeCapacity,
            [RESOURCE_ENERGY]: 50 - freeCapacity,
        },
        pos,
    };
}

function makeTower(id: string, pos: RoomPosition, freeCapacity: number) {
    return {
        id,
        structureType: STRUCTURE_TOWER,
        store: {
            getUsedCapacity: () => 1000 - freeCapacity,
            getFreeCapacity: () => freeCapacity,
            [RESOURCE_ENERGY]: 1000 - freeCapacity,
        },
        pos,
    };
}

function makeColony(room: Room, creeps: any[] = []) {
    return {
        name: "W1N1",
        room,
        memory: { anchor: { x: 25, y: 25 } },
        creeps,
        overlords: [],
        zergs: new Map(),
        linkNetwork: null,
        hatchery: {
            spawns: [],
            extensions: [],
            enqueue: (_req: any) => { },
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("QueenOverlord", () => {
    let room: Room;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;
        (room as any).energyCapacityAvailable = 800;
        (room as any).energyAvailable = 800;

        room.find = (_type: any, _opts?: any) => [];
        (globalThis as any).Game.getObjectById = (_id: string) => null;
    });

    // ── Spawning ─────────────────────────────────────────────────────────────

    it("should NOT spawn when Storage does not exist (RCL < 4)", () => {
        (room as any).storage = null;
        const colony = makeColony(room);
        let enqueued = false;
        (colony as any).hatchery.enqueue = () => { enqueued = true; };

        const overlord = new QueenOverlord(colony as any);
        overlord.init();

        expect(enqueued).to.be.false;
    });

    it("should spawn when Storage exists (RCL 4+) and no Queen alive", () => {
        const storage = makeStorage(50000);
        (room as any).storage = storage;
        const colony = makeColony(room);
        (colony as any).creeps = [];

        let enqueuedReq: any = null;
        (colony as any).hatchery.enqueue = (req: any) => { enqueuedReq = req; };

        const overlord = new QueenOverlord(colony as any);
        overlord.queens = []; // no active queens
        (overlord as any).handleSpawning();

        expect(enqueuedReq).to.not.be.null;
        expect(enqueuedReq.memory.role).to.equal("queen");
        expect(enqueuedReq.priority).to.equal(82);
        // Body must be CARRY CARRY MOVE pattern
        const body: string[] = enqueuedReq.bodyTemplate;
        expect(body.filter((p: string) => p === CARRY).length).to.equal(
            body.filter((p: string) => p === MOVE).length * 2,
            "2:1 CARRY:MOVE ratio"
        );
    });

    it("should NOT spawn when a Queen is already alive", () => {
        const storage = makeStorage(50000);
        (room as any).storage = storage;
        const colony = makeColony(room);

        let enqueued = false;
        (colony as any).hatchery.enqueue = () => { enqueued = true; };

        const overlord = new QueenOverlord(colony as any);
        // Simulate active queen with plenty of TTL
        overlord.queens = [{
            isAlive: () => true,
            creep: { ticksToLive: 1000, body: Array(6).fill({ type: CARRY }) }
        } as any];

        (overlord as any).handleSpawning();

        expect(enqueued).to.be.false;
    });

    // ── run() task assignment ────────────────────────────────────────────────

    it("should issue WithdrawTask from Storage when empty", () => {
        const storage = makeStorage(50000);
        (room as any).storage = storage;
        const colony = makeColony(room);

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "storage1") return storage;
            return null;
        };

        const taskLog: any[] = [];
        const mockQueen: any = {
            isAlive: () => true,
            task: null,
            setTask: (t: any) => { taskLog.push(t); mockQueen.task = t; },
            store: { getUsedCapacity: () => 0, getFreeCapacity: () => 200 },
            pos: {
                getRangeTo: (_target: any) => 5,
                findClosestByRange: (_type: number, _opts?: any) => null,
            },
        };

        const overlord = new QueenOverlord(colony as any);
        overlord.queens = [mockQueen];
        overlord.run();

        expect(taskLog.length).to.equal(1);
        expect(taskLog[0].name).to.equal("Withdraw");
        expect(taskLog[0].targetId).to.equal("storage1");
    });

    it("should issue TransferTask to tower (priority 1) when loaded and tower has large deficit", () => {
        const storage = makeStorage(50000);
        (room as any).storage = storage;
        const colony = makeColony(room);

        const tower = makeTower("tower1", new RoomPosition(28, 25, "W1N1"), 500);
        const outerExt = makeExt("ext1", new RoomPosition(30, 30, "W1N1"), 50);

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "tower1") return tower;
            if (id === "ext1") return outerExt;
            return null;
        };

        const taskLog: any[] = [];
        const mockQueen: any = {
            isAlive: () => true,
            task: null,
            setTask: (t: any) => { taskLog.push(t); mockQueen.task = t; },
            store: { getUsedCapacity: () => 200, getFreeCapacity: () => 0 },
            pos: {
                getRangeTo: (_target: any) => 5,
                findClosestByRange: (_type: number, opts?: any) => {
                    if (!opts?.filter) return null;
                    // Return tower for tower query (first priority), null for others
                    if (opts.filter(tower)) return tower;
                    return null;
                },
            },
        };

        const overlord = new QueenOverlord(colony as any);
        overlord.queens = [mockQueen];
        overlord.run();

        expect(taskLog.length).to.equal(1);
        expect(taskLog[0].name).to.equal("Transfer");
        expect(taskLog[0].targetId).to.equal("tower1");
    });

    it("should issue TransferTask to outer extension when loaded and no tower deficit", () => {
        const storage = makeStorage(50000);
        (room as any).storage = storage;
        const colony = makeColony(room);

        const outerExt = makeExt("outerExt1", new RoomPosition(30, 30, "W1N1"), 50);

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "outerExt1") return outerExt;
            return null;
        };

        const taskLog: any[] = [];
        const mockQueen: any = {
            isAlive: () => true,
            task: null,
            setTask: (t: any) => { taskLog.push(t); mockQueen.task = t; },
            store: { getUsedCapacity: () => 200, getFreeCapacity: () => 0 },
            pos: {
                getRangeTo: (_target: any) => 5,
                findClosestByRange: (_type: number, opts?: any) => {
                    if (!opts?.filter) return null;
                    // Tower filter will fail (freeCapacity 0 ≤ 200), ext passes
                    if (opts.filter(outerExt)) return outerExt;
                    return null;
                },
            },
        };

        const overlord = new QueenOverlord(colony as any);
        overlord.queens = [mockQueen];
        overlord.run();

        expect(taskLog.length).to.equal(1);
        expect(taskLog[0].name).to.equal("Transfer");
        expect(taskLog[0].targetId).to.equal("outerExt1");
    });
});

// ─── LogisticsNetwork Queen integration ─────────────────────────────────────

describe("LogisticsNetwork — Queen integration", () => {
    let room: Room;
    let mockColony: any;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;
        room.find = (_type: any, _opts?: any) => [];

        mockColony = {
            room,
            name: "W1N1",
            memory: { anchor: { x: 25, y: 25 } },
            creeps: [],
            zergs: new Map(),
            linkNetwork: null,
            hatchery: { spawns: [], extensions: [] },
        };
    });

    it("should skip outer extensions when Queen is active and Storage exists", () => {
        const network = new LogisticsNetwork(mockColony);

        const outerExtId = "outerExt1" as Id<Structure | Resource>;
        const outerExt = {
            id: outerExtId,
            structureType: STRUCTURE_EXTENSION,
            pos: new RoomPosition(25, 30, "W1N1"), // range 5 from filler tile
            store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0, [RESOURCE_ENERGY]: 0 },
        };

        const storage = makeStorage(50000);
        (room as any).storage = storage;
        (mockColony as any).creeps = [
            { memory: { role: "queen" } },   // Queen alive
        ];
        (mockColony as any).hatchery = { spawns: [], extensions: [outerExt] };

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === outerExtId) return outerExt;
            return null;
        };

        (network as any).registerInfrastructure();

        const registeredIds = network.requesters.map((r: any) => r.targetId);
        expect(registeredIds).to.not.include(outerExtId,
            "Queen active + Storage: outer ext should be skipped from logistics");
    });

    it("should register outer extensions normally when NO Queen exists (RCL 3 path)", () => {
        const network = new LogisticsNetwork(mockColony);

        const outerExtId = "outerExt2" as Id<Structure | Resource>;
        const outerExt = {
            id: outerExtId,
            structureType: STRUCTURE_EXTENSION,
            pos: new RoomPosition(25, 30, "W1N1"),
            store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0, [RESOURCE_ENERGY]: 0 },
        };

        (room as any).storage = null; // No storage
        (mockColony as any).creeps = [];
        (mockColony as any).hatchery = { spawns: [], extensions: [outerExt] };

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === outerExtId) return outerExt;
            return null;
        };

        (network as any).registerInfrastructure();

        const registeredIds = network.requesters.map((r: any) => r.targetId);
        expect(registeredIds).to.include(outerExtId,
            "No Queen: outer ext must be registered for transporters to fill");
    });
});
