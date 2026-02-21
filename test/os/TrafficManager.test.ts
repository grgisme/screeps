// ============================================================================
// TrafficManager.test.ts — Unit tests for Bipartite Graph Traffic Resolution
// ============================================================================

import "../mock.setup";
import { resetMocks, MockRoom } from "../mock.setup";
import { expect } from "chai";
import { Zerg } from "../../src/os/zerg/Zerg";
import { TrafficManager } from "../../src/os/infrastructure/TrafficManager";


describe("Movement Optimization", () => {
    let zerg: Zerg;
    let creep: Creep;

    beforeEach(() => {
        resetMocks();

        // Create room with find() support
        const room = new MockRoom("W1N1") as any;
        room.controller = { owner: { username: "Player" }, my: true };
        (globalThis as any).Game.rooms["W1N1"] = room;

        creep = new Creep("scout1" as Id<Creep>);
        creep.pos = new RoomPosition(10, 10, "W1N1");
        (creep as any).my = true;
        (creep as any).fatigue = 0;
        creep.move = (() => OK) as any;
        (creep as any).room = room;

        (globalThis as any).Game.creeps["scout1"] = creep;
        zerg = new Zerg(creep.name);

        // Override room.find to return creeps from Game.creeps for this room
        room.find = (type: number) => {
            if (type === FIND_MY_CREEPS) {
                return Object.values(Game.creeps).filter((c: any) => c.pos?.roomName === "W1N1");
            }
            if (type === FIND_CREEPS) {
                return Object.values(Game.creeps).filter((c: any) => c.pos?.roomName === "W1N1");
            }
            if (type === FIND_STRUCTURES) return [];
            return [];
        };
    });

    describe("Zerg.travelTo (Path Caching)", () => {
        it("should cache path after first call", () => {
            const target = new RoomPosition(12, 10, "W1N1");

            // First call: Should generate path
            zerg.travelTo(target, 0);

            expect(zerg._path).to.not.be.null;
            expect(zerg._path?.target).to.equal(target.toString());
            expect(zerg._path?.ticksToLive).to.equal(zerg._path?.path.length);
        });

        it("should reuse cached path", () => {
            const target = new RoomPosition(12, 10, "W1N1");

            zerg.travelTo(target, 0);
            const pathRef = zerg._path;

            // Move creep to next pos (simulated)
            creep.pos = new RoomPosition(11, 10, "W1N1");

            // Second call
            zerg.travelTo(target, 0);
            expect(zerg._path).to.equal(pathRef); // Should be same object
            expect(zerg._path?.step).to.equal(1);
        });

        it("should repath if stuck", () => {
            const target = new RoomPosition(15, 10, "W1N1");

            zerg.travelTo(target, 0);
            const initialPath = zerg._path;
            expect(initialPath).to.not.be.null;

            // Stuck for 3 ticks (position doesn't change)
            zerg.travelTo(target, 0); // stuckCount = 1
            zerg.travelTo(target, 0); // stuckCount = 2
            zerg.travelTo(target, 0); // stuckCount = 3, triggers repath

            expect(zerg._stuckCount).to.equal(3);
            expect(zerg._path).to.not.be.null;
            expect(zerg._path).to.not.equal(initialPath);
        });
    });

    describe("TrafficManager (Bipartite Graph Matching)", () => {
        it("should execute move intent via Gale-Shapley", () => {
            const target = new RoomPosition(11, 10, "W1N1");

            let moveDir: DirectionConstant | null = null;
            creep.move = ((target: DirectionConstant | Creep) => {
                if (typeof target === "number") {
                    moveDir = target;
                }
                return OK;
            }) as any;

            zerg.travelTo(target, 0);
            TrafficManager.run();

            expect(moveDir).to.equal(RIGHT);
        });

        it("should resolve traffic when no intents are registered", () => {
            // Just run with no intents — should not crash
            TrafficManager.run();
        });

        it("should handle multiple creeps wanting different tiles", () => {
            // Create a second creep
            const creep2 = new Creep("hauler1" as Id<Creep>);
            creep2.pos = new RoomPosition(12, 10, "W1N1");
            (creep2 as any).my = true;
            (creep2 as any).fatigue = 0;
            creep2.move = (() => OK) as any;
            (globalThis as any).Game.creeps["hauler1"] = creep2;
            const zerg2 = new Zerg(creep2.name);

            let moveDir1: DirectionConstant | null = null;
            let moveDir2: DirectionConstant | null = null;
            creep.move = ((t: DirectionConstant | Creep) => {
                if (typeof t === "number") moveDir1 = t;
                return OK;
            }) as any;
            creep2.move = ((t: DirectionConstant | Creep) => {
                if (typeof t === "number") moveDir2 = t;
                return OK;
            }) as any;

            // Both want different targets — no conflict
            zerg.travelTo(new RoomPosition(11, 10, "W1N1"), 0);
            zerg2.travelTo(new RoomPosition(13, 10, "W1N1"), 0);
            TrafficManager.run();

            expect(moveDir1).to.equal(RIGHT);  // scout1 moves right
            expect(moveDir2).to.equal(RIGHT);  // hauler1 moves right
        });

        it("should not shove stationary miners", () => {
            // Place a miner at the target
            const miner = new Creep("miner1" as Id<Creep>);
            miner.pos = new RoomPosition(11, 10, "W1N1");
            (miner as any).my = true;
            (miner as any).fatigue = 0;
            miner.memory = { role: "miner" } as any;
            miner.move = (() => OK) as any;
            (globalThis as any).Game.creeps["miner1"] = miner;

            // Track whether miner was told to move
            let minerMoveDir: DirectionConstant | null = null;
            miner.move = ((t: DirectionConstant | Creep) => {
                if (typeof t === "number") minerMoveDir = t;
                return OK;
            }) as any;

            zerg.travelTo(new RoomPosition(11, 10, "W1N1"), 0);
            TrafficManager.run();

            // Miner should not have been moved by graph matching
            // (The tile's score function gives miners +10000 on their current tile)
            expect(minerMoveDir).to.be.null;
        });
    });
});
