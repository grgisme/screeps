import "../../mock.setup";
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { Transporter } from "../../../src/os/zerg/Transporter";
import { Overlord } from "../../../src/os/overlords/Overlord";
import "../../../src/utils/RoomPosition";

describe("Transporter", () => {
    let transporter: Transporter;
    let creep: Creep;
    let overlord: Overlord;

    beforeEach(() => {
        resetMocks();
        creep = new Creep("transporter1" as Id<Creep>);
        creep.pos = new RoomPosition(10, 10, "W1N1");
        creep.store = {
            energy: 50,
            getCapacity: () => 50,
            getFreeCapacity: () => 0,
            getUsedCapacity: () => 50
        } as any;
        creep.body = [{ type: WORK, hits: 100 }, { type: CARRY, hits: 100 }, { type: MOVE, hits: 100 }] as any;
        creep.repair = (() => OK) as any;
        (creep as any).spawning = false;

        const colony = { room: { name: "W1N1" } } as any;
        overlord = { colony } as any;
        (globalThis as any).Game.creeps[creep.name] = creep;
        transporter = new Transporter(creep.name, overlord);
    });

    it("should repair road underfoot if damaged", () => {
        const road = { structureType: STRUCTURE_ROAD, hits: 100, hitsMax: 5000 } as StructureRoad;
        (creep.pos as any).lookFor = (type: string) => {
            if (type === LOOK_STRUCTURES) return [road];
            return [];
        };

        let repairedTarget: Structure | null = null;
        creep.repair = ((target: Structure) => {
            repairedTarget = target;
            return OK;
        }) as any;

        transporter.run();

        expect(repairedTarget).to.equal(road);
    });

    it("should not repair if no energy", () => {
        creep.store.energy = 0;
        const road = { structureType: STRUCTURE_ROAD, hits: 100, hitsMax: 5000 } as StructureRoad;
        (creep.pos as any).lookFor = (_type: string) => [road];

        let repaired = false;
        creep.repair = (() => { repaired = true; return OK; }) as any;

        transporter.run();

        expect(repaired).to.be.false;
    });

    it("should not repair if no WORK parts", () => {
        creep.body = [{ type: CARRY, hits: 100 }, { type: MOVE, hits: 100 }] as any;
        const road = { structureType: STRUCTURE_ROAD, hits: 100, hitsMax: 5000 } as StructureRoad;
        (creep.pos as any).lookFor = (_type: string) => [road];

        let repaired = false;
        creep.repair = (() => { repaired = true; return OK; }) as any;

        transporter.run();

        expect(repaired).to.be.false;
    });
});
