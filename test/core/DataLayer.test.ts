// ============================================================================
// DataLayer.test.ts — Unit tests for Heap-First Architecture & Segments
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { GlobalCache } from "../../src/utils/GlobalCache";
import { SegmentManager } from "../../src/core/memory/SegmentManager";
import { GlobalManager } from "../../src/core/GlobalManager";

describe("Data Layer Optimization", () => {
    beforeEach(() => {
        resetMocks();
        GlobalCache.clear();
        (globalThis as any)._heap = undefined;
        // Reset RawMemory simulation
        (globalThis as any).RawMemory = {
            segments: {},
            setActiveSegments: (ids: number[]) => {
                (globalThis as any)._activeSegments = ids;
            }
        };
    });

    describe("GlobalCache (Hydration)", () => {
        it("should rehydrate from heap if available", () => {
            let callCount = 0;
            const generator = () => { callCount++; return { foo: "bar" }; };

            // First call: generates
            const obj1 = GlobalCache.rehydrate("testKey", generator);
            expect(obj1.foo).to.equal("bar");
            expect(callCount).to.equal(1);

            // Second call: retrieves from heap
            const obj2 = GlobalCache.rehydrate("testKey", generator);
            expect(obj2).to.equal(obj1); // Same reference
            expect(callCount).to.equal(1); // Generator not called again
        });

        it("should commit dirty state to Memory", () => {
            const key = "persistentKey";
            const data = { counter: 1 };

            GlobalCache.rehydrate(key,
                () => data,
                (obj) => ({ counter: obj.counter }) // Serializer
            );

            // Data modified
            data.counter = 2;
            GlobalCache.markDirty(key);

            GlobalCache.commit();

            expect(Memory.heap).to.exist;
            expect(Memory.heap![key]).to.deep.equal({ counter: 2 });
        });

        it("should not commit clean state", () => {
            const key = "cleanKey";
            GlobalCache.rehydrate(key,
                () => ({ val: 1 }),
                (obj) => obj
            );

            // No markDirty called
            GlobalCache.commit();

            expect(Memory.heap?.[key]).to.be.undefined;
        });
    });

    describe("SegmentManager", () => {
        it("should allow requesting segments up to limit", () => {
            // Request 10 segments
            for (let i = 0; i < 10; i++) {
                SegmentManager.request(i);
            }

            // Request 11th - should fail/warn (but we check internal state indirectly or mock)
            // Ideally we check if it was added. 
            // Currently SegmentManager doesn't expose requested set.
            // But we can check commit.

            SegmentManager.commit();
            const active = (globalThis as any)._activeSegments as number[];
            expect(active).to.have.length(10);
            expect(active).to.include(0);
            expect(active).to.include(9);
        });

        it("should reject requests beyond limit", () => {
            for (let i = 0; i < 15; i++) {
                SegmentManager.request(i);
            }
            SegmentManager.commit();
            const active = (globalThis as any)._activeSegments as number[];
            expect(active).to.have.length(10); // Clamped to 10
        });

        it("should validate segment IDs (0-99)", () => {
            expect(() => SegmentManager.request(-1)).to.throw();
            expect(() => SegmentManager.request(100)).to.throw();
        });

        it("should save data immediately to RawMemory active cache", () => {
            SegmentManager.save(5, "some data");
            expect(RawMemory.segments[5]).to.equal("some data");
        });
    });

    describe("GlobalManager", () => {
        it("should init globals on reset", () => {
            // 1. Simulate reset
            GlobalManager.init();
            expect(GlobalCache.isGlobalReset()).to.be.false; // Init calls checking, so second check is false
            // Actually init() calls isGlobalReset internaly.
            // Lets reset cache first
            GlobalCache.clear();
            (globalThis as any)._heap = undefined;

            // Mock Logger to verify init log
            // ... assuming logger works
            GlobalManager.init();
            // Not throwing is a good start.
        });
    });
});
