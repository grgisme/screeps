import "../../mock.setup";
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { RemoteMiningOverlord } from "../../../src/os/overlords/RemoteMiningOverlord";
import { Colony } from "../../../src/os/colony/Colony";

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
            storage: { pos: new RoomPosition(10, 10, "W1N1"), id: "storage1" },
            controller: { owner: { username: "Me" } },
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

    it("should instantiate and refresh site infrastructure", () => {
        // Mock MiningSite with spy on refreshStructureIds
        const source = { pos: new RoomPosition(25, 25, "W2N1"), id: "source1" } as Source;

        let refreshCalled = false;
        const site = {
            source,
            sourceId: "source1",
            containerPos: new RoomPosition(24, 25, "W2N1"),
            containerId: null,
            container: null,
            calculateHaulingPowerNeeded: () => 100,
            refreshStructureIds: () => { refreshCalled = true; }
        } as any;
        overlord.sites = [site];

        // Initialize — should call refreshStructureIds on each site
        overlord.init();

        expect(refreshCalled).to.be.true;
    });

    it("should not build container if exists", () => {
        // Mock MiningSite
        const source = { pos: new RoomPosition(25, 25, "W2N1"), id: "source1" } as Source;
        const containerPos = new RoomPosition(24, 25, "W2N1");
        const site = {
            source,
            sourceId: "source1",
            containerPos,
            containerId: "container1",
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
});
