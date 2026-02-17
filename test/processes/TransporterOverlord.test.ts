
import "../mock.setup";
import { expect } from "chai";
import { LogisticsNetwork } from "../../src/os/logistics/LogisticsNetwork";
import { TransporterOverlord } from "../../src/processes/overlords/TransporterOverlord";

describe("TransporterOverlord", () => {
    let mockColony: any;
    let room: Room;
    let structure: Structure;

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        mockColony = {
            room: room,
            name: "W1N1",
            logistics: new LogisticsNetwork(undefined as any) // We'll patch this
        };
        mockColony.logistics.colony = mockColony;
        mockColony.logistics.providers = [];
        mockColony.logistics.requesters = [];
        mockColony.logistics.unassignedRequests = []; // Initialize this

        structure = {
            id: "struct1",
            pos: new RoomPosition(10, 10, "W1N1"),
            store: {
                energy: 0,
                getCapacity: () => 1000,
                getUsedCapacity: () => 0
            }
        } as unknown as Structure;
    });

    it("should instantiate", () => {
        const overlord = new TransporterOverlord(mockColony);
        expect(overlord).to.not.be.undefined;
        expect(overlord.processId).to.equal("transporter");
    });

    it("should calculate deficit properly", () => {
        const overlord = new TransporterOverlord(mockColony);

        // Add requester
        mockColony.logistics.requestInput(structure, { amount: 500 });

        // Check deficit
        const deficit = (overlord as any).calculateTransportDeficit();
        expect(deficit).to.equal(500);
    });

    it("should request spawns when deficit is high", () => {
        const overlord = new TransporterOverlord(mockColony);

        // Deficit 1000
        mockColony.logistics.requestInput(structure, { amount: 1000 });

        // No transporters
        overlord.transporters = [];

        // Hijack console.log
        let lastLog = "";
        const originalLog = console.log;
        console.log = (msg: string) => { lastLog = msg; };

        (overlord as any).wishlistSpawns();

        console.log = originalLog;

        expect(lastLog).to.contain("Requesting spawn");
    });
});
