// ============================================================================
// BootstrappingOverlord — Anti-Fragile Recovery (Protocol Layers 2, 3, 4)
// ============================================================================
//
// Activates when colony.state.isCriticalBlackout is true.
//
// Protocol Layer 2 — Conditional Morphology Selector:
//   If "buffer energy" exists (tombstones, drops, containers), spawn a cheap
//   [CARRY, MOVE] Hauler at 100 energy. Otherwise spawn a scaled Omni-Pioneer
//   [WORK, CARRY, MOVE]×N up to available energy.
//
//   NOTE: Split morphology (Drop-Miner + Relay Hauler for >25-tile sources) was
//   removed in Issue #75. Partial-spawn deadlock meant the Relay Hauler was never
//   enqueued once a bootstrapper was alive, leaving the Miner mining to the ground
//   forever. Omni-Pioneers self-harvest and don't have this coupling failure.
//
// Protocol Layer 3 — Deterministic Routing:
//   Bootstrappers iterate colony.refillOrder (spawn always at [0]) to find
//   the first structure with free capacity. No findClosestByRange during crisis.
//
// Protocol Layer 4 — Active Shoving:
//   All travelTo() calls use priority 100. TrafficManager's bipartite matching
//   ensures bootstrappers shove idle creeps out of critical paths.
//
// ⚠️ GETTER PATTERN: Overlord lives in the heap. Never store live Game objects.
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { HarvestTask } from "../tasks/HarvestTask";
import { PickupTask } from "../tasks/PickupTask";
import { TransferTask } from "../tasks/TransferTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { BuildTask } from "../tasks/BuildTask";
import { UpgradeTask } from "../tasks/UpgradeTask";
import { Logger } from "../../utils/Logger";
import { MovePriority } from "../infrastructure/MovePriority";

const log = new Logger("BootstrappingOverlord");

/** Spawn-queue priority — must outbid all other overlords during a blackout. */
const BOOTSTRAP_PRIORITY = 999;

/**
 * Generates a scaled [WORK, CARRY, MOVE] body from available energy.
 * Minimum 1 triad (200e), maximum 16 triads (3200e).
 * Returns empty array when energy < 200 (caller should still enqueue at maxEnergy:200).
 */
function generateBootstrapBody(energy: number): BodyPartConstant[] {
    const triads = Math.min(Math.floor(energy / 200), 16);
    const body: BodyPartConstant[] = [];
    for (let i = 0; i < triads; i++) body.push(WORK, CARRY, MOVE);
    return body;
}


export class BootstrappingOverlord extends Overlord {
    bootstrappers: Zerg[] = [];

