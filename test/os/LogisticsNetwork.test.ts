
import "../mock.setup";
import { expect } from "chai";
import { Colony } from "../../src/os/Colony";
import { LogisticsNetwork } from "../../src/os/logistics/LogisticsNetwork";

describe("LogisticsNetwork", () => {
    let room: Room;
    let structure: Structure;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;
        structure = {
            id: "struct1" as Id<Structure>,
            structureType: STRUCTURE_CONTAINER,
            pos: new RoomPosition(10, 10, "W1N1"),
            room: room
        } as unknown as Structure;

        room.find = (_type: FindConstant) => [];
    });

    it("should instantiate in Colony", () => {
        const colony = new Colony("W1N1");
        expect(colony.logistics).to.be.instanceOf(LogisticsNetwork);
    });

    it("should register requesters", () => {
        const network = new LogisticsNetwork();
        network.requestInput(structure);
        expect(network.requesters).to.contain(structure);
        expect(network.providers).to.be.empty;
    });

    it("should register providers", () => {
        const network = new LogisticsNetwork();
        network.requestOutput(structure);
        expect(network.providers).to.contain(structure);
        expect(network.requesters).to.be.empty;
    });

    it("should register buffers", () => {
        const network = new LogisticsNetwork();
        network.provideBuffer(structure);
        expect(network.buffers).to.contain(structure);
    });

    it("should clear arrays on refresh", () => {
        const network = new LogisticsNetwork();
        network.requestInput(structure);
        network.requestOutput(structure);
        network.provideBuffer(structure);

        network.refresh();

        expect(network.requesters).to.be.empty;
        expect(network.providers).to.be.empty;
        expect(network.buffers).to.be.empty;
    });

    it("should have reservation maps", () => {
        const network = new LogisticsNetwork();
        expect(network.incomingReservations).to.be.instanceOf(Map);
        expect(network.outgoingReservations).to.be.instanceOf(Map);
    });
});
