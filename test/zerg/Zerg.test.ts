// ============================================================================
// Zerg.test.ts — Unit tests for the Creep wrapper
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Zerg } from "../../src/zerg/Zerg";

describe("Zerg", () => {
    beforeEach(() => {
        resetMocks();
    });

    function getPathCache(): Map<string, { path: string; tick: number }> {
        return (globalThis as any)._heap._pathCache;
    }

    function createMockCreep(name: string, x = 10, y = 10, roomName = "W1N1") {
        const pos = new (globalThis as any).RoomPosition(x, y, roomName);
        const creep: any = {
            name,
            ticksToLive: 1500,
            pos,
            memory: { role: "test", pid: 1 },
            store: {
                getFreeCapacity: () => 50,
                getUsedCapacity: () => 0,
            },
            moveTo: (_target: any) => 0,
            moveByPath: (_path: any) => 0,
            harvest: () => 0,
        };
        (Game as any).creeps[name] = creep;
        return creep;
    }

    describe("Construction", () => {
        it("should construct from a Creep object", () => {
            const mockCreep = createMockCreep("zerg1");
            const zerg = new Zerg(mockCreep);
            expect(zerg.name).to.equal("zerg1");
            expect(zerg.creep).to.equal(mockCreep);
        });

        it("should construct from a name string (lazy resolution)", () => {
            createMockCreep("zerg2");
            const zerg = new Zerg("zerg2");
            expect(zerg.name).to.equal("zerg2");
            expect(zerg.creep.name).to.equal("zerg2");
        });

        it("should throw when resolving a non-existent creep name", () => {
            const zerg = new Zerg("nonexistent");
            expect(() => zerg.creep).to.throw(
                '[Zerg] Creep "nonexistent" not found in Game.creeps'
            );
        });
    });

    describe("travelTo", () => {
        it("should return OK when already at target", () => {
            const mockCreep = createMockCreep("atTarget", 25, 25, "W1N1");
            const zerg = new Zerg(mockCreep);
            const target = new (globalThis as any).RoomPosition(25, 25, "W1N1");

            const result = zerg.travelTo(target);
            expect(result).to.equal(0); // OK
        });

        it("should compute and cache a path on first call", () => {
            createMockCreep("pathTest", 10, 10, "W1N1");
            const zerg = new Zerg("pathTest");
            const target = new (globalThis as any).RoomPosition(20, 20, "W1N1");

            const result = zerg.travelTo(target);
            expect(result).to.equal(0);

            const cache = getPathCache();
            expect(cache.size).to.be.greaterThan(0);
        });

        it("should reuse cached path on subsequent calls within TTL", () => {
            const mockCreep = createMockCreep("cacheTest", 10, 10, "W1N1");
            let moveByPathCalls = 0;
            mockCreep.moveByPath = () => {
                moveByPathCalls++;
                return 0;
            };

            const zerg = new Zerg(mockCreep);
            const target = new (globalThis as any).RoomPosition(20, 20, "W1N1");

            zerg.travelTo(target);
            expect(moveByPathCalls).to.equal(1);

            zerg.travelTo(target);
            expect(moveByPathCalls).to.equal(2);
        });

        it("should recompute path after TTL expires", () => {
            createMockCreep("ttlTest", 10, 10, "W1N1");
            const zerg = new Zerg("ttlTest");
            const target = new (globalThis as any).RoomPosition(20, 20, "W1N1");

            zerg.travelTo(target);

            (Game as any).time = 100;
            zerg.travelTo(target);

            const cache = getPathCache();
            const key = `ttlTest:20:20:W1N1`;
            const entry = cache.get(key);
            expect(entry).to.exist;
            expect(entry!.tick).to.equal(100);
        });
    });

    describe("clearPathCache", () => {
        it("should clear all cached paths for the creep", () => {
            createMockCreep("clearTest", 10, 10, "W1N1");
            const zerg = new Zerg("clearTest");
            const target1 = new (globalThis as any).RoomPosition(20, 20, "W1N1");
            const target2 = new (globalThis as any).RoomPosition(30, 30, "W1N1");

            zerg.travelTo(target1);
            zerg.travelTo(target2);

            const cache = getPathCache();
            expect(cache.size).to.equal(2);

            zerg.clearPathCache();
            expect(cache.size).to.equal(0);
        });

        it("should not affect other creeps' caches", () => {
            createMockCreep("creep1", 10, 10, "W1N1");
            createMockCreep("creep2", 15, 15, "W1N1");
            const zerg1 = new Zerg("creep1");
            const zerg2 = new Zerg("creep2");
            const target = new (globalThis as any).RoomPosition(20, 20, "W1N1");

            zerg1.travelTo(target);
            zerg2.travelTo(target);

            const cache = getPathCache();
            expect(cache.size).to.equal(2);

            zerg1.clearPathCache();
            expect(cache.size).to.equal(1);
        });
    });

    describe("pos accessor", () => {
        it("should return the creep's current position", () => {
            createMockCreep("posTest", 5, 7, "E1N1");
            const zerg = new Zerg("posTest");
            expect(zerg.pos.x).to.equal(5);
            expect(zerg.pos.y).to.equal(7);
            expect(zerg.pos.roomName).to.equal("E1N1");
        });
    });
});
