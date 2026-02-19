import "../../../mock.setup";
import { resetMocks } from "../../../mock.setup";
import { expect } from "chai";
import { RemoteMiningOverlord } from "../../../../src/os/overlords/colonization/RemoteMiningOverlord";
import { Colony } from "../../../../src/os/colony/Colony";

describe("RemoteMiningOverlord", () => {
    let overlord: RemoteMiningOverlord;
    let colony: Colony;
    let room: Room;

    beforeEach(() => {
        resetMocks();

        // Mock Room
        room = {
            name: "W2N1",
            find: () => [],
            lookForAt: () => [],
            controller: {
                my: false,
                reservation: { username: "Me" },
                owner: undefined
            }
        } as any;
        (globalThis as any).Game.rooms["W2N1"] = room;
        (globalThis as any).Memory.rooms["W2N1"] = {};
        (globalThis as any).Game.time = 100; // Trigger infrastructure check

        // Mock Colony (Colony.room is a getter reading Game.rooms[this.name])
        const colonyRoom = {
            name: "W1N1",
            storage: { pos: new RoomPosition(10, 10, "W1N1") },
            find: () => []
        };
        (globalThis as any).Game.rooms["W1N1"] = colonyRoom;
        colony = {
            name: "W1N1",
            get room() { return (globalThis as any).Game.rooms["W1N1"]; },
            hatchery: { enqueue: () => { } },
            getZerg: () => undefined
        } as any;

        overlord = new RemoteMiningOverlord(colony, "W2N1");
    });

    it("should instantiate and manage infrastructure", () => {
        // Mock MiningSite
        const source = { pos: new RoomPosition(25, 25, "W2N1"), id: "source1" } as Source;
        const containerPos = new RoomPosition(24, 25, "W2N1");

        const site = {
            source,
            sourceId: "source1",
            containerPos,
            container: null,
            calculateHaulingPowerNeeded: () => 100,
            refreshStructureIds: () => { }
        } as any;
        overlord.sites = [site];

        // Mock construction
        let siteCreated = false;
        containerPos.createConstructionSite = ((type: StructureConstant) => {
            if (type === STRUCTURE_CONTAINER) siteCreated = true;
            return OK;
        }) as any;

        containerPos.lookFor = ((_type: string) => []) as any; // No existing structures

        // Initialize (handles spawning but manageInfrastructure called in init too)
        overlord.init();

        expect(siteCreated).to.be.true;
    });

    it("should not build container if exists", () => {
        // Mock MiningSite
        const source = { pos: new RoomPosition(25, 25, "W2N1"), id: "source1" } as Source;
        const containerPos = new RoomPosition(24, 25, "W2N1");
        const site = {
            source,
            sourceId: "source1",
            containerPos,
            container: {}, // Exists
            calculateHaulingPowerNeeded: () => 100,
            refreshStructureIds: () => { }
        } as any;
        overlord.sites = [site];

        let siteCreated = false;
        containerPos.createConstructionSite = (() => { siteCreated = true; return OK; }) as any;

        // Mock existing structure
        containerPos.lookFor = ((type: string) => {
            if (type === LOOK_STRUCTURES) return [{ structureType: STRUCTURE_CONTAINER }];
            return [];
        }) as any;

        overlord.init();

        expect(siteCreated).to.be.false;
    });

    it("should build roads if reserved", () => {
        // Mock MiningSite
        const source = { pos: new RoomPosition(25, 25, "W2N1"), id: "source1" } as Source;
        const containerPos = new RoomPosition(24, 25, "W2N1");
        const site = { source, sourceId: "source1", containerPos, calculateHaulingPowerNeeded: () => 100, refreshStructureIds: () => { } } as any;
        overlord.sites = [site];
        (containerPos as any).lookFor = () => [{ structureType: STRUCTURE_CONTAINER }]; // Skip container build

        // Mock PathFinder
        const path = [new RoomPosition(20, 20, "W2N1"), new RoomPosition(21, 20, "W2N1")];
        (PathFinder.search as any) = () => ({ path, incomplete: false });

        // Mock Map Terrain
        (Game.map as any).getRoomTerrain = () => ({ get: () => 0 }); // Plain

        // Mock construction on path
        const createdSites: RoomPosition[] = [];
        (RoomPosition.prototype as any).createConstructionSite = function (type: StructureConstant) {
            if (type === STRUCTURE_ROAD) createdSites.push(this);
            return OK;
        };

        // Ensure lookFor returns empty for path pos
        (RoomPosition.prototype as any).lookFor = () => [];

        overlord.init();

        expect(createdSites.length).to.be.greaterThan(0);
        expect(createdSites[0].x).to.equal(20);
    });
});
