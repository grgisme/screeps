// ============================================================================
// TransporterOverlord — Manages hauler creeps via the LogisticsNetwork
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningOverlord } from "./MiningOverlord";
import { Zerg } from "../zerg/Zerg"; // ── FIX: Import base Zerg
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";
import { getParkingZones, pickParkingZone } from "../../utils/ParkingZones";

const log = new Logger("TransporterOverlord");

export class TransporterOverlord extends Overlord {

    transporters: Zerg[] = []; // ── FIX: Use base Zerg

    constructor(colony: Colony) {
        super(colony, "transporter");
    }

    init(): void {
        // Cast existing zergs — no re-wrapping (prevents wrapper thrashing)
        this.transporters = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "transporter");

        // Spawn Logic
        this.wishlistSpawns();
    }

    run(): void {
        const freeWithdraw: Zerg[] = [];
        const freeTransfer: Zerg[] = [];

        for (const transporter of this.transporters) {
            if (!transporter.isAlive()) continue;

            // Road Repair-on-Transit
            if (transporter.store?.energy && transporter.store.energy > 0 && transporter.creep?.getActiveBodyparts(WORK)) {
                const road = transporter.pos?.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax);
                if (road) transporter.repair(road);
            }

            if (transporter.task) continue;

            const mem = transporter.memory as any;

            // ── Fix 5: State Machine transitions ──
            if (transporter.store?.getUsedCapacity() === 0) mem.collecting = true;
            if (transporter.store?.getFreeCapacity() === 0) mem.collecting = false;

            if (mem.collecting) {
                freeWithdraw.push(transporter);
            } else {
                freeTransfer.push(transporter);
            }
        }



        // ── Batch Gale-Shapley matching ──
        // Pass all free haulers at once for stable matching
        for (const transporter of freeWithdraw) {
            const mem = transporter.memory as any;
            const targetId = this.colony.logistics.matchWithdraw(transporter, freeWithdraw);
            if (targetId) {
                const target = Game.getObjectById(targetId);
                if (target && 'amount' in target) {
                    transporter.setTask(new PickupTask(targetId as Id<Resource>));
                } else {
                    transporter.setTask(new WithdrawTask(targetId as Id<Structure | Tombstone | Ruin>));
                }
            } else if ((transporter.store?.getUsedCapacity() ?? 0) > 0) {
                mem.collecting = false; // Nothing to withdraw, go deliver what we have
                freeTransfer.push(transporter); // Re-add to transfer batch
            }
        }

        for (const transporter of freeTransfer) {
            const targetId = this.colony.logistics.matchTransfer(transporter, freeTransfer);
            if (targetId) {
                transporter.setTask(new TransferTask(targetId as Id<Structure | Creep>));
            } else if ((transporter.store?.getFreeCapacity() ?? 0) > 0) {
                (transporter.memory as any).collecting = true;
            }
            // Empty + no transfer target: falls through to the failsafe below.
        }

        // ── Failsafe idle dispatch ──
        // Catches any transporter that finished all its work this tick but received
        // no new task (e.g. completely emptied into extensions with nothing left to
        // withdraw). Without this they park next to the spawn and block all traffic.
        //
        // IMPORTANT: Check creep.memory.task (persisted), NOT transporter.task (heap).
        // transporter.task is always null here because zerg.run() (which deserializes it)
        // fires AFTER the overlord's run(). Using the heap field would fire the failsafe
        // for every creep with a task, causing a double travelTo conflict each tick.
        for (const transporter of this.transporters) {
            const nativeCreep = transporter.creep;
            if (!nativeCreep || nativeCreep.spawning) continue;
            // Already has an assigned task from THIS tick's overlord loop? Skip.
            if (transporter.task) continue;
            // Has a persisted task in memory (will be deserialized by zerg.run())? Skip.
            if ((nativeCreep.memory as any).task) continue;

            const room = this.colony.room;
            if (room && transporter.pos) {
                const anchor = (this.colony.memory as any).anchor as { x: number; y: number } | undefined;
                if (anchor) {
                    // DT-based parking: pick a spacious dead-end outside the bunker.
                    // Random top-3 selection prevents all idle transporters clumping
                    // onto the single nearest tile.
                    const zones = getParkingZones(room, anchor.x, anchor.y);
                    const target = pickParkingZone(transporter.pos, zones);
                    if (target) transporter.travelTo(target, 0);
                } else {
                    // Bootstrap fallback (no anchor yet): flee spawn outward
                    const spawn = room.find(FIND_MY_SPAWNS)?.[0];
                    if (spawn) {
                        const dx = transporter.pos.x - spawn.pos.x;
                        const dy = transporter.pos.y - spawn.pos.y;
                        const mx = dx === 0 ? 1 : Math.sign(dx);
                        const my = dy === 0 ? 1 : Math.sign(dy);
                        const tx = Math.min(49, Math.max(1, transporter.pos.x + mx * 5));
                        const ty = Math.min(49, Math.max(1, transporter.pos.y + my * 5));
                        transporter.travelTo(new RoomPosition(tx, ty, spawn.pos.roomName), 1);
                    }
                }
            }
        }
    }

    addZerg(zerg: Zerg): void {
        // Just add to the base zergs array — no re-wrapping
        super.addZerg(zerg);
    }

    private wishlistSpawns(): void {
        const room = this.colony.room;
        if (!room) return;

        // ── Part-Count Balancing (Research-backed) ─────────────────────────
        // Total CARRY parts = Σ(energyPerTick × 2 × distance) / 50
        // per source, summed across all mining sites.
        const miningOverlord = this.colony.overlords
            .find((o: Overlord) => o instanceof MiningOverlord) as MiningOverlord | undefined;

        if (!miningOverlord || miningOverlord.sites.length === 0) return;

        // Only count sites that are actively mined (have container/link)
        const activeSites = miningOverlord.sites.filter(s => s.container || s.link);
        if (activeSites.length === 0) return;

        let totalCarryNeeded = 0;
        for (const site of activeSites) {
            totalCarryNeeded += Math.ceil(site.calculateHaulingPowerNeeded() / 50);
        }

        // Current CARRY capacity across all transporters
        // Discount dying transporters (TTL ≤ spawnTime + travelTime)
        // so replacements are queued before the gap opens
        const avgDistance = activeSites.length > 0
            ? Math.round(activeSites.reduce((sum, s) => sum + (s.distance || 20), 0) / activeSites.length)
            : 20;

        let currentCarry = 0;
        for (const t of this.transporters) {
            const carryParts = t.creep?.getActiveBodyparts(CARRY) ?? 0;
            const ttl = t.creep?.ticksToLive ?? Infinity;
            const bodySize = t.creep?.body?.length ?? 6;
            const preSpawnThreshold = (bodySize * 3) + avgDistance;

            if (ttl <= preSpawnThreshold) {
                // This transporter is dying — don't count its capacity
                continue;
            }
            currentCarry += carryParts;
        }

        if (currentCarry >= totalCarryNeeded) return; // Fully staffed

        // ── Road-Aware Body Template ───────────────────────────────────────
        const body = this.buildTransporterBody(room);

        if (body.length === 0) return; // Can't afford minimum body

        // Dynamic cap: how many of this body size fill the CARRY requirement?
        const carryPerCreep = body.filter(p => p === CARRY).length;
        const maxTransporters = Math.ceil(totalCarryNeeded / Math.max(carryPerCreep, 1));

        if (this.transporters.length >= maxTransporters) return;

        this.colony.hatchery.enqueue({
            priority: 90,
            bodyTemplate: body,
            overlord: this,
            name: `Transporter_${this.colony.name}_${Game.time}`,
            memory: { role: "transporter" }
        });

        log.debug(() => `Hauler deficit: ${currentCarry}/${totalCarryNeeded} CARRY. Spawning (${body.length} parts).`);
    }

    /**
     * Build a route-aware transporter body using MiningSite terrain data.
     *
     * Uses cached `roadCoverage` and `hasSwamp` from each MiningSite's
     * actual hauling route (containerPos → spawn/storage), NOT a naive
     * room-wide road count. Data lives in heap, recalculated every 50 ticks.
     *
     * - ≥75% road coverage: [CARRY, CARRY, MOVE] × N + 1 WORK (2:1 ratio + repair)
     * - <75% (plains/swamp): [CARRY, MOVE] × N (1:1 ratio, no WORK)
     */
    private buildTransporterBody(room: Room): BodyPartConstant[] {
        // Bootstrap fix: if no transporters/fillers exist, extensions won't be filled
        // passively. Use only the spawn's current energy + energy already in extensions,
        // rather than the theoretical energyCapacityAvailable, to avoid a deadlock where
        // the spawn waits for 400e that can never arrive.
        const hasHaulers = this.colony.creeps.some(c => {
            const role = (c.memory as any).role;
            return role === 'transporter' || role === 'filler';
        });

        let capacity: number;
        if (hasHaulers) {
            capacity = room.energyCapacityAvailable;
        } else {
            // Sum: spawn energy + existing extension energy (only what's actually there)
            const spawns = room.find(FIND_MY_SPAWNS);
            const spawnEnergy = spawns.reduce((sum, s) => sum + s.store.getUsedCapacity(RESOURCE_ENERGY), 0);
            const extensions = room.find(FIND_MY_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_EXTENSION
            }) as StructureExtension[];
            const extEnergy = extensions.reduce((sum, e) => sum + e.store.getUsedCapacity(RESOURCE_ENERGY), 0);
            capacity = spawnEnergy + extEnergy;
        }

        // Read route terrain from MiningSite cache (0 CPU — heap data)
        const miningOverlord = this.colony.overlords
            .find((o: Overlord) => o instanceof MiningOverlord) as MiningOverlord | undefined;

        let avgRoadCoverage = 0;
        if (miningOverlord) {
            const activeSites = miningOverlord.sites.filter(s => s.container || s.link);
            if (activeSites.length > 0) {
                const validSites = activeSites.filter(s => s.roadCoverage >= 0);
                if (validSites.length > 0) {
                    avgRoadCoverage = validSites.reduce((sum, s) => sum + s.roadCoverage, 0) / validSites.length;
                }
            }
        }

        const hasGoodRoads = avgRoadCoverage >= 0.75;
        const body: BodyPartConstant[] = [];

        if (hasGoodRoads) {
            // Road mode: 2:1 CARRY:MOVE ratio + 1 WORK for repair-on-transit
            const remaining = capacity - 100; // Reserve 100e for WORK
            const segmentCost = 150; // CARRY(50) + CARRY(50) + MOVE(50)
            const segments = Math.min(Math.floor(remaining / segmentCost), 16);
            if (segments < 1) return [];

            for (let i = 0; i < segments; i++) {
                body.push(CARRY, CARRY, MOVE);
            }
            body.push(WORK); // Single WORK for road repair
        } else {
            // Plains/swamp mode: 1:1 ratio for full speed, no WORK (nothing to repair)
            const segmentCost = 100; // CARRY(50) + MOVE(50)
            const segments = Math.min(Math.floor(capacity / segmentCost), 25);
            if (segments < 1) return [];

            for (let i = 0; i < segments; i++) {
                body.push(CARRY, MOVE);
            }
        }

        return body;
    }
}
