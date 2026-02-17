// ============================================================================
// ProfilerProcess.test.ts — Unit tests for the CPU profiler
// ============================================================================

import "../../mock.setup";
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { ProfilerProcess } from "../../../src/os/processes/ProfilerProcess";
import { Kernel } from "../../../src/kernel/Kernel";
import { GlobalCache } from "../../../src/kernel/GlobalCache";

describe("ProfilerProcess", () => {
    let logOutput: string[];
    let originalLog: typeof console.log;

    beforeEach(() => {
        resetMocks();
        GlobalCache.isGlobalReset(); // Initialize heap
        logOutput = [];
        originalLog = console.log;
        console.log = (...args: any[]) => {
            logOutput.push(args.join(" "));
        };
    });

    afterEach(() => {
        console.log = originalLog;
    });

    it("should initialize with correct properties", () => {
        const proc = new ProfilerProcess(1, 0);
        expect(proc.pid).to.equal(1);
        expect(proc.priority).to.equal(0);
        expect(proc.processName).to.equal("profiler");
        expect(proc.isAlive()).to.be.true;
    });

    it("should serialize to empty object (heap-only state)", () => {
        const proc = new ProfilerProcess(1, 0);
        const data = proc.serialize();
        expect(data).to.deep.equal({});
    });

    it("should produce a valid descriptor", () => {
        const proc = new ProfilerProcess(5, 0, null);
        const desc = proc.toDescriptor();
        expect(desc.processName).to.equal("profiler");
        expect(desc.priority).to.equal(0);
    });

    it("should not crash when kernel is not in heap", () => {
        const proc = new ProfilerProcess(1, 0);
        expect(() => proc.run()).to.not.throw();
    });

    describe("CPU Tracking", () => {
        it("should accumulate CPU data from kernel profile", () => {
            const kernel = new Kernel();

            // Simulate a CPU profile
            const fakeProfile = new Map<string, number>();
            fakeProfile.set("mining", 5.2);
            fakeProfile.set("upgrade", 2.1);

            // Store kernel and inject profile
            kernel.saveToHeap();
            (kernel as any)._cpuProfile = fakeProfile;

            const proc = new ProfilerProcess(1, 0);
            proc.run();

            // Should not report yet (only 1 tick)
            expect(logOutput).to.have.length(0);
        });

        it("should output report after 20 ticks", () => {
            const kernel = new Kernel();
            kernel.saveToHeap();

            const fakeProfile = new Map<string, number>();
            fakeProfile.set("mining", 3.0);
            fakeProfile.set("upgrade", 1.5);
            (kernel as any)._cpuProfile = fakeProfile;

            const proc = new ProfilerProcess(1, 0);

            // Run for 20 ticks
            for (let i = 0; i < 20; i++) {
                proc.run();
            }

            // Should have outputted a report
            const reportOutput = logOutput.join("\n");
            expect(reportOutput).to.include("[Profiler]");
            expect(reportOutput).to.include("Top CPU Consumers");
            expect(reportOutput).to.include("mining");
            expect(reportOutput).to.include("upgrade");
        });

        it("should reset accumulator after report", () => {
            const kernel = new Kernel();
            kernel.saveToHeap();

            const fakeProfile = new Map<string, number>();
            fakeProfile.set("mining", 3.0);
            (kernel as any)._cpuProfile = fakeProfile;

            const proc = new ProfilerProcess(1, 0);

            // Run for 20 ticks to trigger report
            for (let i = 0; i < 20; i++) {
                proc.run();
            }

            // Clear output
            logOutput.length = 0;

            // Run one more tick — should not report (accumulator was reset)
            proc.run();
            expect(logOutput).to.have.length(0);
        });

        it("should sort entries by CPU usage descending", () => {
            const kernel = new Kernel();
            kernel.saveToHeap();

            const fakeProfile = new Map<string, number>();
            fakeProfile.set("upgrade", 1.0); // Lower
            fakeProfile.set("mining", 5.0);  // Higher
            (kernel as any)._cpuProfile = fakeProfile;

            const proc = new ProfilerProcess(1, 0);

            for (let i = 0; i < 20; i++) {
                proc.run();
            }

            const reportOutput = logOutput.join("\n");
            const miningIdx = reportOutput.indexOf("mining");
            const upgradeIdx = reportOutput.indexOf("upgrade");
            expect(miningIdx).to.be.lessThan(upgradeIdx);
        });
    });
});
