// ============================================================================
// Logger.test.ts — Unit tests for the Logger utility
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Logger, LogLevel } from "../../src/utils/Logger";

describe("Logger", () => {
    let logOutput: string[];
    let originalLog: typeof console.log;

    beforeEach(() => {
        resetMocks();
        logOutput = [];
        originalLog = console.log;
        console.log = (...args: any[]) => {
            logOutput.push(args.join(" "));
        };
        Logger.resetDeltaCache();
    });

    afterEach(() => {
        console.log = originalLog;
    });

    describe("Log Levels", () => {
        it("should have correct numeric values", () => {
            expect(LogLevel.TRACE).to.equal(0);
            expect(LogLevel.DEBUG).to.equal(1);
            expect(LogLevel.INFO).to.equal(2);
            expect(LogLevel.WARNING).to.equal(3);
            expect(LogLevel.ERROR).to.equal(4);
        });
    });

    describe("Level Filtering", () => {
        it("should default to INFO level", () => {
            expect(Logger.getLevel()).to.equal(LogLevel.INFO);
        });

        it("should filter out DEBUG messages at INFO level", () => {
            const log = new Logger("Test");
            log.debug("hidden message");
            expect(logOutput).to.have.length(0);
        });

        it("should filter out TRACE messages at INFO level", () => {
            const log = new Logger("Test");
            log.trace("hidden trace");
            expect(logOutput).to.have.length(0);
        });

        it("should show INFO messages at INFO level", () => {
            const log = new Logger("Test");
            log.info("visible message");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("visible message");
        });

        it("should show WARNING messages at INFO level", () => {
            const log = new Logger("Test");
            log.warning("warn message");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("warn message");
        });

        it("should show ERROR messages at INFO level", () => {
            const log = new Logger("Test");
            log.error("error message");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("error message");
        });

        it("should show DEBUG messages when level is DEBUG", () => {
            Logger.setLevel(LogLevel.DEBUG);
            const log = new Logger("Test");
            log.debug("debug visible");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("debug visible");
        });

        it("should show TRACE messages when level is TRACE", () => {
            Logger.setLevel(LogLevel.TRACE);
            const log = new Logger("Test");
            log.trace("trace visible");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("trace visible");
        });

        it("should filter INFO at ERROR level", () => {
            Logger.setLevel(LogLevel.ERROR);
            const log = new Logger("Test");
            log.info("hidden");
            log.warning("hidden");
            log.error("visible");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("visible");
        });
    });

    describe("Lazy Evaluation", () => {
        it("should accept a function and only call it when logging", () => {
            const log = new Logger("Test");
            let called = false;
            log.info(() => { called = true; return "lazy msg"; });
            expect(called).to.be.true;
            expect(logOutput[0]).to.include("lazy msg");
        });

        it("should NOT call the function when level is filtered", () => {
            const log = new Logger("Test");
            let called = false;
            log.debug(() => { called = true; return "expensive"; });
            expect(called).to.be.false;
            expect(logOutput).to.have.length(0);
        });
    });

    describe("Console Output", () => {
        it("should include the tag in output", () => {
            const log = new Logger("MyModule");
            log.info("test");
            expect(logOutput[0]).to.include("[MyModule]");
        });

        it("should include the level label", () => {
            const log = new Logger("X");
            log.info("test");
            expect(logOutput[0]).to.include("[INFO]");
        });

        it("should include emoji and level label", () => {
            const log = new Logger("X");
            log.error("test");
            expect(logOutput[0]).to.include("🛑");
            expect(logOutput[0]).to.include("[ERROR]");
        });
    });

    describe("Delta Alert", () => {
        it("should log the first call", () => {
            const log = new Logger("Test");
            log.alert("state", "Harvesting");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("Harvesting");
        });

        it("should suppress repeated identical values", () => {
            const log = new Logger("Test");
            log.alert("state", "Harvesting");
            log.alert("state", "Harvesting");
            log.alert("state", "Harvesting");
            expect(logOutput).to.have.length(1);
        });

        it("should log when value changes", () => {
            const log = new Logger("Test");
            log.alert("state", "Harvesting");
            log.alert("state", "Upgrading");
            expect(logOutput).to.have.length(2);
            expect(logOutput[1]).to.include("Upgrading");
        });

        it("should track keys independently", () => {
            const log = new Logger("Test");
            log.alert("worker1", "Harvesting");
            log.alert("worker2", "Building");
            expect(logOutput).to.have.length(2);
        });
    });

    describe("Modulo Throttle", () => {
        it("should log when (Game.time + offset) % interval === 0", () => {
            (global as any).Game.time = 100;
            const log = new Logger("Test");
            log.throttle(100, "status update");
            expect(logOutput).to.have.length(1);
        });

        it("should suppress when not on interval", () => {
            (global as any).Game.time = 101;
            const log = new Logger("Test");
            log.throttle(100, "status update");
            expect(logOutput).to.have.length(0);
        });

        it("should support lazy messages", () => {
            (global as any).Game.time = 200;
            const log = new Logger("Test");
            let called = false;
            log.throttle(100, () => { called = true; return "lazy"; });
            expect(called).to.be.true;
        });

        it("should not evaluate lazy message when throttled", () => {
            (global as any).Game.time = 201;
            const log = new Logger("Test");
            let called = false;
            log.throttle(100, () => { called = true; return "lazy"; });
            expect(called).to.be.false;
        });
    });

    describe("Memory Persistence", () => {
        it("should persist level changes to Memory", () => {
            Logger.setLevel(LogLevel.DEBUG);
            expect(Memory.logLevel).to.equal(LogLevel.DEBUG);
        });

        it("should read level from Memory", () => {
            Memory.logLevel = LogLevel.ERROR;
            expect(Logger.getLevel()).to.equal(LogLevel.ERROR);
        });
    });

    describe("setLevelByName", () => {
        it("should set level from string name", () => {
            Logger.setLevelByName("debug");
            expect(Logger.getLevel()).to.equal(LogLevel.DEBUG);
        });

        it("should handle case-insensitive input", () => {
            Logger.setLevelByName("WARNING");
            expect(Logger.getLevel()).to.equal(LogLevel.WARNING);
        });

        it("should accept 'warn' as alias for WARNING", () => {
            Logger.setLevelByName("warn");
            expect(Logger.getLevel()).to.equal(LogLevel.WARNING);
        });

        it("should accept 'trace' level", () => {
            Logger.setLevelByName("trace");
            expect(Logger.getLevel()).to.equal(LogLevel.TRACE);
        });

        it("should log an error for unknown level names", () => {
            Logger.setLevelByName("invalid");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("Unknown level");
        });
    });
});
