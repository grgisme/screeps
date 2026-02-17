// ============================================================================
// Kernel.test.ts — Unit tests for the Kernel scheduler + load shedding
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Kernel, SchedulerMode } from "../../src/kernel/Kernel";
import { Process } from "../../src/kernel/Process";
import { ProcessStatus } from "../../src/kernel/ProcessStatus";

// Concrete test process with configurable priority and name
class TestProcess extends Process {
    public readonly processName: string;
    public executionOrder: number[] = [];
    public shouldThrow = false;

    constructor(pid: number, priority: number, order: number[], name: string = "test") {
        super(pid, priority);
        this.executionOrder = order;
        this.processName = name;
    }

    run(): void {
        if (this.shouldThrow) {
            throw new Error("Intentional test crash");
        }
        this.executionOrder.push(this.pid);
    }

    serialize(): Record<string, unknown> {
        return { marker: "test-data" };
    }
}

describe("Kernel", () => {
    beforeEach(() => {
        resetMocks();
    });

    describe("Process Management", () => {
        it("should add processes and assign PIDs", () => {
            const kernel = new Kernel();
            const order: number[] = [];
            const proc1 = new TestProcess(0, 10, order);
            const proc2 = new TestProcess(0, 20, order);

            const pid1 = kernel.addProcess(proc1);
            const pid2 = kernel.addProcess(proc2);

            expect(pid1).to.equal(1);
            expect(pid2).to.equal(2);
            expect(proc1.pid).to.equal(1);
            expect(proc2.pid).to.equal(2);
            expect(kernel.processCount).to.equal(2);
        });

        it("should remove processes by PID", () => {
            const kernel = new Kernel();
            const proc = new TestProcess(0, 10, []);
            const pid = kernel.addProcess(proc);

            kernel.removeProcess(pid);
            expect(kernel.processCount).to.equal(0);
            expect(kernel.getProcess(pid)).to.be.undefined;
        });

        it("should find processes by name", () => {
            const kernel = new Kernel();
            const proc1 = new TestProcess(0, 10, []);
            const proc2 = new TestProcess(0, 20, []);
            kernel.addProcess(proc1);
            kernel.addProcess(proc2);

            const found = kernel.getProcessesByName("test");
            expect(found).to.have.length(2);
        });

        it("should return distinct priority levels", () => {
            const kernel = new Kernel();
            kernel.addProcess(new TestProcess(0, 10, []));
            kernel.addProcess(new TestProcess(0, 0, []));
            kernel.addProcess(new TestProcess(0, 20, []));
            kernel.addProcess(new TestProcess(0, 10, [])); // duplicate

            const levels = kernel.getPriorityLevels();
            expect(levels).to.deep.equal([0, 10, 20]);
        });
    });

    describe("Scheduler", () => {
        it("should execute processes in priority order (lower first)", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const procLow = new TestProcess(0, 30, order);
            const procHigh = new TestProcess(0, 5, order);
            const procMid = new TestProcess(0, 15, order);

            kernel.addProcess(procLow);
            kernel.addProcess(procHigh);
            kernel.addProcess(procMid);

            kernel.run();

            expect(order).to.deep.equal([
                procHigh.pid,
                procMid.pid,
                procLow.pid,
            ]);
        });

        it("should skip sleeping processes", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const proc1 = new TestProcess(0, 10, order);
            const proc2 = new TestProcess(0, 20, order);
            kernel.addProcess(proc1);
            kernel.addProcess(proc2);

            proc1.suspend();
            kernel.run();

            expect(order).to.deep.equal([proc2.pid]);
        });

        it("should isolate process errors (one crash doesn't stop others)", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const procCrash = new TestProcess(0, 5, order);
            procCrash.shouldThrow = true;

            const procOk = new TestProcess(0, 10, order);
            kernel.addProcess(procCrash);
            kernel.addProcess(procOk);

            kernel.run();

            expect(order).to.deep.equal([procOk.pid]);
            expect(procCrash.status).to.equal(ProcessStatus.DEAD);
        });

        it("should stop when soft CPU ceiling is reached", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            let cpuUsed = 0;
            (globalThis as any).Game.cpu.getUsed = () => cpuUsed;
            (globalThis as any).Game.cpu.limit = 20;

            const proc1 = new TestProcess(0, 5, order);
            const proc2 = new TestProcess(0, 10, order);

            kernel.addProcess(proc1);
            kernel.addProcess(proc2);

            const origRun = proc1.run.bind(proc1);
            proc1.run = () => {
                origRun();
                cpuUsed = 19; // Over 90% of 20
            };

            kernel.run();
            expect(order).to.deep.equal([proc1.pid]);
        });

        it("should stop when hard tickLimit ceiling is hit", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            let cpuUsed = 0;
            (globalThis as any).Game.cpu.getUsed = () => cpuUsed;
            (globalThis as any).Game.cpu.tickLimit = 500;

            const proc1 = new TestProcess(0, 5, order);
            const proc2 = new TestProcess(0, 10, order);

            kernel.addProcess(proc1);
            kernel.addProcess(proc2);

            const origRun = proc1.run.bind(proc1);
            proc1.run = () => {
                origRun();
                cpuUsed = 480; // Over 95% of 500
            };

            kernel.run();
            expect(order).to.deep.equal([proc1.pid]);
        });

        it("should sweep dead processes after run", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const proc = new TestProcess(0, 10, order);
            kernel.addProcess(proc);
            proc.terminate();

            kernel.run();
            expect(kernel.processCount).to.equal(0);
        });

        it("should record CPU profile per process name", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            let cpuUsed = 0;
            (globalThis as any).Game.cpu.getUsed = () => cpuUsed;

            const proc = new TestProcess(0, 10, order);
            kernel.addProcess(proc);

            const origRun = proc.run.bind(proc);
            proc.run = () => {
                origRun();
                cpuUsed += 5.5;
            };

            kernel.run();

            const profile = kernel.getCpuProfile();
            expect(profile.get("test")).to.be.closeTo(5.5, 0.01);
        });
    });

    describe("Load Shedding — 3-Tier CPU Governor", () => {
        it("should be in NORMAL mode when bucket >= 500", () => {
            const kernel = new Kernel();
            (globalThis as any).Game.cpu.bucket = 5000;

            kernel.addProcess(new TestProcess(0, 10, []));
            kernel.run();

            expect(kernel.getSchedulerMode()).to.equal(SchedulerMode.NORMAL);
        });

        it("should be in SAFE mode when bucket < 500", () => {
            const kernel = new Kernel();
            (globalThis as any).Game.cpu.bucket = 300;

            kernel.addProcess(new TestProcess(0, 0, []));
            kernel.run();

            expect(kernel.getSchedulerMode()).to.equal(SchedulerMode.SAFE);
        });

        it("should be in EMERGENCY mode when bucket < 100", () => {
            const kernel = new Kernel();
            (globalThis as any).Game.cpu.bucket = 50;

            kernel.addProcess(new TestProcess(0, 0, []));
            kernel.run();

            expect(kernel.getSchedulerMode()).to.equal(SchedulerMode.EMERGENCY);
        });

        it("should run all processes in NORMAL mode", () => {
            const kernel = new Kernel();
            const order: number[] = [];
            (globalThis as any).Game.cpu.bucket = 5000;

            kernel.addProcess(new TestProcess(0, 0, order, "critical"));
            kernel.addProcess(new TestProcess(0, 10, order, "economy"));
            kernel.addProcess(new TestProcess(0, 20, order, "growth"));

            kernel.run();

            // All 3 should have run
            expect(order).to.have.length(3);
        });

        it("should skip priority > 2 in SAFE mode", () => {
            const kernel = new Kernel();
            const order: number[] = [];
            (globalThis as any).Game.cpu.bucket = 300;

            const critical = new TestProcess(0, 0, order, "critical");
            const safe = new TestProcess(0, 2, order, "safe");
            const economy = new TestProcess(0, 10, order, "economy");
            const growth = new TestProcess(0, 20, order, "growth");

            kernel.addProcess(critical);
            kernel.addProcess(safe);
            kernel.addProcess(economy);
            kernel.addProcess(growth);

            kernel.run();

            // Only priority 0 and 2 should run
            expect(order).to.deep.equal([critical.pid, safe.pid]);
        });

        it("should only run priority 0 in EMERGENCY mode", () => {
            const kernel = new Kernel();
            const order: number[] = [];
            (globalThis as any).Game.cpu.bucket = 50;

            const critical = new TestProcess(0, 0, order, "critical");
            const safe = new TestProcess(0, 2, order, "safe");
            const economy = new TestProcess(0, 10, order, "economy");

            kernel.addProcess(critical);
            kernel.addProcess(safe);
            kernel.addProcess(economy);

            kernel.run();

            // Only priority 0 should run
            expect(order).to.deep.equal([critical.pid]);
        });
    });

    describe("Serialization", () => {
        it("should serialize kernel state to Memory", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const proc = new TestProcess(0, 10, order);
            kernel.addProcess(proc);
            kernel.serialize();

            expect(Memory.kernel).to.exist;
            expect(Memory.kernel.processTable).to.have.length(1);
            expect(Memory.kernel.processTable[0].processName).to.equal("test");
            expect(Memory.kernel.processTable[0].data).to.deep.equal({
                marker: "test-data",
            });
            expect(Memory.kernel.nextPID).to.equal(2);
        });

        it("should deserialize kernel state from Memory", () => {
            Kernel.registerProcess(
                "test",
                (pid, priority, parentPID, _data) => {
                    const proc = new TestProcess(pid, priority, []);
                    proc.parentPID = parentPID;
                    return proc;
                }
            );

            Memory.kernel = {
                processTable: [
                    {
                        pid: 5,
                        priority: 10,
                        parentPID: null,
                        processName: "test",
                        status: ProcessStatus.ALIVE,
                        data: { marker: "restored" },
                    },
                ],
                nextPID: 6,
            };

            const kernel = Kernel.deserialize();
            expect(kernel.processCount).to.equal(1);

            const proc = kernel.getProcess(5);
            expect(proc).to.exist;
            expect(proc!.pid).to.equal(5);
            expect(proc!.priority).to.equal(10);
            expect(proc!.processName).to.equal("test");
        });

        it("should handle deserialization with missing factory gracefully", () => {
            Memory.kernel = {
                processTable: [
                    {
                        pid: 1,
                        priority: 10,
                        parentPID: null,
                        processName: "nonexistent",
                        status: ProcessStatus.ALIVE,
                        data: {},
                    },
                ],
                nextPID: 2,
            };

            const kernel = Kernel.deserialize();
            expect(kernel.processCount).to.equal(0);
        });

        it("should handle empty Memory gracefully", () => {
            (globalThis as any).Memory.kernel = undefined;
            const kernel = Kernel.deserialize();
            expect(kernel.processCount).to.equal(0);
        });
    });
});
