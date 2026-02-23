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
import { GlobalCache } from "../../kernel/GlobalCache";



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

        // Predictive Requesting: only register workers as energy sinks when they are
        // running LOW (used < 30% of total capacity). This dispatches a hauler early
        // enough to arrive just-in-time, targeting a 100% duty cycle. Workers above
        // the threshold are not registered — haulers won't be wasted on nearly-full creeps.
        // Workers in collecting=true mode are excluded: they're self-fetching, so a
        // hauler dispatch would race their own withdraw/harvest task.
        for (const worker of this.workers) {
            const creep = worker.creep;
            if (!creep) continue;

            const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
            const isSelfFetching = (worker.memory as any).collecting === true;

            // Fix 1 — Predictive Requesting (Mathematical Threshold):
            // Request exactly when current energy + already-reserved deliveries fall
            // below what the worker will consume during a hauler's average travel time.
            // Formula: workParts × 5 energy/tick × 15 tick average travel time.
            // A 2-WORK builder fires at 150e remaining — guaranteeing the hauler arrives
            // before the builder runs dry. Static percentages over-request on small bodies.
            const workParts = creep.getActiveBodyparts(WORK) || 1;
            const consumptionPerTick = workParts * 5;
            const estimatedTravelTime = 15; // ticks — conservative average for hauler travel
            const predictiveThreshold = consumptionPerTick * estimatedTravelTime;

            const incoming = this.colony.logistics.incomingReservations.get(creep.id) || 0;
            const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);

            if (!isSelfFetching && used + incoming <= predictiveThreshold && free > 0) {
                // Fix #3: Dynamic priority based on task urgency.
                // Higher = dispatched sooner by Gale-Shapley matching.
                let reqPriority = 4; // Default: generic work
                const taskMem = (worker.memory as any).task;
                if (taskMem) {
                    if (taskMem.name === "Build") {
                        const site = Game.getObjectById(taskMem.targetId as Id<ConstructionSite>);
                        if (site) {
                            if (site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER) {
                                reqPriority = 8; // Critical defense / spawn infra
                            } else if (site.structureType === STRUCTURE_EXTENSION || site.structureType === STRUCTURE_CONTAINER) {
                                reqPriority = 6; // Economy upgrades
                            } else if (site.structureType === STRUCTURE_ROAD) {
                                reqPriority = 2; // Nice-to-have infra
                            }
                        }
                    } else if (taskMem.name === "Upgrade") {
                        reqPriority = 3; // Important but not urgent
                    } else if (taskMem.name === "Repair") {
                        reqPriority = 5; // Active repair is moderately urgent
                    }
                }

                this.colony.logistics.requestInput(creep.id as any, { amount: free, priority: reqPriority });
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

        // Fix #2: Hoist spatial queries OUTSIDE the worker loop.
        // Passing a pre-computed array to findClosestByRange() converts the
        // expensive room scan + filter callback (O(structures * workers)) into
        // simple linear distance math (O(results * workers)).
        const activeSources = room?.find(FIND_SOURCES_ACTIVE, {
            filter: (s: Source) => !minedSourceIds.has(s.id)
        }) || [];

        // ── Rampart Repair Budget Gate ──────────────────────────────────────
        // Below RAMPART_REPAIR_GATE energy in storage: skip rampart repair entirely.
        // Above gate: sliding-scale target HP = max(50k, min(storageLevel/10, rclCap)).
        // This prevents workers from draining economy on rampart hardening during
        // the critical RCL 3→4 push when every unit of energy matters.
        const storage = room?.storage;
        const storageLevel = storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        const RAMPART_REPAIR_GATE = 50_000;
        const repairRamparts = storageLevel >= RAMPART_REPAIR_GATE;
        // RCL-keyed engine hard-caps for rampart HP
        const RCL_RAMPART_HARDCAP: Partial<Record<number, number>> = {
            2: 300_000, 3: 1_000_000, 4: 3_000_000,
            5: 10_000_000, 6: 30_000_000, 7: 100_000_000, 8: 300_000_000
        };
        const rclLevel = room?.controller?.level ?? 0;
        const rampartHardcap = RCL_RAMPART_HARDCAP[rclLevel] ?? 1_000_000;
        // e.g. 500k storage → 50k target hits; 1M → 100k; 10M → 1M (capped at rclCap)
        const rampartTargetHits = repairRamparts
            ? Math.max(50_000, Math.min(storageLevel / 10, rampartHardcap))
            : 0;

        // Non-rampart emergency repairs: structures < 50% HP (exclude walls & ramparts)
        const damagedNonRamparts = room?.find(FIND_STRUCTURES, {
            filter: (s: Structure) => {
                if (s.structureType === STRUCTURE_WALL) return false;
                if (s.structureType === STRUCTURE_RAMPART) return false;
                return s.hits < s.hitsMax * 0.5;
            }
        }) || [];

        // Rampart hardening: only when storage gate is met, sorted lowest HP first
        // so the most vulnerable section of the perimeter is always hardened first.
        const damagedRamparts = repairRamparts
            ? (room?.find(FIND_STRUCTURES, {
                filter: (s: Structure) =>
                    s.structureType === STRUCTURE_RAMPART && s.hits < rampartTargetHits
            }) || []).sort((a, b) => a.hits - b.hits)
            : [];

        const filledContainers = room?.find(FIND_STRUCTURES, {
            filter: (s: Structure) =>
                s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 50
        }) as StructureContainer[] || [];

        const anyContainers = room?.find(FIND_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
        }) as StructureContainer[] || [];

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

            // ── Static Sink: anchor while awaiting in-flight delivery ─────────────
            // If the worker is empty but NOT collecting (because a transporter is en
            // route), hold position near the nearest construction site or container.
            // Emitting no moveTo() keeps the hauler's cached path valid — the key fix
            // for Kinetic Friction / constant path-recalculation CPU spikes.
            //
            // Fix: If there's no construction site to anchor toward, move to a parking
            // zone instead of idling in-place. Workers idling on hatchery road tiles
            // create traffic jams that block transporters trying to deliver energy.
            if (!mem.collecting && (worker.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0) === 0) {
                const creepId = worker.creep?.id;
                const inFlight = creepId ? (this.colony.logistics.incomingReservations.get(creepId) || 0) : 0;
                if (inFlight > 0 && hasTransporters) {
                    worker.creep?.say('⏳');
                    // Nudge toward the nearest construction site so delivery meets us at the job
                    const site = this.getBestConstructionSite();
                    if (site && worker.pos && !worker.pos.inRangeTo(site.pos, 3)) {
                        worker.travelTo(site.pos, 3);
                    } else if (worker.pos && this.isInHatcheryZone(worker.pos)) {
                        // No site to anchor toward AND we're blocking the hatchery.
                        // Move to a parking zone so transporters can deliver unimpeded.
                        this.parkAwayFromHatchery(worker);
                    }
                    // If close enough to a site and not in hatchery zone, stay still
                    continue;
                }
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

                // Miner Deference: use pre-hoisted activeSources array (Fix #2)
                const source = worker.pos?.findClosestByRange(activeSources);

                if (source) {
                    worker.setTask(new HarvestTask(source.id));
                } else {
                    // All sources have miners — use pre-hoisted filledContainers array (Fix #2)
                    const container = worker.pos?.findClosestByRange(filledContainers);

                    if (container) {
                        worker.setTask(new WithdrawTask(container.id as Id<Structure>));
                    } else {
                        // Anchor to nearest container — use pre-hoisted anyContainers array (Fix #2)
                        // Fix: Skip hatchery containers when fillers are active — workers anchoring
                        // there compete with transporters for the same corridor tiles.
                        const hasFillerCreeps = this.colony.creeps.some(c => (c.memory as any)?.role === "filler");
                        const candidateContainers = hasFillerCreeps
                            ? anyContainers.filter(c => !this.isInHatcheryZone(c.pos))
                            : anyContainers;
                        const anyContainer = worker.pos?.findClosestByRange(
                            candidateContainers.length > 0 ? candidateContainers : anyContainers
                        );

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

                // ── RCL1 Metabolic Stabilization ─────────────────────────────────
                // Research: "First 2 pioneers must transfer to Spawn before upgrading
                // to prevent metabolic collapse." Only active at RCL1 with no transporters
                // (no filler / transporter to handle it) and only for the first 2 workers.
                const roomRCL = room?.controller?.level ?? 0;
                if (roomRCL <= 1 && !hasTransporters) {
                    const spawn = room?.find(FIND_MY_SPAWNS)?.[0];
                    if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                        && this.workers.indexOf(worker) < 2) {
                        worker.setTask(new TransferTask(spawn.id as Id<Structure>));
                        continue;
                    }
                }

                // 1a. Emergency repairs — non-rampart structures under 50% HP (closest by range)
                const closestDamaged = worker.pos?.findClosestByRange(damagedNonRamparts);
                if (closestDamaged) {
                    const task = new RepairTask(closestDamaged.id);
                    task.settings.targetHits = closestDamaged.hitsMax;
                    worker.setTask(task);
                    continue;
                }

                // 1b. Rampart hardening — lowest HP first (global priority, budget-gated)
                // damagedRamparts is pre-sorted ascending by hits; [0] is always most urgent.
                // targetHits = sliding scale so workers don't try to reach max HP in one shot.
                if (damagedRamparts.length > 0) {
                    const target = damagedRamparts[0];
                    const task = new RepairTask(target.id);
                    task.settings.targetHits = rampartTargetHits;
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
                // Fix #5 — Geometric Anchoring: prefer sites within range 3 of current
                // position before falling back to the global priority-weighted best site.
                // Workers that stay still preserve the hauler's path cache — each step
                // forces a PathFinder rebuild costing ~0.1-0.2 CPU.
                const adjacentSite = worker.pos?.findInRange(FIND_MY_CONSTRUCTION_SITES, 3)[0];
                const site = adjacentSite || this.getBestConstructionSite();
                if (site) {
                    worker.setTask(new BuildTask(site.id));
                    continue;
                }

                // 4. Upgrade controller (only if no dedicated upgraders)
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

        // RCL1 Rush: Do NOT build anything at RCL1 — bypass all construction sites
        // and route workers directly to upgradeController(). The controller only needs
        // 200 energy to advance to RCL2; spending 60+ ticks building a container first
        // is a severe bottleneck. Containers/extensions are built properly at RCL2+.
        if ((this.colony.room?.controller?.level ?? 0) <= 1) {
            this._bestSite = null;
            return null;
        }

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

    // -----------------------------------------------------------------------
    // Hatchery Congestion Avoidance
    // -----------------------------------------------------------------------

    /**
     * Check if a position is within the hatchery congestion zone.
     * The zone is defined as Chebyshev distance ≤ 3 from any spawn.
     * This is the high-traffic area where transporters need clear access
     * to deliver energy to spawns, extensions, and the hub container.
     */
    private isInHatcheryZone(pos: RoomPosition): boolean {
        const room = this.colony.room;
        if (!room) return false;

        const spawns = room.find(FIND_MY_SPAWNS);
        for (const spawn of spawns) {
            if (pos.getRangeTo(spawn) <= 3) return true;
        }

        // Also check the anchor center (bunker core) if available
        const anchor = (this.colony.memory as any).anchor as { x: number; y: number } | undefined;
        if (anchor) {
            const cheb = Math.max(Math.abs(pos.x - anchor.x), Math.abs(pos.y - anchor.y));
            if (cheb <= 4) return true; // Within bunker inner ring
        }

        return false;
    }

    /**
     * Move a worker to a parking zone outside the hatchery area.
     * Called when the worker has no task and is idling in the hatchery
     * congestion zone, blocking transporter traffic.
     */
    private parkAwayFromHatchery(worker: Worker): void {
        const room = this.colony.room;
        if (!room || !worker.pos) return;

        const anchor = (this.colony.memory as any).anchor as { x: number; y: number } | undefined;
        if (anchor) {
            const zones = getParkingZones(room, anchor.x, anchor.y);
            const staticCached = GlobalCache.get<{ matrix: CostMatrix }>(`matrix_static:${room.name}`);
            const target = pickParkingZone(worker.pos, zones, staticCached?.matrix);
            if (target) {
                worker.travelTo(target, 0);
                return;
            }
        }

        // Fallback: flee away from the nearest spawn
        const spawn = room.find(FIND_MY_SPAWNS)?.[0];
        if (spawn) {
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
