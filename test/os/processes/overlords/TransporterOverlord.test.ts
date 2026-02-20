
import "../../../mock.setup";
import { expect } from "chai";
import { LogisticsNetwork } from "../../../../src/os/colony/LogisticsNetwork";
import { TransporterOverlord } from "../../../../src/os/overlords/TransporterOverlord";
import { MiningOverlord } from "../../../../src/os/overlords/MiningOverlord";

describe("TransporterOverlord", () => {
    let mockColony: any;
    let room: Room;

    beforeEach(() => {
        room = new Room("W1N1");
        (room as any).energyCapacityAvailable = 550;
        (room as any).find = (_type: number, _opts?: any) => [];
        (globalThis as any).Game.rooms["W1N1"] = room;

        mockColony = {
            room: room,
            name: "W1N1",
            overlords: [],
            logistics: new LogisticsNetwork(undefined as any),
            zergs: new Map(),
            creeps: [],
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

    it("should request spawns when mining sites have hauling demand", () => {
        const miningOverlord = new MiningOverlord(mockColony);
        const mockSite = {
            sourceId: "source1",
            container: { id: "container1" },
            link: null,
            distance: 20,
            roadCoverage: 0,
            hasSwamp: false,
            calculateHaulingPowerNeeded: () => 10 * 2 * 20
        };
        miningOverlord.sites = [mockSite as any];
        mockColony.overlords = [miningOverlord];

        const overlord = new TransporterOverlord(mockColony);
        overlord.transporters = [];

        let enqueued = false;
        mockColony.hatchery.enqueue = (_req: any) => { enqueued = true; };

        (overlord as any).wishlistSpawns();

        expect(enqueued).to.be.true;
    });

    it("should NOT request spawns when carry capacity is sufficient", () => {
        const miningOverlord = new MiningOverlord(mockColony);
        const mockSite = {
            sourceId: "source1",
            container: { id: "container1" },
            link: null,
            distance: 5,
            roadCoverage: 0,
            hasSwamp: false,
            calculateHaulingPowerNeeded: () => 10 * 2 * 5
        };
        miningOverlord.sites = [mockSite as any];
        mockColony.overlords = [miningOverlord];

        const overlord = new TransporterOverlord(mockColony);
        overlord.transporters = [{
            isAlive: () => true,
            creep: { getActiveBodyparts: (type: string) => type === "carry" ? 4 : 0 },
            store: { getCapacity: () => 200 },
            memory: { role: "transporter" }
        } as any];

        let enqueued = false;
        mockColony.hatchery.enqueue = (_req: any) => { enqueued = true; };

        (overlord as any).wishlistSpawns();

        expect(enqueued).to.be.false;
    });

    it("should build road body with WORK when route has high road coverage", () => {
        const miningOverlord = new MiningOverlord(mockColony);
        miningOverlord.sites = [{
            container: { id: "c1" }, link: null,
            roadCoverage: 0.9, hasSwamp: false
        } as any];
        mockColony.overlords = [miningOverlord];

        const overlord = new TransporterOverlord(mockColony);
        const body = (overlord as any).buildTransporterBody(room);

        const hasWork = body.includes(WORK);
        const workCount = body.filter((p: string) => p === WORK).length;
        expect(hasWork).to.be.true;
        expect(workCount).to.equal(1);
    });

    it("should build plains body without WORK when route has low road coverage", () => {
        const miningOverlord = new MiningOverlord(mockColony);
        miningOverlord.sites = [{
            container: { id: "c1" }, link: null,
            roadCoverage: 0.2, hasSwamp: false
        } as any];
        mockColony.overlords = [miningOverlord];

        const overlord = new TransporterOverlord(mockColony);
        const body = (overlord as any).buildTransporterBody(room);

        const hasWork = body.includes(WORK);
        const carryCount = body.filter((p: string) => p === CARRY).length;
        const moveCount = body.filter((p: string) => p === MOVE).length;
        expect(hasWork).to.be.false;
        expect(carryCount).to.equal(moveCount); // 1:1 ratio
    });
});
