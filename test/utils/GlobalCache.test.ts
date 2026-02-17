// ============================================================================
// GlobalCache.test.ts — Unit tests for the heap cache
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { GlobalCache } from "../../src/utils/GlobalCache";

describe("GlobalCache", () => {
    beforeEach(() => {
        resetMocks();
    });

    describe("isGlobalReset", () => {
        it("should return true on the first call after reset", () => {
            expect(GlobalCache.isGlobalReset()).to.be.true;
        });

        it("should return false on subsequent calls", () => {
            GlobalCache.isGlobalReset(); // First call
            expect(GlobalCache.isGlobalReset()).to.be.false;
            expect(GlobalCache.isGlobalReset()).to.be.false;
        });

        it("should initialize the heap cache maps", () => {
            GlobalCache.isGlobalReset();
            const heap = (globalThis as any)._heap;
            expect(heap._cache).to.be.an.instanceOf(Map);
            expect(heap._pathCache).to.be.an.instanceOf(Map);
        });
    });

    describe("get / set", () => {
        beforeEach(() => {
            GlobalCache.isGlobalReset(); // Initialize caches
        });

        it("should store and retrieve values", () => {
            GlobalCache.set("testKey", { foo: "bar" });
            const result = GlobalCache.get<{ foo: string }>("testKey");
            expect(result).to.deep.equal({ foo: "bar" });
        });

        it("should return undefined for missing keys", () => {
            const result = GlobalCache.get("nonexistent");
            expect(result).to.be.undefined;
        });

        it("should overwrite existing values", () => {
            GlobalCache.set("key", 1);
            GlobalCache.set("key", 2);
            expect(GlobalCache.get<number>("key")).to.equal(2);
        });

        it("should handle different types", () => {
            GlobalCache.set("num", 42);
            GlobalCache.set("str", "hello");
            GlobalCache.set("arr", [1, 2, 3]);

            expect(GlobalCache.get<number>("num")).to.equal(42);
            expect(GlobalCache.get<string>("str")).to.equal("hello");
            expect(GlobalCache.get<number[]>("arr")).to.deep.equal([1, 2, 3]);
        });
    });

    describe("delete", () => {
        beforeEach(() => {
            GlobalCache.isGlobalReset();
        });

        it("should delete an existing key", () => {
            GlobalCache.set("key", "value");
            const result = GlobalCache.delete("key");
            expect(result).to.be.true;
            expect(GlobalCache.get("key")).to.be.undefined;
        });

        it("should return false for non-existent key", () => {
            const result = GlobalCache.delete("nonexistent");
            expect(result).to.be.false;
        });
    });

    describe("clear", () => {
        beforeEach(() => {
            GlobalCache.isGlobalReset();
        });

        it("should clear all cached values", () => {
            GlobalCache.set("a", 1);
            GlobalCache.set("b", 2);
            GlobalCache.clear();

            expect(GlobalCache.get("a")).to.be.undefined;
            expect(GlobalCache.get("b")).to.be.undefined;
        });
    });

    describe("getPathCache", () => {
        beforeEach(() => {
            GlobalCache.isGlobalReset();
        });

        it("should return the path cache map", () => {
            const pathCache = GlobalCache.getPathCache();
            expect(pathCache).to.be.an.instanceOf(Map);
        });

        it("should return the same map instance across calls", () => {
            const cache1 = GlobalCache.getPathCache();
            const cache2 = GlobalCache.getPathCache();
            expect(cache1).to.equal(cache2);
        });
    });
});
