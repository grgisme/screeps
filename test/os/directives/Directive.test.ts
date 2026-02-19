import "../../mock.setup";
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { Directive } from "../../../src/os/directives/Directive";

// Concrete subclass for testing
class TestDirective extends Directive {
    initCalled = false;
    runCalled = false;
    init(): void { this.initCalled = true; }
    run(): void { this.runCalled = true; }
}

describe("Directive", () => {
    let mockColony: any;
    let mockFlag: any;

    beforeEach(() => {
        resetMocks();
        mockColony = {
            name: "W1N1",
            room: new Room("W1N1"),
            overlords: [],
            directives: [],
            registerOverlord: (o: any) => { mockColony.overlords.push(o); },
            hatchery: { enqueue: () => { } }
        };

        mockFlag = {
            name: "inc:W2N1",
            pos: new RoomPosition(25, 25, "W1N1"),
            color: 1,
            secondaryColor: 1,
            room: undefined
        };
    });

    it("should wrap a flag and expose roomName", () => {
        // Register flag in Game.flags so the getter can resolve it
        (globalThis as any).Game.flags["inc:W2N1"] = mockFlag;
        const directive = new TestDirective(mockFlag, mockColony);
        expect(directive.flag).to.equal(mockFlag);
        expect(directive.roomName).to.equal("W1N1"); // flag pos room
    });

    it("should extract target room from flag name", () => {
        const directive = new TestDirective(mockFlag, mockColony);
        expect(directive.targetRoom).to.equal("W2N1");
    });

    it("should detect invisible target rooms", () => {
        const directive = new TestDirective(mockFlag, mockColony);
        expect(directive.isTargetVisible).to.be.false;
    });

    it("should detect visible target rooms", () => {
        (globalThis as any).Game.rooms["W2N1"] = new Room("W2N1");
        const directive = new TestDirective(mockFlag, mockColony);
        expect(directive.isTargetVisible).to.be.true;
    });

    it("should register overlords with colony", () => {
        const directive = new TestDirective(mockFlag, mockColony);
        const mockOverlord = { processId: "test", colony: mockColony, zergs: [], init: () => { }, run: () => { }, addZerg: () => { } };
        directive.registerOverlord(mockOverlord as any);

        expect(directive.overlords).to.have.length(1);
        expect(mockColony.overlords).to.have.length(1);
    });

    it("should support init and run lifecycle", () => {
        const directive = new TestDirective(mockFlag, mockColony);
        directive.init();
        directive.run();
        expect(directive.initCalled).to.be.true;
        expect(directive.runCalled).to.be.true;
    });
});
