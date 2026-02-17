// ============================================================================
// TrafficManager.test.ts — Unit tests for Movement Optimization
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { Zerg } from "../../src/os/infrastructure/Zerg";
import { TrafficManager } from "../../src/os/infrastructure/TrafficManager";
import "../../src/prototypes/RoomPosition"; // Ensure prototype is loaded

describe("Movement Optimization", () => {
    let zerg: Zerg;
    let creep: Creep;

    beforeEach(() => {
        resetMocks();
        creep = new Creep("scout1" as Id<Creep>);
        creep.pos = new RoomPosition(10, 10, "W1N1");
        // Ensure move method exists (MockCreep should have it, but just in case)
        creep.move = (() => OK) as any;

        // Mock Room
        const room = {
            name: "W1N1",
            controller: { owner: { username: "Player" }, my: true }
        } as any;
        (creep as any).room = room;

        (globalThis as any).Game.creeps["scout1"] = creep;
        zerg = new Zerg(creep);
    });

    describe("Zerg.travelTo (Path Caching)", () => {
        it("should cache path after first call", () => {
            const target = new RoomPosition(12, 10, "W1N1");

            // First call: Should generate path
            zerg.travelTo(target, 0);

            expect(zerg._path).to.not.be.null;
            expect(zerg._path?.target).to.equal(target.toString());
            // Path length is 3. Step 0 taken. Remaining TTL = 2.
            expect(zerg._path?.ticksToLive).to.equal(2);
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
            expect(zerg._path?.step).to.equal(2); // Advanced step
        });

        it("should repath if stuck", () => {
            const target = new RoomPosition(15, 10, "W1N1");

            zerg.travelTo(target, 0);
            const initialPath = zerg._path;

            // Stuck for 3 ticks
            zerg.travelTo(target, 0);
            zerg.travelTo(target, 0);
            zerg.travelTo(target, 0);

            expect(zerg._stuckCount).to.be.greaterThan(2);

            // Next call should invalidate and repath
            zerg.travelTo(target, 0);
            expect(zerg._path).to.not.equal(initialPath);
            expect(zerg._stuckCount).to.equal(0);
        });
    });

    describe("TrafficManager", () => {
        it("should execute move intent", () => {
            const target = new RoomPosition(11, 10, "W1N1");

            // Mock move
            let moveDir: DirectionConstant | null = null;
            creep.move = ((target: DirectionConstant | Creep) => {
                if (typeof target === "number") {
                    moveDir = target;
                }
                return OK;
            }) as any;

            zerg.travelTo(target, 0); // Registers intent

            TrafficManager.run();

            expect(moveDir).to.equal(RIGHT);
        });

        it("should shove idle blocker", () => {
            // Setup blocker
            const blockerCreep = new Creep("blocker" as Id<Creep>);
            blockerCreep.pos = new RoomPosition(11, 10, "W1N1");
            // Mock owner
            (blockerCreep as any).owner = { username: "Player" };
            (zerg.room as any).controller = { owner: { username: "Player" } };

            let blockerMoveDir: DirectionConstant | null = null;
            blockerCreep.move = ((target: DirectionConstant | Creep) => {
                if (typeof target === "number") {
                    blockerMoveDir = target;
                }
                return OK;
            }) as any;
            (globalThis as any).Game.creeps["blocker"] = blockerCreep;

            // Setup mover (zerg)
            const target = new RoomPosition(11, 10, "W1N1");

            // Mock mover move
            let moverMoveDir: DirectionConstant | null = null;
            creep.move = ((target: DirectionConstant | Creep) => {
                if (typeof target === "number") {
                    moverMoveDir = target;
                }
                return OK;
            }) as any;

            // Register high priority move
            zerg.travelTo(target, 0, 0); // Priority 0

            TrafficManager.run();

            expect(moverMoveDir).to.equal(RIGHT);
            expect(blockerMoveDir).to.not.be.null; // Blocker should have moved
        });
    });
});
