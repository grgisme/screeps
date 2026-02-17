// ============================================================================
// MiningProcess.test.ts — Unit tests for the mining overlord
// ============================================================================

import "../mock.setup";
import { resetMocks } from "../mock.setup";
import { expect } from "chai";
import { MiningProcess } from "../../src/processes/MiningProcess";

describe("MiningProcess", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("should initialize with correct properties", () => {
        const proc = new MiningProcess(
            1,
            10,
            null,
            "sourceId123" as Id<Source>,
            "W1N1",
            2
        );
        expect(proc.pid).to.equal(1);
        expect(proc.priority).to.equal(10);
        expect(proc.processName).to.equal("mining");
        expect(proc.isAlive()).to.be.true;
    });

    it("should serialize process-specific state", () => {
        const proc = new MiningProcess(
            1,
            10,
            null,
            "sourceId456" as Id<Source>,
            "W2N2",
            3
        );
        const data = proc.serialize();

        expect(data.sourceId).to.equal("sourceId456");
        expect(data.roomName).to.equal("W2N2");
        expect(data.targetMiners).to.equal(3);
    });

    it("should deserialize process-specific state", () => {
        const proc = new MiningProcess(
            1,
            10,
            null,
            "temp" as Id<Source>,
            "temp"
        );
        proc.deserialize({
            sourceId: "restored_id",
            roomName: "E1S1",
            targetMiners: 4,
        });
        const data = proc.serialize();

        expect(data.sourceId).to.equal("restored_id");
        expect(data.roomName).to.equal("E1S1");
        expect(data.targetMiners).to.equal(4);
    });

    it("should produce a valid descriptor", () => {
        const proc = new MiningProcess(
            5,
            10,
            2,
            "src1" as Id<Source>,
            "W1N1",
            1
        );
        const desc = proc.toDescriptor();

        expect(desc.pid).to.equal(5);
        expect(desc.priority).to.equal(10);
        expect(desc.parentPID).to.equal(2);
        expect(desc.processName).to.equal("mining");
        expect(desc.data.sourceId).to.equal("src1");
        expect(desc.data.roomName).to.equal("W1N1");
    });

    describe("run()", () => {
        it("should run without error when room/source are not visible", () => {
            const proc = new MiningProcess(
                1,
                10,
                null,
                "nonexistent" as Id<Source>,
                "W9N9"
            );
            // No room or creeps set up — should just return gracefully
            expect(() => proc.run()).to.not.throw();
        });

        it("should spawn a miner when there is a deficit", () => {
            const proc = new MiningProcess(
                1,
                10,
                null,
                "src1" as Id<Source>,
                "W1N1",
                1
            );

            let spawned = false;
            const mockSpawn = {
                spawning: null,
                spawnCreep: (_body: any[], name: string, opts: any) => {
                    spawned = true;
                    // Simulate adding to Game.creeps
                    (Game as any).creeps[name] = {
                        name,
                        memory: opts.memory,
                        store: {
                            getFreeCapacity: () => 50,
                            getUsedCapacity: () => 0,
                        },
                        harvest: () => 0,
                        transfer: () => 0,
                        pos: new (globalThis as any).RoomPosition(25, 25, "W1N1"),
                    };
                    return 0; // OK
                },
            };

            (Game as any).rooms["W1N1"] = {
                energyAvailable: 300,
                controller: { my: true },
                find: (type: number) => {
                    if (type === (globalThis as any).FIND_MY_SPAWNS) {
                        return [mockSpawn];
                    }
                    if (type === (globalThis as any).FIND_SOURCES) {
                        return [];
                    }
                    return [];
                },
            };

            proc.run();
            expect(spawned).to.be.true;
        });
    });
});
