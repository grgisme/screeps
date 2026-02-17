
import "../mock.setup";
import { expect } from "chai";
import { Colony } from "../../src/os/Colony";
import { LogisticsNetwork } from "../../src/os/logistics/LogisticsNetwork";

describe("LogisticsNetwork", () => {
    let mockColony: any;
    let room: Room;
    let structure: Structure;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;
        structure = {
            id: "struct1" as Id<Structure>,
            structureType: STRUCTURE_CONTAINER,
            pos: new RoomPosition(10, 10, "W1N1"),
            room: room,
            store: {
                getUsedCapacity: () => 500,
                energy: 500
            }
        } as unknown as Structure;

        room.find = (_type: FindConstant) => [];

        mockColony = {
            room: room,
            name: "W1N1"
        };
    });

    it("should instantiate in Colony", () => {
        const colony = new Colony("W1N1");
        expect(colony.logistics).to.be.instanceOf(LogisticsNetwork);
    });

    it("should register requesters with options", () => {
        const network = new LogisticsNetwork(mockColony);
        network.requestInput(structure, { amount: 100, priority: 5 });
        expect(network.requesters).to.have.length(1);
        expect(network.requesters[0].target).to.equal(structure);
        expect(network.requesters[0].amount).to.equal(100);
        expect(network.requesters[0].priority).to.equal(5);
    });

    it("should register providers", () => {
        const network = new LogisticsNetwork(mockColony);
        network.requestOutput(structure);
        expect(network.providers).to.contain(structure);
    });

    it("should match requests to providers", () => {
        const network = new LogisticsNetwork(mockColony);

        // Provider: Structure with 500 energy
        const provider = structure;
        network.requestOutput(provider);

        // Requester: Structure needing 100 energy
        const requester = {
            id: "req1",
            pos: new RoomPosition(10, 15, "W1N1"), // 5 tiles away
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(requester, { amount: 100 });

        const matches = network.match();

        expect(matches).to.have.length(1);
        expect(matches[0].target).to.equal(requester);
        expect(matches[0].provider).to.equal(provider);
        expect(matches[0].amount).to.equal(100);
    });

    it("should update reservations on match", () => {
        const network = new LogisticsNetwork(mockColony);
        const provider = structure;
        network.requestOutput(provider);

        const requester = {
            id: "req1",
            pos: new RoomPosition(10, 15, "W1N1"),
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(requester, { amount: 100 });

        network.match();

        expect(network.outgoingReservations.get(provider.id)).to.equal(100);
        expect(network.incomingReservations.get(requester.id)).to.equal(100);
    });

    it("should respect effective amount to prevent double booking", () => {
        const network = new LogisticsNetwork(mockColony);

        // Provider has 500 energy
        const provider = structure;
        network.requestOutput(provider);

        // Requester 1: Needs 400
        const req1 = {
            id: "req1",
            pos: new RoomPosition(10, 11, "W1N1"),
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(req1, { amount: 400, priority: 10 });

        // Requester 2: Needs 400 (should only get 100 matched or 0 if we are strict)
        const req2 = {
            id: "req2",
            pos: new RoomPosition(10, 12, "W1N1"),
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(req2, { amount: 400, priority: 5 }); // Lower priority

        const matches = network.match();

        // First match takes 400. Provider effectively has 100 left.
        // Second match needs 400. 
        // Logic: amount = Math.min(req.amount, providerAmount)
        // match 1: 400
        // match 2: 100 (remaining)

        expect(matches).to.have.length(2);
        expect(matches[0].target).to.equal(req1);
        expect(matches[0].amount).to.equal(400);

        expect(matches[1].target).to.equal(req2);
        expect(matches[1].amount).to.equal(100);

        expect(network.outgoingReservations.get(provider.id)).to.equal(500);
    });
});
