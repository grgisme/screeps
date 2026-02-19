// ============================================================================
// Overlord.test.ts — Unit tests for Overlord Control Pattern
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Colony } from "../../src/os/colony/Colony";
import { MiningOverlord } from "../../src/os/overlords/MiningOverlord";
// import { ConstructionOverlord } from "../../src/os/overlords/ConstructionOverlord";
import { HarvestTask } from "../../src/os/tasks/HarvestTask";
import { Zerg } from "../../src/os/zerg/Zerg";

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

        // Mock getObjectById for HarvestTask getter pattern
        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === source.id) return source;
            return null;
        };

        creep = new Creep("miner1" as Id<Creep>);
        creep.room = room;
        creep.memory = { role: "miner" } as CreepMemory;
        (globalThis as any).Game.creeps["miner1"] = creep;

        // Mock energy
        (room as any).energyAvailable = 600;
        (room as any).energyCapacityAvailable = 600;
    });

    describe("Colony", () => {
        it("should instantiate and scan for overlords", () => {
            const colony = new Colony("W1N1");
            expect(colony.overlords).to.have.length(6);
            expect(colony.overlords[1]).to.be.instanceOf(MiningOverlord);
        });

        it("should register zergs", () => {
            const colony = new Colony("W1N1");
            const zerg = colony.registerZerg(creep);
            expect(colony.getZerg("miner1")).to.equal(zerg);
        });
    });

    describe("MiningOverlord", () => {


        it("should request spawn if no miner exists", () => {
            // Mock spawn
            const spawn = {
                id: "spawn1" as Id<StructureSpawn>,
                spawning: null,
                spawnCreep: () => OK,
                store: { getFreeCapacity: () => 0 }
            } as unknown as StructureSpawn;

            // Spy on spawnCreep
            let spawnCalled = false;
            spawn.spawnCreep = (_body, _name, _opts) => {
                spawnCalled = true;
                return OK;
            };

            // Mock storage so MiningOverlord.handleSpawning spawn gate passes
            (room as any).storage = {
                id: "storage1",
                store: { getUsedCapacity: () => 50000, getFreeCapacity: () => 950000 }
            };

            room.find = (type: FindConstant) => {
                if (type === FIND_SOURCES) return [source];
                if (type === FIND_MY_SPAWNS) return [spawn];
                // Return a worker so emergency mode doesn't fire
                if (type === FIND_MY_CREEPS) return [{ memory: { role: 'worker' } }];
                return [];
            };

            // Mock getObjectById — needed for Hatchery's ID-based spawn getter
            (globalThis as any).Game.getObjectById = (id: string) => {
                if (id === source.id) return source;
                if (id === "spawn1") return spawn;
                return null;
            };

            const colony = new Colony("W1N1");
            // overlords[1] is MiningOverlord (overlords[0] is ConstructionOverlord)
            const overlord = colony.overlords[1] as MiningOverlord;

            overlord.init();
            colony.hatchery.run();
            expect(spawnCalled).to.be.true;
        });
    });

    describe("Zerg & Task", () => {
        it("should execute task", () => {
            const zerg = new Zerg(creep.name);
            const task = new HarvestTask(source.id);
            zerg.task = task;

            // Creep out of range — travelTo falls back to moveTo when PathFinder returns empty
            creep.pos = new RoomPosition(20, 20, "W1N1");
            let moveCalled = false;
            creep.moveTo = ((_target: any) => { moveCalled = true; return OK; }) as any;
            creep.say = (() => OK) as any;
            // Force PathFinder to return empty path
            (globalThis as any).PathFinder.search = () => ({ path: [], ops: 0, cost: 0, incomplete: true });

            zerg.run();
            expect(moveCalled).to.be.true;

            // Creep in range
            creep.pos = new RoomPosition(11, 10, "W1N1");
            let harvestCalled = false;
            creep.harvest = ((_target: any) => { harvestCalled = true; return OK; }) as any;

            zerg.run();
            // zerg.harvest() intent-cached wrapper calls creep.harvest under the hood
            expect(harvestCalled).to.be.true;
        });
    });
});

