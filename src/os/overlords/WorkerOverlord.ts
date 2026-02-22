// ============================================================================
// WorkerOverlord — IoC task assignment for worker creeps
// ============================================================================
//
// ⚠️ IoC PATTERN: Overlords assign tasks. They do NOT call zerg.run().
// Colony.run() iterates all zergs and calls zerg.run() once per tick.
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Worker } from "../zerg/Worker";
import { MiningOverlord } from "./MiningOverlord";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { PickupTask } from "../tasks/PickupTask";
import { HarvestTask } from "../tasks/HarvestTask";
import { UpgradeTask } from "../tasks/UpgradeTask";
import { BuildTask } from "../tasks/BuildTask";
import { RepairTask } from "../tasks/RepairTask";
import { TransferTask } from "../tasks/TransferTask";
import { DismantleTask } from "../tasks/DismantleTask";
import { getParkingZones, pickParkingZone, getRampartTarget } from "../../utils/ParkingZones";



export class WorkerOverlord extends Overlord {
    workers: Worker[];

    // Memoization cache for getBestConstructionSite CPU bomb fix
    private _bestSite?: ConstructionSite | null;
    private _bestSiteTick?: number;

    constructor(colony: Colony) {
        super(colony, "worker");
        this.workers = [];
    }

    init(): void {
        // adoptOrphans() removed — base Overlord getter handles adoption via _overlord tag
        this.workers = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "worker") as Worker[];

