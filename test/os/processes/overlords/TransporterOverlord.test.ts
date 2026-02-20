
import "../../../mock.setup";
import { expect } from "chai";
import { LogisticsNetwork } from "../../../../src/os/colony/LogisticsNetwork";
import { TransporterOverlord } from "../../../../src/os/overlords/TransporterOverlord";

describe("TransporterOverlord", () => {
    let mockColony: any;
    let room: Room;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        mockColony = {
            room: room,
            name: "W1N1",
            logistics: new LogisticsNetwork(undefined as any),
            zergs: new Map(),
            hatchery: {
                enqueue: (req: any) => { console.log(`[MockHatchery] Enqueued ${req.name}`); }
            }
        };
        mockColony.logistics.colony = mockColony;
    });

    it("should instantiate", () => {
        const overlord = new TransporterOverlord(mockColony);
        expect(overlord).to.not.be.undefined;
        expect(overlord.processId).to.equal("transporter");
    });

    it("should calculate deficit properly", () => {
        const overlord = new TransporterOverlord(mockColony);

        // Add requester with ID-based API
        mockColony.logistics.requestInput("struct1" as Id<Structure | Resource>, { amount: 500 });

        const deficit = (overlord as any).calculateTransportDeficit();
        expect(deficit).to.equal(500);
    });

    it("should request spawns when deficit is high", () => {
        const overlord = new TransporterOverlord(mockColony);

        // Deficit 1000
        mockColony.logistics.requestInput("struct1" as Id<Structure | Resource>, { amount: 1000 });

        // No transporters
        overlord.transporters = [];

        // Track enqueue call
        let enqueued = false;
        mockColony.hatchery.enqueue = (_req: any) => { enqueued = true; };

        (overlord as any).wishlistSpawns();

        expect(enqueued).to.be.true;
    });
});
