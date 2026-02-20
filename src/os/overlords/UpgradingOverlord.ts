import { Overlord } from "./Overlord";
import { HarvestTask } from "../tasks/HarvestTask";
import { UpgradeTask } from "../tasks/UpgradeTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("Upgrading");

export class UpgradingOverlord extends Overlord {
    upgraders: any[] = [];

    constructor(colony: any) {
        super(colony, "upgrading");
    }

    init() {
        this.upgraders = this.zergs.filter(z => z.isAlive() && z.memory?.role === "upgrader");

        // Register Upgraders as Energy Sinks for creep-to-creep transfers
        for (const upgrader of this.upgraders) {
            const creep = upgrader.creep;
            if (creep) {
                const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free > 0) {
                    // Priority 4 ensures Spawns/Exts (10) and Towers (5) are filled first
                    this.colony.logistics.requestInput(creep.id as any, { amount: free, priority: 4 });
                }
            }
        }

        this.handleSpawning();
    }

    run() {
        const controllerLink = this.colony.linkNetwork?.controllerLink;
        const controller = this.colony.room?.controller;
        const activeMiners = this.colony.creeps.filter((c: any) => c.memory.role === "miner");
        const minedSourceIds = new Set(activeMiners.map((m: any) => m.memory.state?.siteId));

        // Check for Transporters
        const hasTransporters = this.colony.creeps.some((c: any) => c.memory.role === "transporter");

        for (const upgrader of this.upgraders) {
            if (!upgrader.isAlive()) continue;

            // Existing Link Logic
            if (controllerLink && controller) {
                if (!upgrader.pos?.inRangeTo(controllerLink, 1) || !upgrader.pos?.inRangeTo(controller, 3)) {
                    upgrader.travelTo(controllerLink, 1);
                    continue;
                } else {
                    const used = upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
                    const workParts = upgrader.creep?.getActiveBodyparts(WORK) ?? 0;
                    if (used <= workParts && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                        upgrader.withdraw(controllerLink);
                    }
                    if (used > 0) {
                        upgrader.upgradeController(controller);
                    }
                    if (upgrader.task) upgrader.setTask(null);
                    continue;
                }
            }

            if (upgrader.task) continue;

            const mem = upgrader.memory as any;

            // STATE MACHINE LOGIC
            if ((upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) === 0) {

                // When transporters exist: stay near controller, wait for delivery
                // (upgraders are registered as requesters — haulers deliver to them)
                if (hasTransporters && controller) {
                    if (upgrader.pos && upgrader.pos.getRangeTo(controller) > 3) {
                        upgrader.travelTo(controller, 3);
                    }
                    continue;
                }

                // No transporters — self-collect via LogisticsNetwork
                mem.collecting = true;
            }

            // Toggle collecting state off when full so we don't crumb chase
            if ((upgrader.store?.getFreeCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                mem.collecting = false;
            }

            if (mem.collecting) {
                const targetId = this.colony.logistics.matchWithdraw(upgrader);
                if (targetId) {
                    const target = Game.getObjectById(targetId) as any;
                    if (target && 'amount' in target) {
                        upgrader.setTask(new PickupTask(targetId as Id<Resource>));
                    } else {
                        upgrader.setTask(new WithdrawTask(targetId as Id<Structure | Tombstone | Ruin>));
                    }
                    continue;
                }

                const source = upgrader.pos?.findClosestByRange(FIND_SOURCES_ACTIVE, {
                    filter: (s: Source) => !minedSourceIds.has(s.id)
                });

                if (source) {
                    upgrader.setTask(new HarvestTask(source.id));
                } else if (controller) {
                    // Nothing to collect — rally to controller and stop collecting.
                    // This prevents idle-in-the-middle-of-nowhere: the upgrader
                    // parks at the controller where it can receive deliveries.
                    if (upgrader.pos && upgrader.pos.getRangeTo(controller) > 3) {
                        upgrader.travelTo(controller, 3);
                    }
                    mem.collecting = false; // Break out of collecting — upgrade with whatever we have
                }
            } else {
                if (controller) {
                    upgrader.setTask(new UpgradeTask(controller.id));
                }
            }
        }
    }

    private handleSpawning() {
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
            if (this.upgraders.length > 0) {
                for (const u of this.upgraders) {
                    log.warning(`Polymorphic shift: Re-tasking gated upgrader ${u.name} to worker`);
                    if (u.memory) {
                        u.memory.role = "worker";
                        u.memory._overlord = "worker";
                    }
                    u.setTask(null);
                }
                this.upgraders = [];
            }
            return;
        }

        let shouldSpawn = false;

        // ── U_trigger: Only spawn upgraders if we can afford them WITHOUT
        //    endangering critical creep replacement reserves ──
        //    S_eff > T_crit + UpgraderCost
        //    where T_crit = cost to replace all active miners + haulers
        if (hasStorage) {
            const effectiveEnergy = this.colony.logistics.getEffectiveStore(storage.id);

            // Calculate T_crit: sum of body costs for all active miners and transporters
            const criticalCreeps = this.colony.creeps.filter(
                (c: any) => c.memory.role === "miner" || c.memory.role === "transporter"
            );
            const tCrit = criticalCreeps.reduce((sum: number, c: any) => {
                const body = c.body as Array<{ type: BodyPartConstant }>;
                return sum + (body ? body.reduce((s: number, p: { type: BodyPartConstant }) => s + BODYPART_COST[p.type], 0) : 0);
            }, 0);

            // Upgrader body cost estimate
            const energyCap = room.energyCapacityAvailable ?? 300;
            const upgraderCost = this.colony.linkNetwork?.controllerLink
                ? Math.min(energyCap, 350) // [WORK, WORK, WORK, CARRY, MOVE] = 350
                : Math.min(energyCap, 300); // [WORK, WORK, CARRY, MOVE] = 300

            if (effectiveEnergy > tCrit + upgraderCost) {
                shouldSpawn = true;
            }
        } else if (hasContainers && room.energyAvailable > room.energyCapacityAvailable * 0.9 && this.colony.creeps.length > 2) {
            shouldSpawn = true;
        }

        if (downgradeImminent) shouldSpawn = true;
        if (!shouldSpawn) return;

        // ── Target Scaling ──
        // RCL 2-3 (pre-Storage): scale with energy saturation
        // RCL 4+ (Storage): scale with stored energy
        let target = 1;
        if (isRCL8) {
            target = 1;
        } else if (storage) {
            if (storage.store.energy > 500000) target = 5;
            else if (storage.store.energy > 100000) target = 3;
        } else {
            // Pre-Storage: if economy is saturated (spawn+ext ≥90% full),
            // scale up upgraders to absorb surplus energy
            const saturation = room.energyAvailable / Math.max(room.energyCapacityAvailable, 1);
            const offerCount = this.colony.logistics.offerIds.length;

            if (saturation >= 0.9 && offerCount >= 2) {
                target = 4; // Full surplus → max upgrader throughput
            } else if (saturation >= 0.7 && offerCount >= 1) {
                target = 2; // Moderate surplus
            }
            // else target = 1 (minimal safety upgrader)
        }

        // Priority: 20 (below workers, haulers, miners)
        let priority = downgradeImminent ? 95 : 20;

        if (this.upgraders.length < target) {
            let template: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE];
            let maxEnergy: number | undefined = undefined;

            if (isRCL8) {
                template = [
                    WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK,
                    CARRY,
                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
                ];
                maxEnergy = 2000;
            } else if (this.colony.linkNetwork?.controllerLink) {
                template = [WORK, WORK, WORK, CARRY, MOVE];
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
