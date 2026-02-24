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

    // ── Helper: enumerate valid upgrade standing tiles ─────────────────────────
    // A valid tile is walkable, within range 1 of the container (withdraw reach)
    // AND within range 3 of the controller (upgrade reach).
    // Sorted by range to controller so the best spots come first.
    private getUpgradeSlots(ctrlContainer: StructureContainer, controller: StructureController, room: Room): RoomPosition[] {
        const terrain = room.getTerrain();
        const slots: RoomPosition[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const x = ctrlContainer.pos.x + dx;
                const y = ctrlContainer.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                const pos = new RoomPosition(x, y, room.name);
                if (pos.getRangeTo(controller) <= 3) slots.push(pos);
            }
        }
        // Best spots first (closest to controller = most upgrade ticks per move)
        slots.sort((a, b) => a.getRangeTo(controller) - b.getRangeTo(controller));
        return slots;
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
        const ctrlContainer = room ? this.findControllerContainer(room) : null;

        // Pre-compute shared container-mode state (outside the loop — same for all upgraders)
        const hasTransporters = this.colony.creeps.some((c: any) => c.memory.role === "transporter");
        const containerHasEnergy = (ctrlContainer?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) > 0;
        const upgradeSlots: RoomPosition[] = (ctrlContainer && controller && room)
            ? this.getUpgradeSlots(ctrlContainer, controller, room)
            : [];

        const activeMiners = this.colony.creeps.filter((c: any) => c.memory.role === "miner");
        const minedSourceIds = new Set(activeMiners.map((m: any) => m.memory.state?.siteId));

        for (let upgraderIdx = 0; upgraderIdx < this.upgraders.length; upgraderIdx++) {
            const upgrader = this.upgraders[upgraderIdx];
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
            if (ctrlContainer && controller && (containerHasEnergy || hasTransporters)) {
                if (upgrader.task) upgrader.setTask(null);

                // Assign a unique standing slot by upgrader index so they spread out.
                const slots = upgradeSlots;
                const mySlot = slots[upgraderIdx % Math.max(slots.length, 1)];

                const onSlot = mySlot && (upgrader.pos?.isEqualTo(mySlot) ?? false);
                const atContainer = upgrader.pos?.inRangeTo(ctrlContainer, 1) ?? false;
                const atController = upgrader.pos?.inRangeTo(controller, 3) ?? false;

                if (!onSlot || !atContainer || !atController) {
                    // Walk to assigned slot (satisfies range-1 container + range-3 controller)
                    if (mySlot) {
                        upgrader.travelTo(mySlot, 0);
                    } else {
                        upgrader.travelTo(ctrlContainer, 1);
                    }
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

        // ── Polymorphic Shift Gate ──────────────────────────────────────────
        //
        // Shift upgraders to workers ONLY when there is no structural energy
        // pathway to the controller AND downgrade is not imminent.
        //
        // WRONG gate (previous): `!hasContainers` (= `offerIds.length === 0`)
        //   offerIds is a transient, per-tick count. It's 0 whenever the
        //   logistics network has nothing to offer at that exact tick, which
        //   happens constantly at RCL2 (container just placed, drops depleted,
        //   transporter mid-trip). This caused upgraders to be permanently
        //   re-shifted to workers milliseconds after spawning.
        //
        // CORRECT gate: check for STRUCTURAL presence of energy infrastructure
        //   (storage or a controller container), which is persistent across
        //   ticks. A container exists even when empty and waiting to be filled.
        const hasEnergyInfrastructure = hasStorage
            || (room ? this.findControllerContainer(room) !== null : false)
            || hasContainers;  // any logistics offer (drops, containers, ruins)

        if (!downgradeImminent && !hasEnergyInfrastructure && !isRCL8) {
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

            // Hard floor: never spawn upgraders unless there is a meaningful reserve.
            // This prevents the tCrit formula from allowing an upgrader spawn with only
            // 1,500 energy in storage (e.g. 2 miners at 600e each + 300e upgrader cost).
            // Exception: downgradeImminent overrides this floor (handled after the block).
            const UPGRADER_STORAGE_FLOOR = 100_000;
            if (storage.store.energy < UPGRADER_STORAGE_FLOOR) {
                // Floor not met — only bypass if downgrade is already imminent
                // (handled by `if (downgradeImminent) shouldSpawn = true` below)
            } else if (effectiveEnergy > tCrit + upgraderCost) {
                shouldSpawn = true;
            }
        } else if (hasContainers && room.energyAvailable > room.energyCapacityAvailable * 0.9 && this.colony.creeps.length > 2) {
            shouldSpawn = true;
        }

        if (downgradeImminent) shouldSpawn = true;
        if (!shouldSpawn) return;

        // ── Body Formula ──────────────────────────────────────────────────────
        //
        // MODE A — Stationary Heavy: container or link exists so the upgrader
        //   parks in one spot and never hauls.
        //   Body: [WORK*N, CARRY*1, MOVE*1]
        //   Only 1 CARRY (pull from adjacent source once) and 1 MOVE (walk to
        //   slot once). All remaining spawn budget goes into WORK density.
        //   Pre-built and pinned (maxEnergy = bodyCost) so CreepBody.grow
        //   returns it exactly once rather than repeating the pattern.
        //   Capped at 15 WORK (game engine cap independent of RCL).
        //
        // MODE B — Mobile Workhorse: no container/link yet, upgrader self-hauls.
        //   Body: [WORK, WORK, CARRY, MOVE] × N  (2:1:1 ratio)
        //   Moves at half-speed when CARRY is loaded — acceptable because the
        //   TrafficManager shove algorithm handles displacement by faster creeps.
        //   CreepBody.grow scales this automatically with energyCapacityAvailable.
        //
        const energyCap = room.energyCapacityAvailable ?? 300;
        const hasContainer = !!(room ? this.findControllerContainer(room) : null);
        const hasLink = !!this.colony.linkNetwork?.controllerLink;
        const hasTransportersNow = this.colony.creeps.some((c: any) => c.memory.role === "transporter");

        let template: BodyPartConstant[];
        let maxEnergy: number | undefined;

        if (isRCL8) {
            // RCL8 hard cap: 15 WORK + 1 CARRY + 8 MOVE = 2300e, pinned to 2000e
            template = [
                ...Array(15).fill(WORK), CARRY,
                MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
            ];
            maxEnergy = 2000;
        } else if (hasLink || (hasContainer && hasTransportersNow)) {
            // MODE A — Stationary Heavy
            // WORK parts = floor((cap - 100) / 100), capped at 15
            const workCount = Math.min(15, Math.max(1, Math.floor((energyCap - 100) / 100)));
            template = [...Array(workCount).fill(WORK), CARRY, MOVE];
            maxEnergy = workCount * 100 + 100; // pin: don't let grow() repeat it
        } else {
            // MODE B — Mobile Workhorse [WORK, WORK, CARRY, MOVE] × N
            template = [WORK, WORK, CARRY, MOVE];
            maxEnergy = undefined; // let CreepBody.grow scale to energyCapacityAvailable
        }

        // ── WORK-parts targeting ──────────────────────────────────────────────
        // Keep spawning until we hit the target WORK-part count.
        // Pre-storage cap (5) prevents burning economy before infrastructure exists.
        const TARGET_WORK = isRCL8 ? 15 : (storage ? 15 : 5);

        const currentWork = this.upgraders.reduce((sum: number, u: any) =>
            sum + (u.creep?.getActiveBodyparts(WORK) ?? 0), 0);

        const priority = downgradeImminent ? 95 : 20;

        if (currentWork < TARGET_WORK) {
            this.colony.hatchery.enqueue({
                priority,
                bodyTemplate: template,
                overlord: this,
                memory: { role: "upgrader" },
                maxEnergy
            });
        }

    }
}
