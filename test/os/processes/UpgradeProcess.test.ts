// ============================================================================
// UpgradeProcess.test.ts — Unit tests for the upgrade overlord
// ============================================================================

import "../../mock.setup";
import { resetMocks } from "../../mock.setup";
import { expect } from "chai";
import { UpgradeProcess } from "../../../src/os/processes/UpgradeProcess";

describe("UpgradeProcess", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("should initialize with correct properties", () => {
        const proc = new UpgradeProcess(1, 20, null, "W1N1", 2);
        expect(proc.pid).to.equal(1);
        expect(proc.priority).to.equal(20);
        expect(proc.processName).to.equal("upgrade");
        expect(proc.isAlive()).to.be.true;
    });

    it("should serialize process-specific state", () => {
        const proc = new UpgradeProcess(1, 20, null, "E5S5", 3);
        const data = proc.serialize();

        expect(data.roomName).to.equal("E5S5");
        expect(data.targetUpgraders).to.equal(3);
    });

    it("should deserialize process-specific state", () => {
        const proc = new UpgradeProcess(1, 20, null, "temp");
        proc.deserialize({
            roomName: "W3N3",
            targetUpgraders: 5,
        });
        const data = proc.serialize();

        expect(data.roomName).to.equal("W3N3");
        expect(data.targetUpgraders).to.equal(5);
    });

    it("should produce a valid descriptor", () => {
        const proc = new UpgradeProcess(3, 20, 1, "W1N1", 2);
        const desc = proc.toDescriptor();

        expect(desc.pid).to.equal(3);
        expect(desc.priority).to.equal(20);
        expect(desc.parentPID).to.equal(1);
        expect(desc.processName).to.equal("upgrade");
        expect(desc.data.roomName).to.equal("W1N1");
        expect(desc.data.targetUpgraders).to.equal(2);
    });

    describe("run()", () => {
        it("should run without error when room is not visible", () => {
            const proc = new UpgradeProcess(1, 20, null, "W9N9");
            expect(() => proc.run()).to.not.throw();
        });

        it("should spawn an upgrader when there is a deficit", () => {
            const proc = new UpgradeProcess(1, 20, null, "W1N1", 1);

            let spawned = false;
            const mockSpawn = {
                spawning: null,
                spawnCreep: (_body: any[], name: string, opts: any) => {
                    spawned = true;
                    (Game as any).creeps[name] = {
                        name,
                        memory: opts.memory,
                        store: {
                            getFreeCapacity: () => 50,
                            getUsedCapacity: () => 0,
                        },
                        harvest: () => 0,
                        upgradeController: () => 0,
                        withdraw: () => 0,
                        pos: new (globalThis as any).RoomPosition(25, 25, "W1N1"),
                    };
                    return 0; // OK
                },
            };

            (Game as any).rooms["W1N1"] = {
                energyAvailable: 400,
                controller: { my: true, pos: new (globalThis as any).RoomPosition(25, 25, "W1N1") },
                storage: null,
                find: (type: number) => {
                    if (type === (globalThis as any).FIND_MY_SPAWNS) {
                        return [mockSpawn];
                    }
                    if (type === (globalThis as any).FIND_STRUCTURES) {
                        return [];
                    }
                    if (type === (globalThis as any).FIND_SOURCES_ACTIVE) {
                        return [];
                    }
                    return [];
                },
            };

            proc.run();
            expect(spawned).to.be.true;
        });

        it("should not spawn when at target count", () => {
            const proc = new UpgradeProcess(1, 20, null, "W1N1", 1);

            let spawnAttempted = false;
            const mockSpawn = {
                spawning: null,
                spawnCreep: () => {
                    spawnAttempted = true;
                    return 0;
                },
            };

            // Simulate an existing upgrader assigned to this PID
            (Game as any).creeps["upgrader_1_1"] = {
                name: "upgrader_1_1",
                memory: { role: "upgrader", pid: 1, homeRoom: "W1N1" },
                store: {
                    getFreeCapacity: () => 0,
                    getUsedCapacity: () => 50,
                },
                upgradeController: () => 0,
                pos: new (globalThis as any).RoomPosition(25, 25, "W1N1"),
            };

            (Game as any).rooms["W1N1"] = {
                energyAvailable: 400,
                controller: { my: true, pos: new (globalThis as any).RoomPosition(25, 25, "W1N1") },
                storage: null,
                find: (type: number) => {
                    if (type === (globalThis as any).FIND_MY_SPAWNS) {
                        return [mockSpawn];
                    }
                    return [];
                },
            };

            proc.run();
            expect(spawnAttempted).to.be.false;
        });
    });
});
