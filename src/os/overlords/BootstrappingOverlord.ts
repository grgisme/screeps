// ============================================================================
// BootstrappingOverlord — Anti-Fragile Recovery (Protocol Layers 2, 3, 4)
// ============================================================================
//
// Activates when colony.state.isCriticalBlackout is true.
//
// Protocol Layer 2 — Conditional Morphology Selector:
//   If "buffer energy" exists (tombstones, drops, containers), spawn a cheap
//   [CARRY, MOVE] Hauler at 100 energy. Otherwise wait for [WORK, CARRY, MOVE]
//   Pioneer at 200 energy. Never waste ticks waiting for wrong body.
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
import { Logger } from "../../utils/Logger";

const log = new Logger("BootstrappingOverlord");

/** Priority used for all bootstrapper spawn requests — must outbid everything. */
const BOOTSTRAP_PRIORITY = 999;

/** travelTo priority — ensures bipartite matching shoves idle creeps aside. */
const SHOVE_PRIORITY = 100;

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

        // Already have a bootstrapper alive or actively spawning — don't double-enqueue
        if (this.bootstrappers.length > 0) return;
        if (spawns.some(s => s.spawning && s.spawning.name.startsWith("bootstrap_"))) return;

        log.warning(`${this.colony.name}: CRITICAL BLACKOUT — BootstrappingOverlord activating.`);

        // ── Protocol Layer 2: Conditional Morphology Selector ────────────────
        const bufferEnergy = this._findBufferEnergy(room);

        if (bufferEnergy && room.energyAvailable >= 100) {
            // Pre-processed energy available: 100-energy Hauler is faster
            log.warning(`${this.colony.name}: Buffer energy found. Enqueuing [CARRY, MOVE] Hauler.`);
            this.colony.hatchery.enqueue({
                priority: BOOTSTRAP_PRIORITY,
                bodyTemplate: [CARRY, MOVE],
                overlord: this,
                name: `bootstrap_hauler_${this.colony.name}_${Game.time}`,
                memory: { role: "bootstrapper" }
            });
        } else if (room.energyAvailable >= 200 || room.energyAvailable >= 100 && bufferEnergy) {
            // No pre-processed energy: wait for Pioneer body
            log.warning(`${this.colony.name}: No buffer energy. Enqueuing [WORK, CARRY, MOVE] Pioneer.`);
            this.colony.hatchery.enqueue({
                priority: BOOTSTRAP_PRIORITY,
                bodyTemplate: [WORK, CARRY, MOVE],
                overlord: this,
                name: `bootstrap_pioneer_${this.colony.name}_${Game.time}`,
                memory: { role: "bootstrapper" }
            });
        } else {
            // Not enough energy yet — enqueue anyway so Hatchery waits for us
            // rather than spawning a lower-priority creep first.
            log.info(`${this.colony.name}: Stockpiling energy for bootstrap pioneer...`);
            this.colony.hatchery.enqueue({
                priority: BOOTSTRAP_PRIORITY,
                bodyTemplate: [WORK, CARRY, MOVE],
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

            if (energy === 0) mem.collecting = true;
            if (freeCapacity === 0) mem.collecting = false;

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

                // 3. Check containers with energy
                const container = bootstrapper.pos?.findClosestByRange(FIND_STRUCTURES, {
                    filter: (s: Structure) =>
                        s.structureType === STRUCTURE_CONTAINER &&
                        (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0
                }) as StructureContainer | undefined;
                if (container) {
                    bootstrapper.setTask(new WithdrawTask(container.id as Id<Structure>));
                    continue;
                }

                // 4. Harvest directly — [WORK, CARRY, MOVE] pioneer bodies only
                if (creep.getActiveBodyparts(WORK) > 0) {
                    const source = bootstrapper.pos?.findClosestByRange(FIND_SOURCES_ACTIVE);
                    if (source) {
                        bootstrapper.setTask(new HarvestTask(source.id));
                        continue;
                    }
                } else {
                    // [CARRY, MOVE] Hauler with no energy — do nothing, will die
                    creep.say("⚠️ no src");
                }
            } else {
                // ── Working Phase (Protocol Layer 3: Deterministic Routing) ───
                // Iterate refillOrder: spawn at [0], then extensions by distance.
                const refillOrder = this.colony.refillOrder;
                let transferTarget: StructureSpawn | StructureExtension | null = null;

                for (const id of refillOrder) {
                    const structure = Game.getObjectById(id) as StructureSpawn | StructureExtension | null;
                    if (structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        transferTarget = structure;
                        break;
                    }
                }

                if (transferTarget) {
                    bootstrapper.setTask(new TransferTask(transferTarget.id as Id<Structure>));
                } else {
                    // Spawn/extensions are full — store in storage or drop at spawn
                    const storage = creep.room.storage;
                    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        bootstrapper.setTask(new TransferTask(storage.id as Id<Structure>));
                    } else {
                        // All full — rest near spawn
                        const spawn = this.colony.hatchery.spawns[0];
                        if (spawn && bootstrapper.pos && !bootstrapper.pos.inRangeTo(spawn, 3)) {
                            bootstrapper.travelTo(spawn, 3, SHOVE_PRIORITY);
                        }
                    }
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns true if "buffer energy" is accessible in the room:
     * tombstones with energy, dropped resources > 50, or containers with energy.
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
