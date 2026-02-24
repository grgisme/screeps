import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Zerg } from "../zerg/Zerg";
import { HarvestTask } from "../tasks/HarvestTask";
import { RepairTask } from "../tasks/RepairTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("RemoteMiningOverlord");

export class RemoteMiningOverlord extends Overlord {
    targetRoom: string;
    sites: MiningSite[] = [];
    miners: Zerg[] = [];
    haulers: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `remoteMining_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        this.miners = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "miner");
        this.haulers = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "hauler");

        const room = Game.rooms[this.targetRoom];
        if (!room) return;

        const hostiles = room.find(FIND_HOSTILE_CREEPS).filter(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK));

        if (!Memory.rooms) Memory.rooms = {};
        if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;

        if (hostiles.length > 0) {
            if (!Memory.rooms[room.name].isDangerous) {
                log.alert(`invader-${this.targetRoom}`, `Invader detected in ${this.targetRoom}! Suspending mining.`);
                Memory.rooms[room.name].isDangerous = true;
            }
            Memory.rooms[room.name].dangerUntil = Game.time + 100;

            // T1.7 — Dynamic Invader Counter-Body
            // Spawn a counter-creep matched to the actual hostile body composition.
            // One counter per remote room; counter self-expires when danger clears.
            const hasCounter = this.zergs.some(
                z => z.isAlive() && (z.memory as any)?.role === "counter" && (z.memory as any)?.targetRoom === this.targetRoom
            );
            if (!hasCounter) {
                const capacity = this.colony.room?.energyCapacityAvailable ?? 300;
                const hasHeal = hostiles.some(h => h.body.some(p => p.type === HEAL));
                const hasAttack = hostiles.some(h => h.body.some(p => p.type === ATTACK));
                const hasRanged = hostiles.some(h => h.body.some(p => p.type === RANGED_ATTACK));

                let counterBody: BodyPartConstant[];
                let reason: string;

                if (hasAttack && hasHeal) {
                    // Melee + healer pair — need high sustained DPS at range
                    counterBody = [RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
                        RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE];
                    reason = "melee+healer → heavy ranged";
                } else if (hasRanged && !hasAttack) {
                    // Ranged only — rush in close where ranged attack is less effective
                    counterBody = [ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE];
                    reason = "ranged-only → melee rusher";
                } else {
                    // Pure melee — stay at range 3 and kite
                    counterBody = [RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
                        MOVE, MOVE, MOVE, MOVE];
                    reason = "melee → ranged kiter";
                }

                // Only spawn if room can actually afford the body
                const bodyCost = counterBody.reduce((s, p) => s + BODYPART_COST[p], 0);
                if (capacity >= bodyCost) {
                    log.alert(`counter-${this.targetRoom}`, `Spawning counter (${reason}) for ${this.targetRoom}.`);
                    this.colony.hatchery.enqueue({
                        priority: 200,
                        bodyTemplate: counterBody,
                        overlord: this,
                        name: `counter_${this.targetRoom}_${Game.time}`,
                        memory: { role: "counter", targetRoom: this.targetRoom }
                    });
                }
            }
            return;
        } else if (Memory.rooms[room.name].isDangerous && Game.time > (Memory.rooms[room.name].dangerUntil || 0)) {
            delete Memory.rooms[room.name].isDangerous;
            delete Memory.rooms[room.name].dangerUntil;
        }

        // T1.6 — InvaderCore Detection & Cleanup
        // Cores reserve the controller for Invaders, blocking our reservation.
        // Spawn a Cleaner (WORK ×5, MOVE ×5) using dismantle() — 50× more
        // efficient than attack() against structures. Suspend all mining while
        // the core is alive (reservation is invalid anyway).
        const cores = room.find(FIND_HOSTILE_STRUCTURES, {
            filter: (s: Structure) => (s as any).structureType === STRUCTURE_INVADER_CORE
        });
        if (cores.length > 0) {
            const hasCleaner = this.zergs.some(z => z.isAlive() && (z.memory as any)?.role === "cleaner");
            if (!hasCleaner) {
                log.alert(`core-${this.targetRoom}`, `InvaderCore detected in ${this.targetRoom}! Spawning Cleaner.`);
                this.colony.hatchery.enqueue({
                    priority: 150,
                    bodyTemplate: [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE],
                    overlord: this,
                    name: `cleaner_${this.targetRoom}_${Game.time}`,
                    memory: { role: "cleaner", targetRoom: this.targetRoom }
                });
            }
            return; // Suspend normal mining until core is gone
        }

        if (this.sites.length === 0) {
            const sources = room.find(FIND_SOURCES);
            for (const source of sources) {
                const site = new MiningSite(this.colony, source.id);
                this.calculateRemoteDistance(site);
                this.sites.push(site);
            }
        }

        for (const site of this.sites) {
            site.refreshStructureIds();

            // T1.5 — EPT Profitability Gate
            // Skip spawning for sites where body cost exceeds energy income.
            // Re-evaluate every 5000 ticks in case roads are built or distance changes.
            const roomMem = Memory.rooms[this.targetRoom] as any;
            const unprofitableUntil = roomMem?.unprofitableUntil ?? 0;
            if (unprofitableUntil > Game.time) continue; // Suspended

            if (site.distance > 0 && Game.time % 500 === 0) {
                const minerCostPerTick = 700 / 1500;  // ~worst-case miner body / creep lifetime
                const haulerCostPerTick = 450 / 1500; // ~worst-case hauler body / creep lifetime
                const eptGross = room.controller?.reservation ? 10 : 5; // reserved = 3000 cap
                const eptNet = eptGross - minerCostPerTick - haulerCostPerTick;

                if (site.distance > 150 && eptNet < 3) {
                    log.warning(`Remote site ${site.sourceId.slice(-4)} in ${this.targetRoom} is unprofitable (dist=${site.distance}, eptNet=${eptNet.toFixed(1)}). Suspending for 5000 ticks.`);
                    if (!Memory.rooms[this.targetRoom]) Memory.rooms[this.targetRoom] = {} as any;
                    (Memory.rooms[this.targetRoom] as any).unprofitableUntil = Game.time + 5000;
                    continue;
                }
            }

            this.handleSpawning(site);
        }
    }

    private calculateRemoteDistance(site: MiningSite): void {
        const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
        if (!dropoff || !site.source) return;
        const path = PathFinder.search(site.source.pos, { pos: dropoff.pos, range: 1 });
        site.distance = path.path.length;
    }

    private handleSpawning(site: MiningSite): void {
        const capacity = this.colony.room?.energyCapacityAvailable ?? 300;

        // ── Remote Mining Energy Gate ────────────────────────────────────────
        // Remote mining drains home-room transport capacity. Gate spawning on
        // storage level so we never fund remote ops at the expense of core
        // infrastructure (miners, transporters, spawn refill).
        //
        //   < 50k energy: skip all remote spawning entirely
        //  50k–75k energy: only spawn the miner (preserve income, skip haulers)
        //   ≥ 75k energy: full remote ops — miners + haulers
        const homeStorage = this.colony.room?.storage;
        const storageLevel = homeStorage?.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        const hasStorage = !!homeStorage;
        const allowMiner = !hasStorage || storageLevel >= 50_000;
        const allowHauler = !hasStorage || storageLevel >= 75_000;

        // 1. Exact 5-WORK Math + 1 CARRY for Static Repair
        const siteMiners = this.miners.filter(m => (m.memory as any)?.state?.siteId === site.sourceId);
        if (allowMiner && siteMiners.length < 1) {
            let minerBody: BodyPartConstant[] = [WORK, WORK, MOVE, MOVE];
            if (capacity >= 800) {
                minerBody = [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // 6 WORK for unreserved catchup
            } else if (capacity >= 700) {
                minerBody = [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // Exact 5-WORK
            }

            this.colony.hatchery.enqueue({
                priority: 80,
                bodyTemplate: minerBody,
                overlord: this,
                name: `rminer_${site.sourceId.slice(-4)}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.sourceId } }
            });
        }

        // 2. Part-Count Balanced Haulers
        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any)?.state?.siteId === site.sourceId)
            .reduce((sum, h) => sum + (h.store?.getCapacity() ?? 0), 0);

        if (allowHauler && currentPower < powerNeeded) {
            let haulerBody: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE];

            if (capacity >= 450) {
                // Reserve 150 energy for WORK (100) + MOVE (50) for road repair
                const haulCapacity = capacity - 150;
                const carryPairs = Math.floor(haulCapacity / 150); // CARRY, CARRY, MOVE = 150
                haulerBody = [WORK, MOVE];
                for (let i = 0; i < carryPairs; i++) {
                    haulerBody.push(CARRY, CARRY, MOVE);
                    if (haulerBody.length >= 47) break; // 50 part limit
                }
            }

            this.colony.hatchery.enqueue({
                priority: 40,
                bodyTemplate: haulerBody,
                overlord: this,
                name: `rhauler_${site.sourceId.slice(-4)}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.sourceId } }
            });
        }
    }

    run(): void {
        const isDangerous = Memory.rooms[this.targetRoom]?.isDangerous;
        const fallbackPos = this.colony.room?.storage?.pos || this.colony.room?.find(FIND_MY_SPAWNS)?.[0]?.pos;

        // T1.6 — Cleaner micro: travel to target room and dismantle InvaderCore
        const cleaners = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "cleaner");
        for (const cleaner of cleaners) {
            if (!cleaner.isAlive()) continue;
            if (cleaner.room?.name !== this.targetRoom) {
                cleaner.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                continue;
            }
            const core = cleaner.room.find(FIND_HOSTILE_STRUCTURES, {
                filter: (s: Structure) => (s as any).structureType === STRUCTURE_INVADER_CORE
            })[0];
            if (core) {
                if (cleaner.pos?.isNearTo(core.pos)) {
                    cleaner.dismantle(core as any);
                } else {
                    cleaner.travelTo(core.pos, 1);
                }
            }
            // Core gone — cleaner idles until it expires naturally
        }

        // T1.7 — Counter-creep micro: travel to target room and engage hostiles
        const counters = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "counter");
        for (const counter of counters) {
            if (!counter.isAlive()) continue;
            if (counter.room?.name !== this.targetRoom) {
                counter.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                continue;
            }
            const room = Game.rooms[this.targetRoom];
            const hostiles = room?.find(FIND_HOSTILE_CREEPS) ?? [];
            if (hostiles.length === 0) {
                // Room clear — idle at home until TTL
                if (fallbackPos) counter.travelTo(fallbackPos, 3);
                continue;
            }
            // Prioritize healers (they sustain the squad), then highest-threat
            const target = hostiles.sort((a, b) => {
                const aHeal = a.getActiveBodyparts(HEAL);
                const bHeal = b.getActiveBodyparts(HEAL);
                if (aHeal !== bHeal) return bHeal - aHeal;
                return b.getActiveBodyparts(ATTACK) + b.getActiveBodyparts(RANGED_ATTACK)
                    - (a.getActiveBodyparts(ATTACK) + a.getActiveBodyparts(RANGED_ATTACK));
            })[0];

            const hasRanged = (counter.creep?.getActiveBodyparts(RANGED_ATTACK) ?? 0) > 0;
            const hasAttack = (counter.creep?.getActiveBodyparts(ATTACK) ?? 0) > 0;
            const dist = counter.pos?.getRangeTo(target.pos) ?? 99;

            if (hasRanged && dist > 3) {
                counter.travelTo(target.pos, 3);
            } else if (hasRanged) {
                counter.rangedAttack(target);
                if (dist < 3) counter.travelTo(target.pos, 3); // maintain range
            } else if (hasAttack) {
                if (dist > 1) counter.travelTo(target.pos, 1);
                else counter.attack(target);
            }
        }

        for (const miner of this.miners) {
            if (!miner.isAlive() || miner.task) continue;

            if (isDangerous && fallbackPos) {
                miner.travelTo(fallbackPos, 3);
                continue;
            }

            const siteId = (miner.memory as any)?.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (miner.room?.name !== this.targetRoom) {
                miner.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                continue;
            }

            // ── FIX: Static In-Place Container Repair ──
            const container = site?.container;
            if (container && container.hits < container.hitsMax - 1000 && (miner.store?.energy ?? 0) > 0) {
                miner.setTask(new RepairTask(container.id));
            } else if (!miner.task && site?.source) {
                miner.setTask(new HarvestTask(site.source.id));
            }
        }

        for (const hauler of this.haulers) {
            if (!hauler.isAlive()) continue;

            if (isDangerous) {
                // Fix 2: Scavenger Idle — haulers hold at the room EXIT, not the colony core.
                // Flooding the base with retreating haulers gridlocks storage/spawn.
                // Haulers wait at the border and re-enter the moment danger clears.
                if (hauler.room?.name === this.targetRoom) {
                    // Still inside the dangerous room — exit toward home
                    hauler.travelTo(new RoomPosition(25, 25, this.colony.name), 20);
                } else if (hauler.room?.name === this.colony.name) {
                    // Back in the safe room — park at the room exit tile toward target
                    const exitDir = Game.map.findExit(this.colony.name, this.targetRoom) as ExitConstant;
                    const exits = hauler.room.find(exitDir);
                    const nearestExit = exits.sort((a, b) => hauler.pos!.getRangeTo(a) - hauler.pos!.getRangeTo(b))[0];
                    if (nearestExit && hauler.pos && hauler.pos.getRangeTo(nearestExit) > 3) {
                        hauler.travelTo(nearestExit, 3);
                    }
                    // Within 3 of exit — hold position and wait for danger to clear
                }
                continue;
            }

            if (hauler.store?.energy && hauler.store.energy > 0 && hauler.creep?.getActiveBodyparts(WORK)) {
                const road = hauler.pos?.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax);
                if (road) hauler.repair(road);
            }

            if (hauler.task) continue;

            const mem = hauler.memory as any;
            if (hauler.store?.getUsedCapacity() === 0) mem.collecting = true;
            if (hauler.store?.getFreeCapacity() === 0) mem.collecting = false;

            const siteId = mem.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (mem.collecting) {
                if (hauler.room?.name !== this.targetRoom) {
                    hauler.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                } else {
                    const room = Game.rooms[this.targetRoom];

                    // ── Priority 1: Tombstone reclamation ──────────────────────────────
                    // Invader tombstones decay quickly after a fight — scavenge them
                    // before touching the stable container. Sort descending by energy
                    // so the richest tombstone (usually the invader's) is targeted first.
                    const tombstones = room?.find(FIND_TOMBSTONES, {
                        filter: (t: Tombstone) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 50
                    }) ?? [];
                    const bestTomb = tombstones.sort((a, b) =>
                        b.store.getUsedCapacity(RESOURCE_ENERGY) - a.store.getUsedCapacity(RESOURCE_ENERGY)
                    )[0];
                    if (bestTomb) {
                        hauler.setTask(new WithdrawTask(bestTomb.id as Id<Tombstone>));
                    } else if (site?.containerId) {
                        // ── Priority 2: Container ────────────────────────────────────────
                        // Seed the outbound path so the hauler navigates to the container
                        // without calling PathFinder.search on global reset.
                        hauler.seedPath(site.cachedOutboundPath, site.containerPos, site.distance);
                        hauler.setTask(new WithdrawTask(site.containerId));
                    } else if (site?.source) {
                        // ── Priority 3: Dropped energy on the ground ────────────────────
                        const dropped = site.source.pos.findInRange(FIND_DROPPED_RESOURCES, 1).find(r => r.resourceType === RESOURCE_ENERGY && r.amount > 50);
                        if (dropped) hauler.setTask(new PickupTask(dropped.id as Id<Resource>));
                        else hauler.travelTo(site.source.pos, 3);
                    }
                }
            } else {
                // ── FIX: Integrate Returning Haulers with the Global Broker! ──
                if (hauler.room?.name === this.colony.name) {
                    const targetId = this.colony.logistics.matchTransfer(hauler as any);
                    if (targetId) {
                        hauler.setTask(new TransferTask(targetId as Id<Structure | Creep>));
                        continue;
                    }
                }

                const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
                if (dropoff) {
                    // Seed the return path so the hauler heads home without calling
                    // PathFinder.search on global reset. The cached path was computed
                    // by MiningSite.calculateDistance() and is shared across all haulers.
                    hauler.seedPath(site?.cachedReturnPath ?? null, dropoff.pos, site?.distance ?? 0);
                    hauler.setTask(new TransferTask(dropoff.id as Id<Structure | Creep>));
                }
            }
        }
    }
}
