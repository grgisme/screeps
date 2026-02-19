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

    it("should spawn bootstrapper in emergency mode", () => {
        // Arrange: No critical creeps (miners/workers)
        room.find = (type: FindConstant) => {
            if (type === FIND_MY_SPAWNS) return [spawn];
            if (type === FIND_MY_CREEPS) return []; // EMPTY — no miners or workers
            return [];
        };

        const hatchery = new Hatchery(mockColony);

        let spawnedName = "";
        let spawnedBody: BodyPartConstant[] = [];
        spawn.spawnCreep = (body, name) => {
            spawnedName = name;
            spawnedBody = body;
            return OK;
        };

        hatchery.run();

        // Name now includes colony name and Game.time
        expect(spawnedName).to.match(/^bootstrapper_W1N1_\d+$/);
        expect(spawnedBody).to.deep.equal([WORK, CARRY, MOVE]);
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
