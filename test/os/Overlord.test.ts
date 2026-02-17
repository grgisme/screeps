// ============================================================================
// Overlord.test.ts — Unit tests for Overlord Control Pattern
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Colony } from "../../src/os/Colony";
import { MiningOverlord } from "../../src/processes/overlords/MiningOverlord";
import { HarvestTask } from "../../src/os/tasks/HarvestTask";
import { Zerg } from "../../src/os/infrastructure/Zerg";

describe("Overlord Control Pattern", () => {
    let room: Room;
    let source: Source;
    let creep: Creep;

    beforeEach(() => {
        resetMocks();
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        source = {
            id: "source1" as Id<Source>,
            room: room,
            pos: new RoomPosition(10, 10, "W1N1"),
            energy: 3000,
            energyCapacity: 3000,
            ticksToRegeneration: undefined
        } as unknown as Source;

        // Mock find results
        room.find = (type: FindConstant) => {
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        creep = new Creep("miner1" as Id<Creep>);
        creep.room = room;
        creep.memory = { role: "miner" } as CreepMemory;
        (globalThis as any).Game.creeps["miner1"] = creep;
    });

    describe("Colony", () => {
        it("should instantiate and scan for overlords", () => {
            const colony = new Colony("W1N1");
            expect(colony.overlords).to.have.length(2);
            expect(colony.overlords[0]).to.be.instanceOf(MiningOverlord);
        });

        it("should register zergs", () => {
            const colony = new Colony("W1N1");
            const zerg = colony.registerZerg(creep);
            expect(colony.getZerg("miner1")).to.equal(zerg);
        });
    });

    describe("MiningOverlord", () => {
        it("should assign HarvestTask to idle miners", () => {
            const colony = new Colony("W1N1");
            const overlord = colony.overlords[0] as MiningOverlord;
            const zerg = colony.registerZerg(creep);

            overlord.addZerg(zerg);

            // Run init/run sequence
            colony.run(); // Calls overlord.init() then .run()
            // Wait: Colony.run() calls overlord.run() which calls zerg.run() if task exists?
            // Actually overlord.run() assigns tasks.

            expect(zerg.task).to.be.instanceOf(HarvestTask);
            expect((zerg.task as HarvestTask).target).to.equal(source);
        });

        it("should request spawn if no miner exists", () => {
            const colony = new Colony("W1N1");
            const overlord = colony.overlords[0] as MiningOverlord;

            // Mock spawn
            const spawn = {
                spawning: null,
                spawnCreep: () => OK
            } as unknown as StructureSpawn;
            room.find = (type: FindConstant) => {
                if (type === FIND_SOURCES) return [source];
                if (type === FIND_MY_SPAWNS) return [spawn];
                return [];
            };

            // Spy on spawnCreep
            let spawnCalled = false;
            spawn.spawnCreep = (_body, _name, _opts) => {
                spawnCalled = true;
                return OK;
            };

            overlord.init();
            expect(spawnCalled).to.be.true;
        });
    });

    describe("Zerg & Task", () => {
        it("should execute task", () => {
            const zerg = new Zerg(creep);
            const task = new HarvestTask(source);
            zerg.task = task;

            // Creep out of range
            creep.pos = new RoomPosition(20, 20, "W1N1");
            let moveCalled = false;
            creep.moveTo = (_target) => { moveCalled = true; return OK; };

            zerg.run();
            expect(moveCalled).to.be.true;

            // Creep in range
            creep.pos = new RoomPosition(11, 10, "W1N1");
            let harvestCalled = false;
            creep.harvest = (_target) => { harvestCalled = true; return OK; };

            zerg.run();
            expect(harvestCalled).to.be.true;
        });
    });
});