        // Register workers as energy sinks so TransporterOverlord dispatches
        // haulers to them directly. Priority 5 = served after spawns/extensions (10)
        // but before upgraders (4). TransferTask.isValid() handles Creep targets
        // natively via the `store` property check — no task-layer changes needed.
        for (const worker of this.workers) {
            const creep = worker.creep;
            if (creep) {
                const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free > 0) {
                    this.colony.logistics.requestInput(creep.id as any, { amount: free, priority: 5 });
                }
            }
        }

        this.handleSpawning();
    }

    run(): void {
        const room = this.colony.room;

        // Hoist queries OUTSIDE the loop to save CPU
        let hasTransporters = false;
        let spawnOrExtNeedEnergy: (StructureSpawn | StructureExtension)[] = [];

        if (room && room.energyAvailable < room.energyCapacityAvailable) {
            hasTransporters = this.colony.creeps.some(c => {
                const role = (c.memory as any).role;
                return role === "transporter" || role === "filler";
            });
            if (!hasTransporters) {
                spawnOrExtNeedEnergy = room.find(FIND_MY_STRUCTURES, {
                    filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION)
                        && (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                }) as (StructureSpawn | StructureExtension)[];
            }
        }
        // Map out sources claimed by dedicated miners
        const activeMiners = this.colony.creeps.filter(c => (c.memory as any).role === "miner");
        const minedSourceIds = new Set(activeMiners.map(m => (m.memory as any).state?.siteId));

        for (const worker of this.workers) {
            if (!worker.isAlive()) continue;

            // Stale task breaker: if worker has 0 energy but a work-phase task,
            // the task can never complete — clear it and switch to collecting.
            // Effective Store Check: if a transporter is already en route (incomingReservations > 0),
            // do NOT flip to collecting — let the worker hold position as a static sink.
            if (worker.task && (worker.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                const taskName = worker.task.name;
                if (taskName === 'Transfer' || taskName === 'Build' || taskName === 'Upgrade' || taskName === 'Repair') {
                    const creepId = worker.creep?.id;
                    const inFlight = creepId ? (this.colony.logistics.incomingReservations.get(creepId) || 0) : 0;
                    if (inFlight > 0 && hasTransporters) {
                        // Delivery is en route — keep the work task, hold position, do not collect
                        worker.setTask(null); // Clear stale task so we fall through to static-sink logic
                        (worker.memory as any).collecting = false;
                    } else {
                        worker.setTask(null);
                        (worker.memory as any).collecting = true;
                    }
                }
            }

            if (worker.task) continue;

            const mem = worker.memory as any;

            // STATE MACHINE: Commit to collecting until full, then work until empty.
            // Effective Store Check: before flipping to collecting, verify no hauler is already
            // en route. If incomingReservations > 0, hold position as a static sink.
            if ((worker.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                const creepId = worker.creep?.id;
                const inFlight = creepId ? (this.colony.logistics.incomingReservations.get(creepId) || 0) : 0;
                if (inFlight > 0 && hasTransporters) {
                    // A hauler is already en route — do not switch to collecting
                    mem.collecting = false;
                } else {
                    mem.collecting = true;
                }
            }
            if ((worker.store?.getFreeCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                mem.collecting = false;
            }

            if (mem.collecting) {
                // Collecting energy — fill up completely before working

                // 1. LogisticsNetwork matching (polymorphic)
                const targetId = this.colony.logistics.matchWithdraw(worker);
                if (targetId) {
                    const target = Game.getObjectById(targetId);
                    if (target && 'amount' in target) {
                        worker.setTask(new PickupTask(targetId as Id<Resource>));
                    } else {
                        worker.setTask(new WithdrawTask(targetId as Id<Structure | Tombstone | Ruin>));
                    }
                    continue;
                }

                // 2. Peasant Mode fallback — harvest directly from source

                // Miner Deference: Ignore sources that already have a dedicated miner
                const source = worker.pos?.findClosestByRange(FIND_SOURCES_ACTIVE, {
                    filter: (s: Source) => !minedSourceIds.has(s.id)
                });

                if (source) {
                    worker.setTask(new HarvestTask(source.id));
                } else {
                    // All sources have miners — try withdrawing from containers first
                    const container = worker.pos?.findClosestByRange(FIND_STRUCTURES, {
                        filter: (s: Structure) =>
                            s.structureType === STRUCTURE_CONTAINER &&
                            (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 50
                    }) as StructureContainer | undefined;

                    if (container) {
                        worker.setTask(new WithdrawTask(container.id as Id<Structure>));
                    } else {
                        // Fix 4: Static Sink — anchor to the nearest container and wait
                        // instead of wandering. Haulers delivering energy can path to a
                        // stationary target (deep path cache, near-zero CPU per tick).
                        // Only wander if no container exists at all.
                        const anyContainer = worker.pos?.findClosestByRange(FIND_STRUCTURES, {
                            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
                        }) as StructureContainer | undefined;

                        if (anyContainer) {
                            // Anchor to container position — do NOT issue travelTo; just hold still
                            if (worker.pos && !worker.pos.inRangeTo(anyContainer, 1)) {
                                worker.travelTo(anyContainer, 1);
                            }
                            // else: already adjacent — stay put, remain a static sink
                        } else {
                            // Last resort: share a mined source rather than idle
                            const anySource = worker.pos?.findClosestByRange(FIND_SOURCES_ACTIVE);
                            if (anySource) {
                                worker.setTask(new HarvestTask(anySource.id));
                            }
                        }
                    }
                }
            } else {
                // Has energy — work priority cascade

                // Peasant Logistics (Using the hoisted cached array)
                if (!hasTransporters && spawnOrExtNeedEnergy.length > 0) {
                    const target = worker.pos?.findClosestByRange(spawnOrExtNeedEnergy);
                    if (target) {
                        worker.setTask(new TransferTask(target.id as Id<Structure>));
                        continue;
                    }
                }

                // 1. Emergency repairs (with targetHits barrier threshold)
                const damaged = worker.pos?.findClosestByRange(FIND_STRUCTURES, {
                    filter: (s: Structure) => {
                        if (s.structureType === STRUCTURE_WALL) return false; // Walls handled by Masons/Defense
                        if (s.structureType === STRUCTURE_RAMPART) return s.hits < 10000; // Save newborn ramparts from decay
                        return s.hits < s.hitsMax * 0.5;
                    }
                });
                if (damaged) {
                    // Apply the barrier threshold to prevent 300M HP rampart deadlock
                    const task = new RepairTask(damaged.id);
                    task.settings.targetHits = damaged.structureType === STRUCTURE_RAMPART ? 15000 : damaged.hitsMax;
                    worker.setTask(task);
                    continue;
                }

                // 2. Dismantle obsolete structures (blueprint validation)
                const obsoleteIds = ((this.colony.memory as any).obsoleteStructures || []) as string[];
                if (obsoleteIds.length > 0) {
                    const targetId = obsoleteIds[0];
                    const target = Game.getObjectById(targetId as Id<Structure>);
                    if (target) {
                        // SAFETY: Never dismantle the last spawn
                        if (target.structureType === STRUCTURE_SPAWN) {
                            const spawnCount = this.colony.room?.find(FIND_MY_SPAWNS)?.length ?? 0;
                            if (spawnCount <= 1) {
                                obsoleteIds.shift(); // Remove from list, never dismantle
                                (this.colony.memory as any).obsoleteStructures = obsoleteIds;
                                continue; // Skip to next task
                            }
                        }
                        worker.setTask(new DismantleTask(target.id));
                        continue;
                    } else {
                        // Target already gone — remove from list
                        obsoleteIds.shift();
                        (this.colony.memory as any).obsoleteStructures = obsoleteIds;
                    }
                }

                // 3. Build construction sites
                const site = this.getBestConstructionSite();
                if (site) {
                    worker.setTask(new BuildTask(site.id));
                    continue;
                }

                // 3. Upgrade controller (only if no dedicated upgraders)
                const hasUpgraders = this.colony.creeps.some(c => (c.memory as any)?.role === "upgrader");
                const controller = this.colony.room?.controller;
                if (!hasUpgraders && controller) {
                    worker.setTask(new UpgradeTask(controller.id));
                } else {
                    // Fix 1 + 3 + 4: Rampart override takes priority during DEFCON;
                    // otherwise DT-based parking — idle workers park in spacious
                    // dead-end tiles outside the BunkerLayout footprint, picked
                    // randomly from the 3 nearest to prevent clumping.
                    const room = this.colony.room;
                    const anchor = (this.colony.memory as any).anchor as { x: number; y: number } | undefined;
                    if (room && worker.pos) {
                        // Fix 3: Seek nearest free rampart during DEFCON
                        const rampartTarget = getRampartTarget(room, worker.pos);
                        if (rampartTarget) {
                            worker.travelTo(rampartTarget, 0);
                        } else if (anchor) {
                            const zones = getParkingZones(room, anchor.x, anchor.y);
                            const target = pickParkingZone(worker.pos, zones);
                            if (target) worker.travelTo(target, 0);
                        } else {
                            // Bootstrap fallback — no anchor yet
                            const spawn = room.find(FIND_MY_SPAWNS)?.[0];
                            const storage = room.storage;
                            if (storage && worker.pos.getRangeTo(storage) > 3) {
                                worker.travelTo(storage, 3);
                            } else if (spawn) {
                                const range = worker.pos.getRangeTo(spawn);
                                if (range <= 4) {
                                    const dx = worker.pos.x - spawn.pos.x;
                                    const dy = worker.pos.y - spawn.pos.y;
                                    const mx = dx === 0 ? 1 : Math.sign(dx);
                                    const my = dy === 0 ? 1 : Math.sign(dy);
                                    const tx = Math.min(48, Math.max(1, worker.pos.x + mx * 5));
                                    const ty = Math.min(48, Math.max(1, worker.pos.y + my * 5));
                                    worker.travelTo(new RoomPosition(tx, ty, spawn.pos.roomName), 1);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room) return;

        const miningOverlord = this.colony.overlords
            .find((o: Overlord) => o instanceof MiningOverlord) as MiningOverlord | undefined;
        const miningSuspended = miningOverlord ? miningOverlord.isSuspended : true;

        let maxWorkers = miningSuspended ? this.countMiningSpots(room) + 2 : 4;

        const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        const progressTotal = sites.reduce((sum: number, site: ConstructionSite) => sum + (site.progressTotal - site.progress), 0);

        if (progressTotal > 0) maxWorkers += Math.floor(progressTotal / 10000); // Prevent explosive spawning
        if (maxWorkers > 10) maxWorkers = 10;

        let target = miningSuspended ? Math.max(2, this.countMiningSpots(room)) : 1;
        if (progressTotal > 0) target = maxWorkers;

        // Removed suicide loop entirely. Creeps naturally TTL out.
        if (this.workers.length >= target) return;

        this.colony.hatchery.enqueue({
            priority: miningSuspended ? 80 : 30, // Absolute Priority Ladder
            bodyTemplate: [WORK, CARRY, CARRY, MOVE, MOVE], // Optimal 2:1 ratio
            overlord: this,
            memory: { role: "worker" },
            maxEnergy: 2000 // Cap generic workers
        });
    }

    /**
     * Count total walkable (non-wall) tiles adjacent to all sources in the room.
     */
    private countMiningSpots(room: Room): number {
        const terrain = Game.map.getRoomTerrain(room.name);
        const sources = room.find(FIND_SOURCES);
        let spots = 0;

        for (const source of sources) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const x = source.pos.x + dx;
                    const y = source.pos.y + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    if ((terrain.get(x, y) & TERRAIN_MASK_WALL) === 0) {
                        spots++;
                    }
                }
            }
        }

        return spots;
    }

    getBestConstructionSite(): ConstructionSite | null {
        // Return cached site if already sorted this tick
        if (this._bestSiteTick === Game.time) return this._bestSite ?? null;
        this._bestSiteTick = Game.time;

        const priority: { [key in StructureConstant]?: number } = {
            [STRUCTURE_SPAWN]: 0,
            [STRUCTURE_TOWER]: 1,
            [STRUCTURE_CONTAINER]: 2,
            [STRUCTURE_EXTENSION]: 3,
            [STRUCTURE_STORAGE]: 4,
            [STRUCTURE_LINK]: 5,
            [STRUCTURE_TERMINAL]: 6,
            [STRUCTURE_EXTRACTOR]: 7,
            [STRUCTURE_LAB]: 8,
            [STRUCTURE_FACTORY]: 9,
            [STRUCTURE_ROAD]: 10,
            [STRUCTURE_RAMPART]: 11,
            [STRUCTURE_WALL]: 12
        };

        const sites = this.colony.room?.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[] ?? [];
        if (sites.length === 0) {
            this._bestSite = null;
            return null;
        }

        this._bestSite = sites.sort((a, b) => {
            const pA = priority[a.structureType] !== undefined ? priority[a.structureType]! : 20;
            const pB = priority[b.structureType] !== undefined ? priority[b.structureType]! : 20;

            if (pA !== pB) return pA - pB;

            // Tie-break: Completion progress (finish what's started)
            const progressA = a.progress / a.progressTotal;
            const progressB = b.progress / b.progressTotal;
            if (Math.abs(progressA - progressB) > 0.1) return progressB - progressA;

            return 0;
        })[0];

        return this._bestSite;
    }
}
