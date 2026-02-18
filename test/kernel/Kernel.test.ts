// ============================================================================
// Kernel.test.ts — Unit tests for the refactored Kernel scheduler
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
    public runCount = 0;

    constructor(
        pid: number,
        priority: number,
        order: number[],
        name: string = "test",
        id: string = ""
    ) {
        super(pid, priority);
        this.executionOrder = order;
        this.processName = name;
        if (id) {
            this.processId = id;
        }
    }

    run(): void {
        this.runCount++;
        if (this.shouldThrow) {
            throw new Error("Intentional test crash");
        }
        this.executionOrder.push(this.pid);
    }

    serialize(): Record<string, unknown> {
        return { marker: "test-data" };
    }
}

// Generator test process that yields across ticks
class CoroutineProcess extends Process {
    public readonly processName = "coroutine";
    public steps: number[] = [];

    constructor(pid: number, priority: number) {
        super(pid, priority);
    }

    *run(): Generator<void, void, unknown> {
        this.steps.push(1);
        yield;
        this.steps.push(2);
        yield;
        this.steps.push(3);
    }

    serialize(): Record<string, unknown> {
        return {};
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

    describe("O(1) Process ID Index", () => {
        it("should lookup process by custom processId", () => {
            const kernel = new Kernel();
            const proc = new TestProcess(0, 10, [], "miner", "mining:W1N1:source1");
            kernel.addProcess(proc);

            const found = kernel.getProcessById("mining:W1N1:source1");
            expect(found).to.equal(proc);
            expect(found?.pid).to.equal(proc.pid);
        });

        it("should check existence with hasProcessId", () => {
            const kernel = new Kernel();
            const proc = new TestProcess(0, 10, [], "miner", "mining:W1N1:source1");
            kernel.addProcess(proc);

            expect(kernel.hasProcessId("mining:W1N1:source1")).to.be.true;
            expect(kernel.hasProcessId("mining:W1N1:source2")).to.be.false;
        });

        it("should clean up indexes on removeProcess", () => {
            const kernel = new Kernel();
            const proc = new TestProcess(0, 10, [], "miner", "mining:W1N1:source1");
            kernel.addProcess(proc);

            kernel.removeProcess(proc.pid);
            expect(kernel.hasProcessId("mining:W1N1:source1")).to.be.false;
            expect(kernel.getProcessesByName("miner")).to.have.length(0);
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

        it("should stop when soft CPU ceiling is reached (burst mode)", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            let cpuUsed = 0;
            (globalThis as any).Game.cpu.getUsed = () => cpuUsed;
            // Bucket healthy → softLimit = tickLimit * 0.95 = 20 * 0.95 = 19
            (globalThis as any).Game.cpu.tickLimit = 20;
            (globalThis as any).Game.cpu.limit = 20;

            const proc1 = new TestProcess(0, 5, order);
            const proc2 = new TestProcess(0, 10, order);

            kernel.addProcess(proc1);
            kernel.addProcess(proc2);

            const origRun = proc1.run.bind(proc1);
            proc1.run = () => {
                origRun();
                cpuUsed = 19; // >= 95% of tickLimit (20)
            };

            kernel.run();
            expect(order).to.deep.equal([proc1.pid]);
        });

        it("should use conservative soft limit when bucket is draining", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            let cpuUsed = 0;
            (globalThis as any).Game.cpu.getUsed = () => cpuUsed;
            (globalThis as any).Game.cpu.limit = 20;
            (globalThis as any).Game.cpu.tickLimit = 500;
            // Bucket below BUCKET_NORMAL → softLimit = limit * 0.95 = 19
            (globalThis as any).Game.cpu.bucket = 300;

            const proc1 = new TestProcess(0, 0, order, "critical");
            const proc2 = new TestProcess(0, 0, order, "critical2");

            kernel.addProcess(proc1);
            kernel.addProcess(proc2);

            const origRun = proc1.run.bind(proc1);
            proc1.run = () => {
                origRun();
                cpuUsed = 19; // >= 95% of limit (20), but << tickLimit
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

        it("should start with empty scheduler report", () => {
            const kernel = new Kernel();
            const report = kernel.getSchedulerReport();
            expect(report.executed.size).to.equal(0);
            expect(report.skipped.size).to.equal(0);
            expect(report.sleeping).to.equal(0);
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

            expect(order).to.have.length(3);
        });

        it("should skip priority > 2 in SAFE mode", () => {
            const kernel = new Kernel();
            const order: number[] = [];
            (globalThis as any).Game.cpu.bucket = 300;

            const critical = new TestProcess(0, 0, order, "critical");
            const safe = new TestProcess(0, 2, order, "safe");
            const economy = new TestProcess(0, 10, order, "economy"); // Priority 10 -> Skip

            kernel.addProcess(critical);
            kernel.addProcess(safe);
            kernel.addProcess(economy);

            kernel.run();

            expect(order).to.deep.equal([critical.pid, safe.pid]);

            const report = kernel.getSchedulerReport();
            expect(report.skipped.get(10)).to.equal(1);
        });

        it("should only run priority 0 in EMERGENCY mode", () => {
            const kernel = new Kernel();
            const order: number[] = [];
            (globalThis as any).Game.cpu.bucket = 50;

            const critical = new TestProcess(0, 0, order, "critical");
            const safe = new TestProcess(0, 2, order, "safe");

            kernel.addProcess(critical);
            kernel.addProcess(safe); // Priority 2 -> Skip in Emergency

            kernel.run();

            expect(order).to.deep.equal([critical.pid]);
        });
    });

    describe("O(1) Wake Map", () => {
        it("should skip sleeping processes without checking priority", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const proc = new TestProcess(0, 10, order);
            kernel.addProcess(proc);

            // Sleep for 10 ticks
            (globalThis as any).Game.time = 100;
            proc.sleep(10);
            expect(proc.status).to.equal(ProcessStatus.SLEEP);
            expect(proc.sleepUntil).to.equal(110);

            kernel.run();

            expect(proc.runCount).to.equal(0);
            expect(kernel.getSchedulerReport().sleeping).to.equal(1);
        });

        it("should auto-wake process via wake map when time is reached", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const proc = new TestProcess(0, 10, order);
            (globalThis as any).Game.time = 100;
            kernel.addProcess(proc);

            proc.sleep(5); // Wake at 105
            // kernel.run() detects that proc is SLEEP with sleepUntil=105,
            // registers it in wakeMap, and skips execution
            kernel.run();
            expect(proc.runCount).to.equal(0);

            // Time 104: still sleeping
            (globalThis as any).Game.time = 104;
            kernel.run();
            expect(proc.runCount).to.equal(0);
            expect(proc.status).to.equal(ProcessStatus.SLEEP);

            // Time 105: wake map fires, process resumes and runs
            (globalThis as any).Game.time = 105;
            kernel.run();

            expect(proc.status).to.equal(ProcessStatus.ALIVE);
            expect(proc.sleepUntil).to.be.null;
            expect(proc.runCount).to.equal(1);
        });

        it("should handle stale PIDs in wake map gracefully", () => {
            const kernel = new Kernel();
            const order: number[] = [];

            const proc = new TestProcess(0, 10, order);
            kernel.addProcess(proc);

            (globalThis as any).Game.time = 100;
            proc.sleep(5);
            kernel.run(); // Registers wake at 105

            // Remove the process before wake time
            kernel.removeProcess(proc.pid);

            // Time 105: wake map fires but PID is gone — no crash
            (globalThis as any).Game.time = 105;
            expect(() => kernel.run()).to.not.throw();
        });
    });

    describe("Generator Coroutines", () => {
        it("should execute generator across multiple ticks", () => {
            const kernel = new Kernel();
            const proc = new CoroutineProcess(0, 5);
            kernel.addProcess(proc);

            // Tick 1: run() returns generator, first .next() executes step 1
            kernel.run();
            expect(proc.steps).to.deep.equal([1]);
            expect(proc.thread).to.not.be.undefined;

            // Tick 2: resumes generator, executes step 2
            kernel.run();
            expect(proc.steps).to.deep.equal([1, 2]);
            expect(proc.thread).to.not.be.undefined;

            // Tick 3: resumes generator, executes step 3, generator done
            kernel.run();
            expect(proc.steps).to.deep.equal([1, 2, 3]);
            expect(proc.thread).to.be.undefined;
        });

        it("should clean up thread on process crash", () => {
            const kernel = new Kernel();

            // A coroutine that crashes on the second step
            class CrashCoroutine extends Process {
                public readonly processName = "crashcoro";
                *run(): Generator<void, void, unknown> {
                    yield;
                    throw new Error("crash mid-coroutine");
                }
                serialize() { return {}; }
            }

            const proc = new CrashCoroutine(0, 5);
            kernel.addProcess(proc);

            // Tick 1: starts coroutine
            kernel.run();
            expect(proc.thread).to.not.be.undefined;

            // Tick 2: resumes and crashes
            kernel.run();
            expect(proc.thread).to.be.undefined;
            expect(proc.status).to.equal(ProcessStatus.DEAD);
        });
    });

    describe("Kernel Panic", () => {
        it("should trigger panic mode when bucket < 100", () => {
            const kernel = new Kernel();
            (globalThis as any).Game.cpu.bucket = 50; // Emergency

            kernel.run();

            expect(kernel.isPanicActive()).to.be.true;
        });

        it("should clear panic mode when bucket recovers", () => {
            const kernel = new Kernel();
            (globalThis as any).Game.cpu.bucket = 50;
            kernel.run();
            expect(kernel.isPanicActive()).to.be.true;

            (globalThis as any).Game.cpu.bucket = 600; // Normal
            kernel.run();
            expect(kernel.isPanicActive()).to.be.false;
        });
    });

    describe("Serialization", () => {
        it("should persist sleepUntil and processId", () => {
            const kernel = new Kernel();
            const proc = new TestProcess(0, 10, [], "test", "my-id");
            proc.sleep(100);

            kernel.addProcess(proc);
            kernel.serialize();

            const stored = Memory.kernel.processTable[0];
            expect(stored.processId).to.equal("my-id");
            expect(stored.sleepUntil).to.be.a("number");
        });

        it("should restore sleepUntil and processId", () => {
            // Fixed unused params: _parent, _data
            Kernel.registerProcess("test", (pid, prio, _parent, _data) =>
                new TestProcess(pid, prio, [], "test")
            );

            Memory.kernel = {
                processTable: [{
                    pid: 99,
                    priority: 10,
                    parentPID: null,
                    processName: "test",
                    processId: "restored-id",
                    status: ProcessStatus.SLEEP,
                    sleepUntil: 12345,
                    data: {}
                }],
                nextPID: 100
            };

            const kernel = Kernel.deserialize();
            const proc = kernel.getProcess(99) as TestProcess;

            expect(proc).to.exist;
            expect(proc.processId).to.equal("restored-id");
            expect(proc.sleepUntil).to.equal(12345);
            expect(proc.status).to.equal(ProcessStatus.SLEEP);
        });

        it("should rebuild all indexes on deserialize", () => {
            Kernel.registerProcess("test", (pid, prio, _parent, _data) =>
                new TestProcess(pid, prio, [], "test")
            );

            Memory.kernel = {
                processTable: [{
                    pid: 1,
                    priority: 10,
                    parentPID: null,
                    processName: "test",
                    processId: "test:one",
                    status: ProcessStatus.ALIVE,
                    data: {}
                }],
                nextPID: 2
            };

            const kernel = Kernel.deserialize();

            // O(1) index lookups should work
            expect(kernel.hasProcessId("test:one")).to.be.true;
            expect(kernel.getProcessById("test:one")?.pid).to.equal(1);
            expect(kernel.getProcessesByName("test")).to.have.length(1);
            expect(kernel.getPriorityLevels()).to.deep.equal([10]);
        });
    });
});
