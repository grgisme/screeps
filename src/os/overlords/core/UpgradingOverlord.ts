// ============================================================================
// UpgradingOverlord — IoC task assignment for upgrader creeps
// ============================================================================
//
// ⚠️ IoC PATTERN: Overlords assign tasks. They do NOT call zerg.run().
// Colony.run() iterates all zergs and calls zerg.run() once per tick.
// ============================================================================

import { Overlord } from "../Overlord";
import type { Colony } from "../../colony/Colony";
import { Upgrader } from "../../zerg/Upgrader";
import { WithdrawTask } from "../../tasks/WithdrawTask";
import { PickupTask } from "../../tasks/PickupTask";
import { HarvestTask } from "../../tasks/HarvestTask";
import { UpgradeTask } from "../../tasks/UpgradeTask";
import { Logger } from "../../../utils/Logger";

const log = new Logger("Upgrading");

export class UpgradingOverlord extends Overlord {
    upgraders: Upgrader[];

    constructor(colony: Colony) {
        super(colony, "upgrading");
        this.upgraders = [];
    }

    init(): void {
        // Cast existing zergs — no re-wrapping (prevents wrapper thrashing)
        this.upgraders = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "upgrader") as Upgrader[];

        this.adoptOrphans();
        this.handleSpawning();
    }

    run(): void {
        for (const upgrader of this.upgraders) {
            if (!upgrader.isAlive() || upgrader.task) continue;

            if (upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                // Empty — find energy source

                // 1. Controller Link (fastest path)
                const controllerLink = this.colony.linkNetwork?.controllerLink;
                if (controllerLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    upgrader.setTask(new WithdrawTask(controllerLink.id as Id<Structure | Tombstone | Ruin>));
                    continue;
                }

                // 2. LogisticsNetwork matching (polymorphic)
                const targetId = this.colony.logistics.matchWithdraw(upgrader);
                if (targetId) {
                    const target = Game.getObjectById(targetId);
                    if (target && 'amount' in target) {
                        upgrader.setTask(new PickupTask(targetId as Id<Resource>));
                    } else {
                        upgrader.setTask(new WithdrawTask(targetId as Id<Structure | Tombstone | Ruin>));
                    }
                    continue;
                }

                // 3. Peasant Mode fallback — harvest directly from source
                const source = upgrader.pos?.findClosestByRange(FIND_SOURCES_ACTIVE);
                if (source) {
                    upgrader.setTask(new HarvestTask(source.id));
                }
            } else {
                // Has energy — upgrade controller
                const controller = this.colony.room?.controller;
                if (controller) {
                    upgrader.setTask(new UpgradeTask(controller.id));
                }
            }
        }
    }

    private adoptOrphans(): void {
        if (Game.time % 100 !== 0) return;

        const orphans = this.colony.creeps.filter(
            (creep: Creep) => creep.memory.role === "upgrader" && !this.colony.getZerg(creep.name)
        );

        for (const orphan of orphans) {
            const zerg = this.colony.registerZerg(orphan);
            zerg.task = null;
            this.zergs.push(zerg);
            this.upgraders.push(zerg as Upgrader);
            log.info(`${this.colony.name}: Adopted orphan upgrader ${orphan.name}`);
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room) return;
        const storage = room.storage;
        const controller = room.controller;

        if (!controller) return;

        // ── Genesis Gate ───────────────────────────────────────────
        const downgradeImminent = controller.ticksToDowngrade < 4000;
        const hasStorage = storage && storage.store.energy > 0;
        const hasContainers = this.colony.logistics.offerIds.length > 0;
        const isRCL8 = controller.level === 8;

        if (!downgradeImminent && !hasStorage && !hasContainers && !isRCL8) {
            // Gate is closed — cleanup any existing upgraders
            if (this.upgraders.length > 0) {
                for (const u of this.upgraders) {
                    log.info(`Suiciding gated upgrader ${u.name} (no infrastructure)`);
                    u.creep?.suicide();
                }
                this.upgraders = [];
            }
            return;
        }

        // ── Spawn Gating (Death Spiral Prevention) ─────────────────
        let shouldSpawn = false;
        if (hasStorage && storage!.store.energy > 10000) {
            shouldSpawn = true;
        } else if (hasContainers && room!.energyAvailable > room!.energyCapacityAvailable * 0.9 && this.colony.creeps.length > 2) {
            shouldSpawn = true;
        }

        if (controller.ticksToDowngrade < 4000) {
            shouldSpawn = true;
        }

        if (!shouldSpawn) return;

        // ── Target Count Logic ─────────────────────────────────────
        let target = 1;
        if (storage && storage.store.energy > 100000) {
            target = 3;
        }
        if (storage && storage.store.energy > 500000) {
            target = 5;
        }

        // ── Priority ───────────────────────────────────────────────
        let priority = 4;
        if (controller.ticksToDowngrade < 4000) {
            priority = 2; // Critical
        }

        if (this.upgraders.length < target) {
            this.colony.hatchery.enqueue({
                priority: priority,
                bodyTemplate: [WORK, WORK, CARRY, MOVE],
                overlord: this,
                memory: { role: "upgrader" }
            });
        }
    }
}
