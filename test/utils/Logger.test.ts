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
    });

    afterEach(() => {
        console.log = originalLog;
    });

    describe("Log Levels", () => {
        it("should have correct numeric values", () => {
            expect(LogLevel.DEBUG).to.equal(0);
            expect(LogLevel.INFO).to.equal(1);
            expect(LogLevel.WARNING).to.equal(2);
            expect(LogLevel.ERROR).to.equal(3);
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

        it("should include HTML color spans", () => {
            const log = new Logger("X");
            log.error("test");
            expect(logOutput[0]).to.include("style='color:");
        });
    });

    describe("Memory Persistence", () => {
        it("should persist level changes to Memory", () => {
            Logger.setLevel(LogLevel.DEBUG);
            expect(Memory.logLevel).to.equal(0);
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

        it("should log an error for unknown level names", () => {
            Logger.setLevelByName("invalid");
            expect(logOutput).to.have.length(1);
            expect(logOutput[0]).to.include("Unknown level");
        });
    });
});
