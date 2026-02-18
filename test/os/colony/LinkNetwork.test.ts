import "../../mock.setup";
import { expect } from "chai";
import { LinkNetwork } from "../../../src/os/colony/LinkNetwork";
import { Colony } from "../../../src/os/colony/Colony";

describe("LinkNetwork", () => {
    let colony: Colony;
    let room: Room;
    let storage: StructureStorage;
    let controller: StructureController;
    let source: Source;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        storage = {
            id: "storage",
            pos: new RoomPosition(25, 25, "W1N1"),
            store: {
                getUsedCapacity: () => 0,
                getFreeCapacity: () => 1000000
            }
        } as any;
        room.storage = storage;

        controller = {
            id: "controller",
            pos: new RoomPosition(10, 10, "W1N1"),
            my: true
        } as any;
        room.controller = controller;

        source = {
            id: "source1",
            pos: new RoomPosition(40, 40, "W1N1")
        } as any;

        room.find = (type: number) => {
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        colony = new Colony("W1N1");
        // Manually attach network
        colony.linkNetwork = new LinkNetwork(colony);
    });

    it("should identify Hub Link", () => {
        const hubLink = {
            id: "hubLink",
            structureType: STRUCTURE_LINK,
            pos: new RoomPosition(26, 26, "W1N1"), // Range 1 to storage
            store: { getUsedCapacity: () => 0 }
        } as any;

        (room as any).find = (type: number, opts: any) => {
            if (type === FIND_MY_STRUCTURES && opts.filter(hubLink)) return [hubLink];
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        colony.linkNetwork.refresh();
        expect(colony.linkNetwork.hubLink).to.not.be.null;
        expect(colony.linkNetwork.hubLink!.id).to.equal("hubLink");
    });

    it("should identify Source Link", () => {
        const sourceLink = {
            id: "srcLink",
            structureType: STRUCTURE_LINK,
            pos: new RoomPosition(41, 41, "W1N1"), // Range 1 to source
            store: { getUsedCapacity: () => 0 }
        } as any;

        (room as any).find = (type: number, opts: any) => {
            if (type === FIND_MY_STRUCTURES && opts.filter(sourceLink)) return [sourceLink];
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        colony.linkNetwork.refresh();
        expect(colony.linkNetwork.sourceLinks).to.have.length(1);
        expect(colony.linkNetwork.sourceLinks[0].id).to.equal("srcLink");
    });

    it("should transfer from Source to Hub when full", () => {
        const sourceLink = {
            id: "srcLink",
            structureType: STRUCTURE_LINK,
            pos: new RoomPosition(41, 41, "W1N1"),
            store: { getUsedCapacity: () => 800 }, // Full
            cooldown: 0,
            transferEnergy: () => OK
        } as any;

        const hubLink = {
            id: "hubLink",
            structureType: STRUCTURE_LINK,
            pos: new RoomPosition(26, 26, "W1N1"),
            store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800 },
            cooldown: 0
        } as any;

        (room as any).find = (type: number, _opts: any) => {
            if (type === FIND_MY_STRUCTURES) return [sourceLink, hubLink];
            if (type === FIND_SOURCES) return [source];
            return [];
        };

        colony.linkNetwork.refresh();

        let transferCalled = false;
        sourceLink.transferEnergy = (target: any) => {
            if (target.id === "hubLink") transferCalled = true;
            return OK;
        };

        colony.linkNetwork.run();
        expect(transferCalled).to.be.true;
    });
});
