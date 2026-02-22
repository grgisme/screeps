import "../../mock.setup";
import { expect } from "chai";
import { Hatchery } from "../../../src/os/colony/Hatchery";

describe("Hatchery", () => {
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
            spawnCreep: () => OK,
            store: {
                getFreeCapacity: () => 0
            }
        } as unknown as StructureSpawn;

        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_STRUCTURES) return [];
            if (type === FIND_MY_CREEPS) return [{ memory: { role: "worker" } }]; // Default: critical creeps exist
            return [];
        };
        room.energyAvailable = 1000;
        room.energyCapacityAvailable = 1000;

        // Mock getObjectById for ID-based getters
        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "spawn1") return spawn;
            return null;
        };

        mockColony = {
            name: "W1N1",
            room: room,
            get creeps() { return room.find(FIND_MY_CREEPS); },
            overlords: [],
            logistics: {
                requestInput: () => { }
            }
        };
    });

    it("should instantiate", () => {
        const hatchery = new Hatchery(mockColony);
        expect(hatchery).to.not.be.undefined;
        expect(hatchery.spawns).to.have.length(1);
    });

    it("should enqueue and sort by priority", () => {
        const hatchery = new Hatchery(mockColony);
        const overlord = { processId: "ol1" } as any;

        hatchery.enqueue({ priority: 1, bodyTemplate: [MOVE], overlord });
        hatchery.enqueue({ priority: 10, bodyTemplate: [MOVE], overlord }); // Higher
        hatchery.enqueue({ priority: 5, bodyTemplate: [MOVE], overlord });

        expect(hatchery.queue[0].priority).to.equal(10);
        expect(hatchery.queue[1].priority).to.equal(5);
        expect(hatchery.queue[2].priority).to.equal(1);
    });

    it("should spawn bootstrapper via queue when enqueued at priority 999 (simulating BootstrappingOverlord)", () => {
        // BootstrappingOverlord enqueues at priority 999 during isCriticalBlackout.
        // Hatchery's run() should process that request just like any other queue item.
        const hatchery = new Hatchery(mockColony);
        const overlord = { processId: "bootstrapping" } as any;

        hatchery.enqueue({
            priority: 999,
            bodyTemplate: [WORK, CARRY, MOVE],
            overlord,
            name: "bootstrap_pioneer_W1N1_1",
            memory: { role: "bootstrapper" },
            maxEnergy: 200  // CAP: ensures body stays [WORK, CARRY, MOVE] regardless of room capacity
        });

        let spawnedName = "";
        let spawnedBody: BodyPartConstant[] = [];
        spawn.spawnCreep = (body, name) => {
            spawnedName = name;
            spawnedBody = body;
            return OK;
        };

        hatchery.run();

        expect(spawnedName).to.equal("bootstrap_pioneer_W1N1_1");
        expect(spawnedBody).to.deep.equal([WORK, CARRY, MOVE]);
    });

    it("should not directly spawn a bootstrapper bypassing the queue (emergency block removed)", () => {
        // Confirm that Hatchery does NOT bypass the queue with its own emergency logic.
        // If the queue is empty and no critical creeps exist, nothing should be spawned.
        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_CREEPS) return []; // No workers/miners
            return [];
        };

        const hatchery = new Hatchery(mockColony);

        let spawnCalled = false;
        spawn.spawnCreep = () => {
            spawnCalled = true;
            return OK;
        };

        hatchery.run(); // Queue empty, no direct emergency spawning

        expect(spawnCalled).to.equal(false);
    });

    it("should process queue if no emergency", () => {
        const hatchery = new Hatchery(mockColony);
        const overlord = { processId: "ol1" } as any;

        hatchery.enqueue({ priority: 1, bodyTemplate: [MOVE], overlord, name: "TestCreep" });

        let spawnedName = "";
        spawn.spawnCreep = (_body, name) => {
            spawnedName = name;
            return OK;
        };

        hatchery.run();

        expect(spawnedName).to.equal("TestCreep");
        expect(hatchery.queue).to.have.length(0);
    });

    it("should wait if not enough energy", () => {
        const hatchery = new Hatchery(mockColony);
        const overlord = { processId: "ol1" } as any;

        room.energyAvailable = 100; // Low

        hatchery.enqueue({ priority: 1, bodyTemplate: [ATTACK, MOVE], overlord, name: "Expensive" });

        let spawnedName = "";
        spawn.spawnCreep = (_body, name) => {
            spawnedName = name;
            return OK;
        };

        hatchery.run();

        // Should NOT spawn
        expect(spawnedName).to.equal("");
        // Should remain in queue
        expect(hatchery.queue).to.have.length(1);
    });
});
