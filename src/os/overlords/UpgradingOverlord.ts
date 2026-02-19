// ============================================================================
// UpgradingOverlord — IoC task assignment for upgrader creeps
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Upgrader } from "../zerg/Upgrader";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";
import { HarvestTask } from "../tasks/HarvestTask";
import { UpgradeTask } from "../tasks/UpgradeTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("Upgrading");

export class UpgradingOverlord extends Overlord {
    upgraders: Upgrader[];

    constructor(colony: Colony) {
        super(colony, "upgrading");
        this.upgraders = [];
    }

    init(): void {
        // adoptOrphans() removed — base Overlord getter handles adoption via _overlord tag
        this.upgraders = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "upgrader") as Upgrader[];

        this.handleSpawning();
    }

    run(): void {
        const controllerLink = this.colony.linkNetwork?.controllerLink;
        const controller = this.colony.room?.controller;

        for (const upgrader of this.upgraders) {
            if (!upgrader.isAlive()) continue;

            // ── Tri-Pipeline Optimization ──
            // If we have a link, lock the creep in place and execute
            // Withdraw AND Upgrade on the exact same tick (separate pipelines).
            if (controllerLink && controller) {
                if (!upgrader.pos?.inRangeTo(controllerLink, 1) || !upgrader.pos?.inRangeTo(controller, 3)) {
                    // Move into the "Sweet Spot" (Range 1 to Link, Range <=3 to Controller)
                    upgrader.travelTo(controllerLink, 1);
                    continue;
                } else {
                    // In position — execute both intents simultaneously!
                    const used = upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
                    const workParts = upgrader.creep?.getActiveBodyparts(WORK) ?? 0;

                    // If we don't have enough energy for the NEXT tick's upgrade, withdraw now
                    if (used <= workParts && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                        upgrader.withdraw(controllerLink);
                    }

                    // If we have any energy, upgrade now
                    if (used > 0) {
                        upgrader.upgradeController(controller);
                    }

                    if (upgrader.task) upgrader.setTask(null);
                    continue; // Skip standard task assignment
                }
            }

            if (upgrader.task) continue;

            // ── Standard Dynamic Upgrader Logic (Pre-Link) ──
            if (upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) === 0) {
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

                const source = upgrader.pos?.findClosestByRange(FIND_SOURCES_ACTIVE);
                if (source) {
                    upgrader.setTask(new HarvestTask(source.id));
                }
            } else {
                if (controller) {
                    upgrader.setTask(new UpgradeTask(controller.id));
                }
            }
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room) return;
        const storage = room.storage;
        const controller = room.controller;

        if (!controller) return;

        const downgradeImminent = controller.ticksToDowngrade < 4000;
        const hasStorage = storage && storage.store.energy > 0;
        const hasContainers = this.colony.logistics.offerIds.length > 0;
        const isRCL8 = controller.level === 8;

        if (!downgradeImminent && !hasStorage && !hasContainers && !isRCL8) {
            // ── Polymorphic Re-tasking (No Suicides!) ──
            if (this.upgraders.length > 0) {
                for (const u of this.upgraders) {
                    log.warning(`Polymorphic shift: Re-tasking gated upgrader ${u.name} to worker`);
                    if (u.memory) {
                        (u.memory as any).role = "worker";
                        (u.memory as any)._overlord = `worker:${this.colony.name}`;
                    }
                    u.setTask(null);
                }
                this.upgraders = []; // Clear array, WorkerOverlord will adopt them next tick
            }
            return;
        }

        let shouldSpawn = false;
        if (hasStorage && storage!.store.energy > 10000) shouldSpawn = true;
        else if (hasContainers && room.energyAvailable > room.energyCapacityAvailable * 0.9 && this.colony.creeps.length > 2) shouldSpawn = true;

        if (downgradeImminent) shouldSpawn = true;
        if (!shouldSpawn) return;

        let target = 1;
        if (isRCL8) target = 1; // HARD CAP: RCL 8 controllers max out at 15 energy/tick.
        else {
            if (storage && storage.store.energy > 100000) target = 3;
            if (storage && storage.store.energy > 500000) target = 5;
        }

        // Priority Inversion Fix: emergency upgraders spawn at near-max priority
        let priority = downgradeImminent ? 95 : 20;

        if (this.upgraders.length < target) {
            let template: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE];
            let maxEnergy: number | undefined = undefined;

            if (isRCL8) {
                // RCL 8 Optimal Body (15 WORK Limit)
                // 15 WORK, 1 CARRY, 8 MOVE = 2000 Energy
                template = [
                    WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK,
                    CARRY,
                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
                ];
                maxEnergy = 2000;
            } else if (this.colony.linkNetwork?.controllerLink) {
                template = [WORK, WORK, WORK, CARRY, MOVE]; // Heavy WORK for static links
            }

            this.colony.hatchery.enqueue({
                priority: priority,
                bodyTemplate: template,
                overlord: this,
                memory: { role: "upgrader" },
                maxEnergy: maxEnergy
            });
        }
    }
}
