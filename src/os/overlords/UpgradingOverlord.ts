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

    // ── Helper: find the controller container (may be empty) ──────────────────
    private findControllerContainer(room: Room): StructureContainer | null {
        const controller = room.controller;
        if (!controller) return null;
        const containers = controller.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        }) as StructureContainer[];
        return containers[0] ?? null;
    }

    init() {
        this.upgraders = this.zergs.filter(z => z.isAlive() && z.memory?.role === "upgrader");

        const room = this.colony.room;
        const ctrlContainer = room ? this.findControllerContainer(room) : null;

        for (const upgrader of this.upgraders) {
            const creep = upgrader.creep;
            if (!creep) continue;

            // Only register as a logistics requester when there is NO controller container.
            // Once a container exists the upgrader self-serves from it exclusively —
            // no transporter trips needed.
            if (!ctrlContainer) {
                const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free > 0) {
                    this.colony.logistics.requestInput(creep.id as any, { amount: free, priority: 4 });
                }
            }
        }

        this.handleSpawning();
    }

    run() {
        const controllerLink = this.colony.linkNetwork?.controllerLink;
        const room = this.colony.room;
        const controller = room?.controller;

        // Find the controller container once per tick — even if empty.
        // This is the trigger for switching to stationary container mode.
        const ctrlContainer = room ? this.findControllerContainer(room) : null;

        const activeMiners = this.colony.creeps.filter((c: any) => c.memory.role === "miner");
        const minedSourceIds = new Set(activeMiners.map((m: any) => m.memory.state?.siteId));

        for (const upgrader of this.upgraders) {
            if (!upgrader.isAlive()) continue;

            // ── Priority 1: Link mode (RCL 5+) ──────────────────────────────────
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

            // ── Priority 2: Controller container mode ───────────────────────────
            // Engage if container has energy OR transporters exist to fill it.
            // Fall through to self-collect if container is empty AND no one can fill it
            // (colony collapse: dead transporters, empty container).
            const hasTransporters = this.colony.creeps.some((c: any) => c.memory.role === "transporter");
            const containerHasEnergy = (ctrlContainer?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) > 0;

            if (ctrlContainer && controller && (containerHasEnergy || hasTransporters)) {
                if (upgrader.task) upgrader.setTask(null);

                // Must be in range 1 of container AND in range 3 of controller
                const atContainer = upgrader.pos?.inRangeTo(ctrlContainer, 1) ?? false;
                const atController = upgrader.pos?.inRangeTo(controller, 3) ?? false;

                if (!atContainer || !atController) {
                    // Walk to a spot that satisfies both constraints.
                    // Targeting the container with range 1 guarantees controller range 3
                    // for any well-placed container (within 2 of controller).
                    upgrader.travelTo(ctrlContainer, 1);
                    continue;
                }

                // In position — drain container then upgrade.
                const energy = upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
                const workParts = upgrader.creep?.getActiveBodyparts(WORK) ?? 0;
                const containerEnergy = ctrlContainer.store.getUsedCapacity(RESOURCE_ENERGY);

                if (energy <= workParts && containerEnergy > 0) {
                    // Keep topping up: withdraw when store is nearly empty
                    upgrader.withdraw(ctrlContainer);
                }
                if (energy > 0) {
                    upgrader.upgradeController(controller);
                }
                continue;
            }

            // ── Priority 3: No container — self-collect via LogisticsNetwork ────
            if (upgrader.task) continue;

            const mem = upgrader.memory as any;

            if ((upgrader.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                mem.collecting = true;
            }
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
                    if (upgrader.pos && upgrader.pos.getRangeTo(controller) > 3) {
                        upgrader.travelTo(controller, 3);
                    }
                    mem.collecting = false;
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
                target = 3; // Full surplus → max upgrader throughput
            } else if (saturation >= 0.7 && offerCount >= 1) {
                target = 2; // Moderate surplus
            }
            // else target = 1 (minimal safety upgrader)
        }

        // Priority: 20 (below workers, haulers, miners)
        let priority = downgradeImminent ? 95 : 20;

        if (this.upgraders.length < target) {
            // Controller container-aware body: WORK-heavy since upgraders pull
            // from adjacent container — no long-distance hauling needed.
            // Base: [W,W,C,M] = 300e → fits a single spawn at RCL 1
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