    constructor(colony: Colony) {
        super(colony, "bootstrapping");
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    init(): void {
        this.bootstrappers = this.zergs.filter(z => z.isAlive());

        if (!this.colony.state.isCriticalBlackout) return;

        const room = this.colony.room;
        if (!room) return;

        const spawns = this.colony.hatchery.spawns;
        if (spawns.length === 0) return;

        // Already have a bootstrapper alive, actively spawning, or committed in the
        // GlobalCache pending-spawn set — don't double-enqueue.
        //
        // Three layers of guard (ordered cheapest-to-check first):
        //   1. s.spawning            — spawn slot is physically busy with a bootstrap creep
        //   2. hasPendingBootstrapper() — spawnCreep returned OK but physical slot not yet
        //                              visible (closes the one-tick race window, Issue #73)
        //
        // EXCEPTION: if every alive bootstrapper is a pure hauler (no WORK parts) AND
        // there's nothing in the room to collect, they're deadlocked — allow a pioneer.
        const spawningBootstrap = spawns.some(s => s.spawning && s.spawning.name.startsWith("bootstrap_"));
        const pendingBootstrap = this.colony.hatchery.hasPendingBootstrapper();
        if (spawningBootstrap || pendingBootstrap) return;

        if (this.bootstrappers.length > 0) {
            const bufferNow = this._findBufferEnergy(room);
            const allCarryOnly = this.bootstrappers.every(z => {
                const c = z.creep;
                return c !== undefined && c.getActiveBodyparts(WORK) === 0;
            });
            // If at least one bootstrapper can harvest, or there's energy to collect, don't interfere
            if (!allCarryOnly || bufferNow) return;
            // All alive bootstrappers are CARRY-only AND nothing to collect → allow pioneer spawn-through
            log.warning(`${this.colony.name}: All bootstrappers are CARRY-only with no collectable energy — spawning pioneer to unblock.`);
        } else {
            log.warning(`${this.colony.name}: CRITICAL BLACKOUT — BootstrappingOverlord activating.`);
        }

        // ── Protocol Layer 2: Conditional Morphology Selector ────────────────
        const bufferEnergy = this._findBufferEnergy(room);

        if (bufferEnergy && room.energyAvailable >= 100) {
            // Pre-processed energy available: 100-energy Hauler is faster to spawn
            log.warning(`${this.colony.name}: Buffer energy found. Enqueuing [CARRY, MOVE] Hauler.`);
            this.colony.hatchery.enqueue({
                priority: BOOTSTRAP_PRIORITY,
                bodyTemplate: [CARRY, MOVE],
                maxEnergy: 100,
                overlord: this,
                name: `bootstrap_hauler_${this.colony.name}_${Game.time}`,
                memory: { role: "bootstrapper" }
            });
        } else {
            // No pre-processed energy: Omni-Pioneer scaled to current energy.
            // Even when energy < 200 we still enqueue at maxEnergy:200 so Hatchery
            // holds the slot while energy accumulates rather than spawning a lower-
            // priority creep first.
            const body = generateBootstrapBody(room.energyAvailable);
            const effectiveMax = Math.max(200, room.energyAvailable);
            if (body.length > 0) {
                log.warning(`${this.colony.name}: Enqueuing ${body.length / 3}-triad Pioneer (${effectiveMax}e).`);
            } else {
                log.info(`${this.colony.name}: Stockpiling energy for bootstrap pioneer...`);
            }
            this.colony.hatchery.enqueue({
                priority: BOOTSTRAP_PRIORITY,
                bodyTemplate: [WORK, CARRY, MOVE],
                maxEnergy: effectiveMax,
                overlord: this,
                name: `bootstrap_pioneer_${this.colony.name}_${Game.time}`,
                memory: { role: "bootstrapper" }
            });
        }
    }

    // ── Run ──────────────────────────────────────────────────────────────────

    run(): void {
        for (const bootstrapper of this.bootstrappers) {
            if (!bootstrapper.isAlive()) continue;
            const creep = bootstrapper.creep;
            if (!creep || creep.spawning) continue;

            const mem = bootstrapper.memory as any;

            // ── State Machine: pure energy relay ─────────────────────────────
            const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
            const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;
            const storeCapacity = creep.store.getCapacity() ?? 0;

            if (energy === 0) mem.collecting = true;
            // Guard: only flip to Working when the creep actually has CARRY parts and
            // is full. For 0-CARRY bodies (e.g. [WORK,MOVE]) freeCapacity is always 0
            // even though the creep has no store — without this guard they instantly
            // enter Working phase and softlock transferring 0 energy. (Issue #76)
            if (storeCapacity > 0 && freeCapacity === 0) mem.collecting = false;

            if (bootstrapper.task) {
                // Let the task system execute — this zerg is already mid-task
                continue;
            }

            if (mem.collecting) {
                // ── Collecting Phase (Protocol Layer 2) ───────────────────────
                // Priority: dropped energy / tombstones > containers > harvest

                // 1. Check for dropped energy (fastest pickup)
                const dropped = bootstrapper.pos?.findClosestByRange(FIND_DROPPED_RESOURCES, {
                    filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 20
                });
                if (dropped) {
                    bootstrapper.setTask(new PickupTask(dropped.id as Id<Resource>));
                    continue;
                }

                // 2. Check tombstones with energy
                const tombstone = bootstrapper.pos?.findClosestByRange(FIND_TOMBSTONES, {
                    filter: (t: Tombstone) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                });
                if (tombstone) {
                    bootstrapper.setTask(new WithdrawTask(tombstone.id as Id<Tombstone>));
                    continue;
                }

                // 3. Check ruins with energy (enemy spawn ruins, abandoned structures, etc.)
                const ruin = bootstrapper.pos?.findClosestByRange(FIND_RUINS, {
                    filter: (r: Ruin) => r.store.getUsedCapacity(RESOURCE_ENERGY) > 0
                });
                if (ruin) {
                    bootstrapper.setTask(new WithdrawTask(ruin.id as Id<Ruin>));
                    continue;
                }

                // 4. Check containers with energy
                const container = bootstrapper.pos?.findClosestByRange(FIND_STRUCTURES, {
                    filter: (s: Structure) =>
                        s.structureType === STRUCTURE_CONTAINER &&
                        (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0
                }) as StructureContainer | undefined;
                if (container) {
                    bootstrapper.setTask(new WithdrawTask(container.id as Id<Structure>));
                    continue;
                }

                // 5. Harvest directly via task system — inject EMERGENCY priority so
                // HarvestTask.run() uses EMERGENCY for travelTo every tick.
                // This is the clean fix for Issue #77 (Task Priority Erasure):
                // rather than bypassing the task abstraction, we inject the priority
                // into task.settings so the task propagates it to TrafficManager.
                if (creep.getActiveBodyparts(WORK) > 0) {
                    const source = bootstrapper.pos?.findClosestByRange(FIND_SOURCES_ACTIVE);
                    if (source) {
                        const harvestTask = new HarvestTask(source.id);
                        harvestTask.settings.movePriority = MovePriority.EMERGENCY;
                        bootstrapper.setTask(harvestTask);
                        // Prime the path cache on the first tick — guarantees TrafficManager
                        // receives the EMERGENCY intent even before the task's first run().
                        if (!bootstrapper.pos?.inRangeTo(source, 1)) {
                            bootstrapper.travelTo(source, 1, MovePriority.EMERGENCY);
                        }
                        continue;
                    }
                } else {
                    // [CARRY, MOVE] Hauler — look for dropped energy near sources
                    const droppedNear = bootstrapper.pos?.findClosestByRange(FIND_DROPPED_RESOURCES, {
                        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 10
                    });
                    if (droppedNear) {
                        bootstrapper.setTask(new PickupTask(droppedNear.id as Id<Resource>));
                        continue;
                    }
                    // Nothing to pick up. If we're carrying something, deposit it now.
                    if (energy > 0) {
                        mem.collecting = false;
                        continue;
                    }
                    // Empty-handed with nothing to pick up — wait near the closest source
                    // so we're already positioned when miners start dropping energy.
                    const waitSrc = bootstrapper.pos?.findClosestByRange(FIND_SOURCES);
                    if (waitSrc && bootstrapper.pos && !bootstrapper.pos.inRangeTo(waitSrc, 2)) {
                        bootstrapper.travelTo(waitSrc, 2, MovePriority.EMERGENCY);
                    }
                }
            } else {
                // ── Working Phase (Protocol Layer 3: Deterministic Routing) ───
                // Iterate refillOrder: spawn at [0], then extensions by distance.
                // Step 9 — Threat-Aware Tower-First: if room is dangerous, prepend
                // any unfilled towers so bootstrapper charges defenses before extensions.
                const isDangerous = !!(Memory.rooms?.[creep.room.name] as any)?.isDangerous;
                const refillOrder = this.colony.refillOrder;

                let orderedFill: string[];
                if (isDangerous) {
                    // Inject towers immediately after the spawn (index 0).
                    const towers = creep.room.find(FIND_MY_STRUCTURES, {
                        filter: (s: Structure) => s.structureType === STRUCTURE_TOWER &&
                            (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 400
                    }).map((t: Structure) => t.id as string);
                    // Keep spawn first, insert towers next, then standard extensions
                    orderedFill = refillOrder.length > 0
                        ? [refillOrder[0], ...towers, ...refillOrder.slice(1)]
                        : towers;
                } else {
                    orderedFill = refillOrder;
                }

                let transferTarget: StructureSpawn | StructureExtension | StructureTower | null = null;

                for (const id of orderedFill) {
                    const structure = Game.getObjectById(id as Id<Structure>) as StructureSpawn | StructureExtension | StructureTower | null;
                    if (structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        transferTarget = structure;
                        break;
                    }
                }

                if (transferTarget) {
                    bootstrapper.setTask(new TransferTask(transferTarget.id as Id<Structure>));
                } else {
                    // Spawn/extensions are full — waterfall cascade: store → build → upgrade
                    // (Issue #78: old code parked the creep here, stalling at RCL 1 forever)
                    const storage = creep.room.storage;
                    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        // 1. Dump into storage if available
                        bootstrapper.setTask(new TransferTask(storage.id as Id<Structure>));
                    } else if (creep.getActiveBodyparts(WORK) > 0) {
                        // 2. Build/upgrade — WORK parts required.
                        // [CARRY, MOVE] Hauler bootstrappers have NO WORK parts and MUST NOT
                        // reach this branch — BuildTask would loop forever with ERR_NO_BODYPART.
                        const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
                        if (site) {
                            bootstrapper.setTask(new BuildTask(site.id));
                        } else {
                            // 3. Upgrade controller as final fallback — pushes RCL forward
                            const controller = creep.room.controller;
                            if (controller && controller.my) {
                                bootstrapper.setTask(new UpgradeTask(controller.id));
                            }
                        }
                    } else {
                        // No-WORK hauler with nowhere to deliver — reset to collecting so it
                        // picks up from the drops and tries again next delivery cycle.
                        mem.collecting = true;
                    }
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns true if "buffer energy" is accessible in the room:
     * tombstones, ruins, dropped resources > 50, or containers with energy.
     * Used by the Conditional Morphology Selector to pick the cheapest usable body.
     */
    private _findBufferEnergy(room: Room): boolean {
        // Dropped energy > 50
        const dropped = room.find(FIND_DROPPED_RESOURCES, {
            filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
        });
        if (dropped.length > 0) return true;

        // Tombstones with energy
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: (t: Tombstone) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        });
        if (tombstones.length > 0) return true;

        // Ruins with energy
        const ruins = room.find(FIND_RUINS, {
            filter: (r: Ruin) => r.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        });
        if (ruins.length > 0) return true;

        // Containers with energy
        const containers = room.find(FIND_STRUCTURES, {
            filter: (s: Structure) =>
                s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0
        });
        if (containers.length > 0) return true;

        return false;
    }
}
