
import "../mock.setup";
import { expect } from "chai";
import { Colony } from "../../src/os/colony/Colony";
import { LogisticsNetwork } from "../../src/os/colony/LogisticsNetwork";

describe("LogisticsNetwork", () => {
    let mockColony: any;
    let room: Room;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        room.find = (_type: FindConstant) => [];

        mockColony = {
            room: room,
            name: "W1N1",
            logistics: null, // Will be set later
            zergs: new Map(),
            linkNetwork: null
        };
    });

    it("should instantiate in Colony", () => {
        const colony = new Colony("W1N1");
        expect(colony.logistics).to.be.instanceOf(LogisticsNetwork);
    });

    it("should register requesters with options", () => {
        const network = new LogisticsNetwork(mockColony);
        const targetId = "struct1" as Id<Structure | Resource>;
        network.requestInput(targetId, { amount: 100, priority: 5 });
        expect(network.requesters).to.have.length(1);
        expect(network.requesters[0].targetId).to.equal("struct1");
        expect(network.requesters[0].amount).to.equal(100);
        expect(network.requesters[0].priority).to.equal(5);
    });

    it("should register offers", () => {
        const network = new LogisticsNetwork(mockColony);
        const targetId = "struct1" as Id<Structure | Resource>;
        network.requestOutput(targetId);
        expect(network.offerIds).to.contain("struct1");
    });

    it("should clear reservations on refresh", () => {
        const network = new LogisticsNetwork(mockColony);
        network.incomingReservations.set("a", 100);
        network.outgoingReservations.set("b", 200);

        network.refresh();

        expect(network.incomingReservations.size).to.equal(0);
        expect(network.outgoingReservations.size).to.equal(0);
        expect(network.offerIds).to.have.length(0);
        expect(network.requesters).to.have.length(0);
    });

    it("should compute effective amount with reservations", () => {
        const network = new LogisticsNetwork(mockColony);
        const targetId = "cont1" as Id<Structure | Resource>;

        // Mock: container with 500 energy
        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "cont1") return {
                id: "cont1",
                store: { [RESOURCE_ENERGY]: 500 }
            };
            return null;
        };

        // No reservations
        expect(network.getEffectiveAmount(targetId)).to.equal(500);

        // With outgoing reservation (someone is withdrawing 200)
        network.outgoingReservations.set("cont1", 200);
        expect(network.getEffectiveAmount(targetId)).to.equal(300);

        // With incoming reservation too (someone is transferring 100)
        network.incomingReservations.set("cont1", 100);
        expect(network.getEffectiveAmount(targetId)).to.equal(400);
    });

    it("should matchWithdraw to highest scoring offer", () => {
        const network = new LogisticsNetwork(mockColony);

        // Offer 1: 400 energy, distance 10
        // Offer 2: 200 energy, distance 2
        const offer1Id = "offer1" as Id<Structure | Resource>;
        const offer2Id = "offer2" as Id<Structure | Resource>;
        network.requestOutput(offer1Id);
        network.requestOutput(offer2Id);

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "offer1") return {
                id: "offer1",
                pos: new RoomPosition(30, 30, "W1N1"),
                store: { [RESOURCE_ENERGY]: 400 }
            };
            if (id === "offer2") return {
                id: "offer2",
                pos: new RoomPosition(12, 10, "W1N1"),
                store: { [RESOURCE_ENERGY]: 200 }
            };
            return null;
        };

        const zerg = {
            name: "hauler1",
            pos: new RoomPosition(10, 10, "W1N1"),
            store: {
                getFreeCapacity: () => 100,
                getUsedCapacity: () => 0
            }
        } as any;

        // offer2 wins (closer and still decent amount)
        const result = network.matchWithdraw(zerg, [zerg]);
        expect(result).to.equal("offer2");

        // Check reservation was set
        expect(network.outgoingReservations.get("offer2")).to.equal(100);
    });

    it("should matchTransfer to highest scoring request", () => {
        const network = new LogisticsNetwork(mockColony);

        // Request 1: priority 10, distance ~20
        // Request 2: priority 5, distance 2
        const req1Id = "req1" as Id<Structure | Resource>;
        const req2Id = "req2" as Id<Structure | Resource>;
        network.requestInput(req1Id, { amount: 500, priority: 10 });
        network.requestInput(req2Id, { amount: 300, priority: 5 });

        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "req1") return {
                id: "req1",
                pos: new RoomPosition(30, 30, "W1N1")
            };
            if (id === "req2") return {
                id: "req2",
                pos: new RoomPosition(12, 10, "W1N1")
            };
            return null;
        };

        const zerg = {
            name: "hauler1",
            pos: new RoomPosition(10, 10, "W1N1"),
            store: {
                getFreeCapacity: () => 0,
                getUsedCapacity: () => 100
            }
        } as any;

        // With strict priority bands: (priority * 1000) - distance
        // req1: score = (10 * 1000) - ~28 = 9972
        // req2: score = (5 * 1000) - 2  = 4998
        // req1 wins (higher priority is absolute, distance is only a tie-breaker)
        const result = network.matchTransfer(zerg, [zerg]);
        expect(result).to.equal("req1");

        // Check reservation was set
        expect(network.incomingReservations.get("req1")).to.equal(100);
    });

    it("should prevent double-booking via reservations on matchWithdraw", () => {
        const network = new LogisticsNetwork(mockColony);

        const offerId = "offer1" as Id<Structure | Resource>;
        network.requestOutput(offerId);

        // 60 energy → capacity = ceil(60/50) = 2 slots
        // Both haulers should match since capacity allows it
        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "offer1") return {
                id: "offer1",
                pos: new RoomPosition(15, 15, "W1N1"),
                store: { [RESOURCE_ENERGY]: 60 }
            };
            return null;
        };

        // Use worker role for 10-energy threshold (below the 50 transporter threshold)
        const zerg1 = {
            name: "hauler1",
            pos: new RoomPosition(10, 10, "W1N1"),
            memory: { role: "worker" },
            store: { getFreeCapacity: () => 30, getUsedCapacity: () => 0 }
        } as any;

        const zerg2 = {
            name: "hauler2",
            pos: new RoomPosition(20, 20, "W1N1"),
            memory: { role: "worker" },
            store: { getFreeCapacity: () => 30, getUsedCapacity: () => 0 }
        } as any;

        // Batch match both — capacity = 2, both should match
        const r1 = network.matchWithdraw(zerg1, [zerg1, zerg2]);
        const r2 = network.matchWithdraw(zerg2);

        // Both should match (capacity allows 2)
        expect(r1).to.equal("offer1");
        expect(r2).to.equal("offer1");

        // Reservations should accumulate
        expect(network.outgoingReservations.get("offer1")).to.equal(60); // 30 + 30
    });
});
