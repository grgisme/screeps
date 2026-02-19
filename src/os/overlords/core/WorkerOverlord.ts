// ============================================================================
// WorkerOverlord — IoC task assignment for worker creeps
// ============================================================================
//
// ⚠️ IoC PATTERN: Overlords assign tasks. They do NOT call zerg.run().
// Colony.run() iterates all zergs and calls zerg.run() once per tick.
// ============================================================================

import { Overlord } from "../Overlord";
import type { Colony } from "../../colony/Colony";
import { Worker } from "../../zerg/Worker";
import { MiningOverlord } from "../MiningOverlord";
import { WithdrawTask } from "../../tasks/WithdrawTask";
import { PickupTask } from "../../tasks/PickupTask";
import { HarvestTask } from "../../tasks/HarvestTask";
import { UpgradeTask } from "../../tasks/UpgradeTask";
import { BuildTask } from "../../tasks/BuildTask";
import { RepairTask } from "../../tasks/RepairTask";
import { Logger } from "../../../utils/Logger";

const log = new Logger("Worker");

export class WorkerOverlord extends Overlord {
    workers: Worker[];

    constructor(colony: Colony) {
        super(colony, "worker");
        this.workers = [];
    }

    init(): void {
        // Cast existing zergs — no re-wrapping (prevents wrapper thrashing)
        this.workers = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "worker") as Worker[];

        this.adoptOrphans();
        this.handleSpawning();
    }

    run(): void {
        for (const worker of this.workers) {
            if (!worker.isAlive() || worker.task) continue;

            if (worker.store?.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                // Empty — find energy source

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
                const source = worker.pos?.findClosestByRange(FIND_SOURCES_ACTIVE);
                if (source) {
                    worker.setTask(new HarvestTask(source.id));
                }
            } else {
                // Has energy — work priority cascade

                // 1. Emergency repairs
                const damaged = worker.pos?.findClosestByRange(FIND_STRUCTURES, {
                    filter: (s: Structure) => {
                        if (s.structureType === STRUCTURE_WALL) return false; // Walls are handled by Masons/Defense
                        if (s.structureType === STRUCTURE_RAMPART) return s.hits < 10000; // Save newborn ramparts from decay
                        return s.hits < s.hitsMax * 0.5;
                    }
                });
                if (damaged) {
                    worker.setTask(new RepairTask(damaged.id));
                    continue;
                }

                // 2. Build construction sites
                const site = this.getBestConstructionSite();
                if (site) {
                    worker.setTask(new BuildTask(site.id));
                    continue;
                }

                // 3. Upgrade controller (default)
                const controller = this.colony.room?.controller;
                if (controller) {
                    worker.setTask(new UpgradeTask(controller.id));
                }
            }
        }
    }

    private adoptOrphans(): void {
        if (Game.time % 100 !== 0) return;

        const orphans = this.colony.creeps.filter(
            (creep: Creep) => creep.memory.role === "worker" && !this.colony.getZerg(creep.name)
        );

        for (const orphan of orphans) {
            const zerg = this.colony.registerZerg(orphan);
            zerg.task = null;
            this.zergs.push(zerg);
            this.workers.push(zerg as Worker);
            log.info(`${this.colony.name}: Adopted orphan worker ${orphan.name}`);
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room) return;

        // Check if mining is suspended (no containers/storage yet)
        const miningOverlord = this.colony.overlords
            .find((o: Overlord) => o instanceof MiningOverlord) as MiningOverlord | undefined;
        const miningSuspended = miningOverlord ? miningOverlord.isSuspended : true;

        // Slot-based cap: count walkable tiles around all sources
        const maxWorkers = this.countMiningSpots(room) + 2;

        // Despawn: if way over cap, suicide lowest-TTL worker
        if (this.workers.length > maxWorkers + 2) {
            let worst: Worker | null = null;
            let worstTTL = Infinity;
            for (const w of this.workers) {
                const ttl = w.creep?.ticksToLive ?? Infinity;
                if (ttl < worstTTL) {
                    worstTTL = ttl;
                    worst = w;
                }
            }
            if (worst) {
                log.info(`Despawning excess worker ${worst.name} (TTL: ${worstTTL}, cap: ${maxWorkers})`);
                worst.creep?.suicide();
                this.workers = this.workers.filter(w => w.name !== worst!.name);
            }
        }

        // Don't spawn if at or over cap
        if (this.workers.length >= maxWorkers) return;

        // Base target: more during genesis, fewer once mining is online
        let target = miningSuspended ? Math.min(4, maxWorkers) : 1;

        // Scale up for construction work
        const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        const progressTotal = sites.reduce((sum: number, site: ConstructionSite) => sum + (site.progressTotal - site.progress), 0);

        if (progressTotal > 0) {
            target += Math.floor(progressTotal / 2000);
        }

        if (target > maxWorkers) target = maxWorkers;

        if (this.workers.length < target) {
            this.colony.hatchery.enqueue({
                priority: miningSuspended ? 80 : 3,
                bodyTemplate: [WORK, CARRY, MOVE],
                overlord: this,
                memory: { role: "worker" }
            });
        }
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
                    if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                        spots++;
                    }
                }
            }
        }

        return spots;
    }

    getBestConstructionSite(): ConstructionSite | null {
        // Priority Table
        const priority: { [key in StructureConstant]?: number } = {
            [STRUCTURE_CONTAINER]: 0,
            [STRUCTURE_SPAWN]: 1,
            [STRUCTURE_EXTENSION]: 2,
            [STRUCTURE_TOWER]: 3,
            [STRUCTURE_ROAD]: 4,
            [STRUCTURE_STORAGE]: 5,
            [STRUCTURE_TERMINAL]: 5
        };

        const sites = this.colony.room?.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[] ?? [];
        if (sites.length === 0) return null;

        return sites.sort((a, b) => {
            const pA = priority[a.structureType] !== undefined ? priority[a.structureType]! : 10;
            const pB = priority[b.structureType] !== undefined ? priority[b.structureType]! : 10;

            if (pA !== pB) return pA - pB;

            // Tie-break: Completion progress (finish what's started)
            const progressA = a.progress / a.progressTotal;
            const progressB = b.progress / b.progressTotal;
            if (Math.abs(progressA - progressB) > 0.1) return progressB - progressA;

            return 0;
        })[0];
    }
}
