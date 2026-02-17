
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
            pos: {
                findInRange: () => [],
                x: 10,
                y: 10,
                roomName: "W1N1",
                getRangeTo: (_other: any) => 5 // Default for simple tests
            },
            room: room,
            store: {
                getUsedCapacity: () => 500,
                energy: 500
            }
        } as unknown as Structure;

        room.find = (_type: FindConstant) => [];

        mockColony = {
            room: room,
            name: "W1N1",
            logistics: null // Will be set or use separate network
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
            pos: {
                x: 10, y: 15, roomName: "W1N1",
                getRangeTo: (_other: any) => 5,
                findInRange: () => []
            },
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(requester, { amount: 100 });

        network.match();
        const matches = network.unassignedRequests;

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
            pos: {
                x: 10, y: 15, roomName: "W1N1",
                getRangeTo: (_other: any) => 5,
                findInRange: () => []
            },
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
            pos: {
                x: 10, y: 11, roomName: "W1N1",
                getRangeTo: (_other: any) => 1,
                findInRange: () => []
            },
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(req1, { amount: 400, priority: 10 });

        // Requester 2: Needs 400 (should only get 100 matched or 0 if we are strict)
        const req2 = {
            id: "req2",
            pos: {
                x: 10, y: 12, roomName: "W1N1",
                getRangeTo: (_other: any) => 2,
                findInRange: () => []
            },
            store: { energy: 0 }
        } as unknown as Structure;
        network.requestInput(req2, { amount: 400, priority: 5 }); // Lower priority

        network.match();
        const matches = network.unassignedRequests;

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

    it("should predict energy gain for source containers", () => {
        // Mock a source and container
        const source = {
            pos: new RoomPosition(10, 9, "W1N1"), // Next to container
            energy: 1000,
            energyCapacity: 3000
        } as Source;

        const container = {
            id: "cont1",
            structureType: STRUCTURE_CONTAINER,
            pos: {
                findInRange: () => [source],
                x: 10,
                y: 10,
                roomName: "W1N1"
            }, // Mock pos with findInRange
            store: { energy: 0, getUsedCapacity: () => 0 }
        } as unknown as Structure;

        // Mock room.find to return our source when called by findInRange? 
        // findInRange is method on RoomPosition. We mocked the structure's pos object above.

        const network = new LogisticsNetwork(mockColony);

        // Distance 10. Gain = (3000/300) * 10 = 100.
        const effective = network.getEffectiveAmount(container, RESOURCE_ENERGY, 10);

        expect(effective).to.equal(100);
    });

    it("should prioritize requests based on heuristic score", () => {
        const network = new LogisticsNetwork(mockColony);
        const provider = structure; // 500 energy
        network.requestOutput(provider);

        // High distance, High Priority, Full Load
        const req1 = {
            id: "req1",
            pos: {
                x: 10, y: 20, roomName: "W1N1",
                getRangeTo: (_other: any) => 10,
                findInRange: () => []
            },
            store: { energy: 0 },
            amount: 50
        } as unknown as Structure;
        network.requestInput(req1, { amount: 50, priority: 10 });

        // Short distance, Low Priority, Partial Load
        const req2 = {
            id: "req2",
            pos: {
                x: 10, y: 12, roomName: "W1N1",
                getRangeTo: (_other: any) => 2,
                findInRange: () => []
            },
            store: { energy: 40, getCapacity: () => 50 }, // Needs 10
            amount: 10
        } as unknown as Structure;
        network.requestInput(req2, { amount: 10, priority: 1 });

        network.match();

        const zerg = {
            pos: {
                x: 10, y: 25, roomName: "W1N1",
                getRangeTo: (_other: any) => {
                    // Provider is at 10,10. Zerg at 10,25. Range is 15.
                    return 15;
                }
            },
            creep: {
                store: {
                    getCapacity: () => 50
                }
            }
        } as any;

        // Req1: Priority 10. Density 50/50=1. Dist to Provider 15. Score = 10*(1+1)/15^2 = 20/225 = 0.08
        // Req2: Priority 1. Density 10/50=0.2. Dist 15. Score = 1*(1.2)/225 = 0.005.
        // Req1 wins massively.

        const task = network.requestTask(zerg);
        expect(task).to.not.be.null;
        expect(task!.target).to.equal(req1);
    });
});
