
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { TerminalOverlord } from "../../../src/os/overlords/TerminalOverlord";
import { Colony } from "../../../src/os/colony/Colony";

describe("TerminalOverlord", () => {
    let colony: Colony;
    let room: Room;
    let storage: StructureStorage;
    let terminal: StructureTerminal;
    let overlord: TerminalOverlord;

    beforeEach(() => {
        resetMocks();
        // console.log("BeforeEach check. Market present?", !!(globalThis as any).Game.market);
        if (!(globalThis as any).Game.market) {
            console.warn("Game.market was missing! Force initializing.");
            (globalThis as any).Game.market = {
                calcTransactionCost: () => 0,
                getAllOrders: () => [],
                deal: () => OK
            };
        }
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        storage = {
            store: {
                getUsedCapacity: ((_r?: any) => 500000) as any,
                getCapacity: ((_r?: any) => 1000000) as any,
            }
        } as any;
        room.storage = storage;

        terminal = {
            store: { energy: 10000 },
            cooldown: 0,
            send: () => OK
        } as any;
        room.terminal = terminal;

        colony = new Colony("W1N1");
        overlord = new TerminalOverlord(colony);
    });

    it("should balance energy to poor rooms", () => {
        (globalThis as any).Game.time = 10;
        // Setup: Rich local room
        storage.store.getUsedCapacity = ((_r?: any) => 900000) as any; // > 800k

        // Setup: Poor remote room
        const poorRoom = {
            name: "W1N2",
            controller: { my: true },
            storage: { store: { getUsedCapacity: () => 100000 } }
        } as any;
        (globalThis as any).Game.rooms["W1N2"] = poorRoom;

        // Mock Transaction Cost
        (globalThis as any).Game.market.calcTransactionCost = (_amount: number, _roomName1: string, _roomName2: string) => 100;

        let sendCalled = false;
        terminal.send = (resource, _amount, dest) => {
            if (resource === RESOURCE_ENERGY && dest === "W1N2") {
                sendCalled = true;
            }
            return OK;
        };

        overlord.run();
        expect(sendCalled).to.be.true;
    });

    it("should sell energy when critical full", () => {
        // Setup: Critical full
        storage.store.getUsedCapacity = ((_r?: any) => 950000) as any; // > 900k

        // Mock Market
        (globalThis as any).Game.market.getAllOrders = () => [{
            id: "order1",
            type: ORDER_BUY,
            resourceType: RESOURCE_ENERGY,
            price: 0.5,
            amount: 10000,
            roomName: "W5N5"
        }];
        (globalThis as any).Game.market.calcTransactionCost = (_amount: number, _roomName1: string, _roomName2: string) => 100;

        let dealCalled = false;
        (globalThis as any).Game.market.deal = (id: string, _amount: number, _roomName: string) => {
            if (id === "order1") dealCalled = true;
            return OK;
        };

        overlord.run();
        expect(dealCalled).to.be.true;
    });
});
