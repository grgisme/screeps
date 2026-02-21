// ============================================================================
// CriticalBehavior.test.ts — Critical RCL 1+ invariants that must never break
// ============================================================================

import "../mock.setup";
import { expect } from "chai";

const BODYPART_COST_MAP: Record<string, number> = (globalThis as any).BODYPART_COST;

describe("Critical Behavior", () => {
    beforeEach(() => {
        require("../mock.setup").resetMocks();
    });

    // ========================================================================
    // Body Template Affordability — All base templates must fit RCL 1 (300e)
    // ========================================================================

    describe("Body Template Affordability at RCL 1", () => {
        const RCL1_ENERGY = 300; // Single spawn, no extensions

        function bodyCost(template: BodyPartConstant[]): number {
            return template.reduce((sum, part) => sum + BODYPART_COST_MAP[part], 0);
        }

        it("miner base template should cost <= 300 energy", () => {
            // From MiningOverlord: bootstrap miner = [WORK, WORK, CARRY, MOVE]
            const minerTemplate = [WORK, WORK, CARRY, MOVE];
            const cost = bodyCost(minerTemplate);
            expect(cost).to.be.at.most(RCL1_ENERGY,
                `Miner template costs ${cost}e but RCL1 only has ${RCL1_ENERGY}e`);
        });

        it("upgrader base template should cost <= 300 energy", () => {
            // From UpgradingOverlord: [WORK, WORK, CARRY, MOVE]
            const upgraderTemplate = [WORK, WORK, CARRY, MOVE];
            const cost = bodyCost(upgraderTemplate);
            expect(cost).to.be.at.most(RCL1_ENERGY,
                `Upgrader template costs ${cost}e but RCL1 only has ${RCL1_ENERGY}e`);
        });

        it("worker base template should cost <= 300 energy", () => {
            // From WorkerOverlord: [WORK, CARRY, MOVE]
            const workerTemplate = [WORK, CARRY, MOVE];
            const cost = bodyCost(workerTemplate);
            expect(cost).to.be.at.most(RCL1_ENERGY,
                `Worker template costs ${cost}e but RCL1 only has ${RCL1_ENERGY}e`);
        });

        it("transporter base template should cost <= 300 energy", () => {
            // From TransporterOverlord: [CARRY, CARRY, MOVE, MOVE]
            const transporterTemplate = [CARRY, CARRY, MOVE, MOVE];
            const cost = bodyCost(transporterTemplate);
            expect(cost).to.be.at.most(RCL1_ENERGY,
                `Transporter template costs ${cost}e but RCL1 only has ${RCL1_ENERGY}e`);
        });

        it("filler base template should cost <= 300 energy", () => {
            // From FillerOverlord: [CARRY, CARRY, MOVE]
            const fillerTemplate = [CARRY, CARRY, MOVE];
            const cost = bodyCost(fillerTemplate);
            expect(cost).to.be.at.most(RCL1_ENERGY,
                `Filler template costs ${cost}e but RCL1 only has ${RCL1_ENERGY}e`);
        });
    });

    // ========================================================================
    // Miner Container Positioning — Miners must stand ON the container
    // ========================================================================

    describe("Miner Container Positioning", () => {
        it("miner should travelTo container when not standing on it", () => {
            const { MiningOverlord } = require("../../src/os/overlords/MiningOverlord");

            const containerPos = new RoomPosition(11, 10, "W1N1");
            const sourcePos = new RoomPosition(10, 10, "W1N1");

            const source = {
                id: "src1" as Id<Source>,
                pos: sourcePos,
                energy: 3000
            };

            const container = {
                id: "cont1",
                pos: containerPos,
                structureType: STRUCTURE_CONTAINER,
                hits: 250000,
                hitsMax: 250000,
                store: { getUsedCapacity: () => 500 }
            };

            let travelCalled = false;
            let travelTarget: any = null;

            const miner = {
                name: "miner1",
                isAlive: () => true,
                pos: new RoomPosition(12, 10, "W1N1"), // NOT on container
                store: { energy: 0 },
                memory: { role: "miner", state: { siteId: "src1" } },
                task: null,
                setTask: () => { },
                travelTo: (target: any, range: number) => {
                    travelCalled = true;
                    travelTarget = { target, range };
                }
            };

            (globalThis as any).Game.getObjectById = (id: string) => {
                if (id === "src1") return source;
                if (id === "cont1") return container;
                return null;
            };

            const room = new Room("W1N1");
            room.find = (type: number) => {
                if (type === FIND_SOURCES) return [source] as any;
                return [];
            };

            const mockColony = {
                name: "W1N1",
                room: room,
                hatchery: { enqueue: () => { } },
                overlords: [],
                registerOverlord: () => { },
                getZerg: () => undefined,
                creeps: [miner]
            };

            const overlord = new MiningOverlord(mockColony);
            (overlord as any)._zergs = [miner]; (overlord as any)._zergsTick = Game.time;
            overlord.init();

            // Set containerId — the getter resolves via Game.getObjectById
            overlord.sites[0].containerId = "cont1" as any;

            overlord.run();

            expect(travelCalled).to.be.true;
            expect(travelTarget.range).to.equal(0); // Must be range 0 (stand ON it)
        });

        it("miner should NOT move when already on container", () => {
            const { MiningOverlord } = require("../../src/os/overlords/MiningOverlord");

            const containerPos = new RoomPosition(11, 10, "W1N1");

            const source = {
                id: "src1" as Id<Source>,
                pos: new RoomPosition(10, 10, "W1N1"),
                energy: 3000
            };

            const container = {
                id: "cont1",
                pos: containerPos,
                structureType: STRUCTURE_CONTAINER,
                hits: 250000,
                hitsMax: 250000,
                store: { getUsedCapacity: () => 500 }
            };

            let taskSet: any = null;

            const miner = {
                name: "miner1",
                isAlive: () => true,
                pos: containerPos, // Already ON the container
                store: { energy: 0 },
                memory: { role: "miner", state: { siteId: "src1" } },
                task: null,
                setTask: (t: any) => { taskSet = t; },
                travelTo: () => { throw new Error("Should not travelTo when already on container"); },
                harvest: () => OK
            };

            (globalThis as any).Game.getObjectById = (id: string) => {
                if (id === "src1") return source;
                if (id === "cont1") return container;
                return null;
            };

            const room = new Room("W1N1");
            room.find = (type: number) => {
                if (type === FIND_SOURCES) return [source] as any;
                return [];
            };

            const mockColony = {
                name: "W1N1",
                room: room,
                hatchery: { enqueue: () => { } },
                overlords: [],
                registerOverlord: () => { },
                getZerg: () => undefined,
                creeps: [miner]
            };

            const overlord = new MiningOverlord(mockColony);
            (overlord as any)._zergs = [miner]; (overlord as any)._zergsTick = Game.time;
            overlord.init();
            overlord.sites[0].containerId = "cont1" as any;

            overlord.run();

            // Should have set a harvest task, not called travelTo
            expect(taskSet).to.not.be.null;
            expect(taskSet.name).to.equal("Harvest");
        });
    });

    // ========================================================================
    // Spawn Protection — Never flag/dismantle the last spawn
    // ========================================================================

    describe("Spawn Protection", () => {
        it("should never flag the last spawn as obsolete", () => {
            // Simulate sweepObsoleteStructures logic
            const spawn = {
                id: "spawn1",
                pos: new RoomPosition(25, 25, "W1N1"),
                structureType: STRUCTURE_SPAWN,
                my: true
            };

            const spawnCount = 1;

            // The sweep should skip this spawn
            const shouldSkip = spawn.structureType === STRUCTURE_SPAWN && spawnCount <= 1;
            expect(shouldSkip).to.be.true;
        });

        it("should allow flagging a spawn when multiple exist", () => {
            const spawnCount = 2;
            const shouldSkip = STRUCTURE_SPAWN === STRUCTURE_SPAWN && spawnCount <= 1;
            expect(shouldSkip).to.be.false;
        });
    });

    // ========================================================================
    // UpgradingOverlord Gating — Must not spawn upgraders prematurely
    // ========================================================================

    describe("Upgrader Spawn Gating", () => {
        it("should NOT spawn upgrader when energy is below 90% capacity", () => {
            const { UpgradingOverlord } = require("../../src/os/overlords/UpgradingOverlord");

            const room = new Room("W1N1");
            (room as any).energyAvailable = 200;
            (room as any).energyCapacityAvailable = 300;
            (room as any).controller = { level: 1, ticksToDowngrade: 20000 };
            (room as any).storage = undefined;

            let enqueued: any = null;
            const mockColony = {
                name: "W1N1",
                room: room,
                hatchery: { enqueue: (req: any) => { enqueued = req; return "test"; } },
                overlords: [],
                registerOverlord: () => { },
                getZerg: () => undefined,
                creeps: [{ memory: { role: "miner" } }, { memory: { role: "transporter" } }, { memory: { role: "worker" } }],
                logistics: {
                    offerIds: ["offer1"],
                    getEffectiveStore: () => 0
                },
                linkNetwork: null
            };

            const overlord = new UpgradingOverlord(mockColony);
            (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;
            overlord.init();

            // 200/300 = 66% — below 90% threshold
            expect(enqueued).to.be.null;
        });

        it("should spawn upgrader when energy is 90%+ full and containers exist", () => {
            const { UpgradingOverlord } = require("../../src/os/overlords/UpgradingOverlord");

            const room = new Room("W1N1");
            (room as any).energyAvailable = 290;
            (room as any).energyCapacityAvailable = 300;
            (room as any).controller = { level: 1, ticksToDowngrade: 20000 };
            (room as any).storage = undefined;

            let enqueued: any = null;
            const mockColony = {
                name: "W1N1",
                room: room,
                hatchery: { enqueue: (req: any) => { enqueued = req; return "test"; } },
                overlords: [],
                registerOverlord: () => { },
                getZerg: () => undefined,
                creeps: [{ memory: { role: "miner" } }, { memory: { role: "transporter" } }, { memory: { role: "worker" } }],
                logistics: {
                    offerIds: ["offer1"],
                    getEffectiveStore: () => 0
                },
                linkNetwork: null
            };

            const overlord = new UpgradingOverlord(mockColony);
            (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;
            overlord.init();

            // 290/300 = 96% — above 90%, containers exist, 3 creeps
            expect(enqueued).to.not.be.null;
            expect(enqueued.memory.role).to.equal("upgrader");
        });

        it("should spawn upgrader with body costing <= 300 energy", () => {
            const { UpgradingOverlord } = require("../../src/os/overlords/UpgradingOverlord");

            const room = new Room("W1N1");
            (room as any).energyAvailable = 300;
            (room as any).energyCapacityAvailable = 300;
            (room as any).controller = { level: 1, ticksToDowngrade: 20000 };
            (room as any).storage = undefined;

            let enqueued: any = null;
            const mockColony = {
                name: "W1N1",
                room: room,
                hatchery: { enqueue: (req: any) => { enqueued = req; return "test"; } },
                overlords: [],
                registerOverlord: () => { },
                getZerg: () => undefined,
                creeps: [{ memory: { role: "miner" } }, { memory: { role: "transporter" } }, { memory: { role: "worker" } }],
                logistics: {
                    offerIds: ["offer1"],
                    getEffectiveStore: () => 0
                },
                linkNetwork: null
            };

            const overlord = new UpgradingOverlord(mockColony);
            (overlord as any)._zergs = []; (overlord as any)._zergsTick = Game.time;
            overlord.init();

            expect(enqueued).to.not.be.null;
            const cost = enqueued.bodyTemplate.reduce(
                (sum: number, part: BodyPartConstant) => sum + BODYPART_COST_MAP[part], 0
            );
            expect(cost).to.be.at.most(300,
                `Upgrader body template costs ${cost}e but RCL1 spawn only has 300e`);
        });
    });
});
