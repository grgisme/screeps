// ============================================================================
// Process.test.ts — Unit tests for the abstract Process class
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Process } from "../../src/kernel/Process";
import { ProcessStatus } from "../../src/kernel/ProcessStatus";

// Concrete test implementation
class TestProcess extends Process {
    public readonly processName = "test";
    public runCount = 0;

    run(): void {
        this.runCount++;
    }
}

describe("Process", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("should initialize with ALIVE status", () => {
        const proc = new TestProcess(1, 10);
        expect(proc.status).to.equal(ProcessStatus.ALIVE);
        expect(proc.isAlive()).to.be.true;
    });

    it("should set pid and priority from constructor", () => {
        const proc = new TestProcess(42, 5, 10);
        expect(proc.pid).to.equal(42);
        expect(proc.priority).to.equal(5);
        expect(proc.parentPID).to.equal(10);
    });

    it("should default parentPID to null", () => {
        const proc = new TestProcess(1, 10);
        expect(proc.parentPID).to.be.null;
    });

    it("should suspend and resume correctly", () => {
        const proc = new TestProcess(1, 10);

        proc.suspend();
        expect(proc.status).to.equal(ProcessStatus.SLEEP);
        expect(proc.isAlive()).to.be.false;

        proc.resume();
        expect(proc.status).to.equal(ProcessStatus.ALIVE);
        expect(proc.isAlive()).to.be.true;
    });

    it("should not resume from DEAD status", () => {
        const proc = new TestProcess(1, 10);
        proc.terminate();
        expect(proc.status).to.equal(ProcessStatus.DEAD);

        proc.resume(); // resume only works from SLEEP
        expect(proc.status).to.equal(ProcessStatus.DEAD);
    });

    it("should terminate correctly", () => {
        const proc = new TestProcess(1, 10);
        proc.terminate();
        expect(proc.status).to.equal(ProcessStatus.DEAD);
        expect(proc.isAlive()).to.be.false;
    });

    it("should produce a descriptor for serialization", () => {
        const proc = new TestProcess(7, 15, 3);
        const desc = proc.toDescriptor();

        expect(desc.pid).to.equal(7);
        expect(desc.priority).to.equal(15);
        expect(desc.parentPID).to.equal(3);
        expect(desc.processName).to.equal("test");
        expect(desc.status).to.equal(ProcessStatus.ALIVE);
        expect(desc.data).to.deep.equal({});
    });

    it("should execute the run method", () => {
        const proc = new TestProcess(1, 10);
        proc.run();
        expect(proc.runCount).to.equal(1);
        proc.run();
        expect(proc.runCount).to.equal(2);
    });
});
