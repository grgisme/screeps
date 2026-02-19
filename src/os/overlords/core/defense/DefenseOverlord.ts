import { Overlord } from "../../Overlord";
import type { Colony } from "../../../colony/Colony";
import { CombatZerg } from "../../../zerg/CombatZerg";
import { TrafficManager } from "../../../infrastructure/TrafficManager";
import { Logger } from "../../../../utils/Logger";

const log = new Logger("DefenseOverlord");

export class DefenseOverlord extends Overlord {
    // ── Heap-safe tower references (store IDs, resolve live objects via getter) ──
    towerIds: Id<StructureTower>[] = [];
    defenders: CombatZerg[] = [];

    constructor(colony: Colony) {
        super(colony, "defense");
    }

    /** Resolve live tower objects each tick from cached IDs. */
    get towers(): StructureTower[] {
        return this.towerIds
            .map(id => Game.getObjectById(id))
            .filter(t => t !== null) as StructureTower[];
    }

    // ── Quantitative Tower Math ─────────────────────────────────────────

    /**
     * Calculate an enemy creep's total heal-per-tick, accounting for lab boosts.
     *
     * Base HEAL power = 12 HP/tick.
     * Boost multipliers: LO → ×2, LHO2 → ×3, XLHO2 → ×4.
     */
    private calculateEnemyHeal(hostile: Creep): number {
        let heal = 0;
        for (const part of hostile.body) {
            if (part.type === HEAL && part.hits > 0) {
                if (part.boost === 'XLHO2') heal += 48;
                else if (part.boost === 'LHO2') heal += 36;
                else if (part.boost === 'LO') heal += 24;
                else heal += 12;
            }
        }
        return heal;
    }

    /**
     * Calculate tower damage at a given range.
     *
     * Tower damage formula (from Screeps engine):
     *   Range ≤ 5:  600 (full)
     *   Range ≥ 20: 150 (minimum)
     *   Otherwise:  600 − (range − 5) × 30
     *
     * Linear falloff: 30 DPT per tile from range 5 to 20.
     */
    private calculateTowerDamage(tower: StructureTower, target: RoomPosition): number {
        const range = tower.pos.getRangeTo(target);
        if (range <= 5) return 600;
        if (range >= 20) return 150;
        return 600 - (range - 5) * 30;
    }

    // ── Init ────────────────────────────────────────────────────────────

    init(): void {
        // Heap-safe defender resolution — no wrapper thrashing
        this.defenders = this.zergs.filter(
            z => z.isAlive() && (z.memory as any)?.role === "defender"
        ) as CombatZerg[];

        const room = this.colony.room;
        if (!room) return;

        // Refresh tower IDs periodically (towers rarely change)
        if (Game.time % 50 === 0 || this.towerIds.length === 0) {
            this.towerIds = (room.find(FIND_MY_STRUCTURES, {
                filter: (s: AnyOwnedStructure) => s.structureType === STRUCTURE_TOWER
            }) as StructureTower[]).map(t => t.id);
        }

        // Ensure Memory.rooms structure exists
        if (!Memory.rooms) Memory.rooms = {};
        if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;

        // Detect Hostiles & Spawn Logic
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            if (!Memory.rooms[room.name].isDangerous) {
                log.alert(`defense-${room.name}`, `Hostiles detected in ${room.name}! Activating Defense Protocols.`);
                Memory.rooms[room.name].isDangerous = true;
            }
            Memory.rooms[room.name].dangerUntil = Game.time + 100;

            // Spawn defenders (cap at 2)
            if (this.defenders.length < 2) {
                this.colony.hatchery.enqueue({
                    priority: 100,
                    bodyTemplate: [
                        TOUGH, TOUGH, MOVE, MOVE,
                        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE,
                        HEAL, MOVE
                    ],
                    overlord: this,
                    name: `defender_${Game.time}`,
                    memory: { role: "defender" }
                });
            }
        } else {
            if (Memory.rooms[room.name].isDangerous && Game.time > (Memory.rooms[room.name].dangerUntil || 0)) {
                delete Memory.rooms[room.name].isDangerous;
                delete Memory.rooms[room.name].dangerUntil;
                log.info(`Room ${room.name} is safe.`);
            }
        }
    }

    // ── Run ─────────────────────────────────────────────────────────────

    run(): void {
        const room = this.colony.room;
        if (!room) return;

        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        const towers = this.towers;

        if (hostiles.length > 0) {
            // ────────────────────────────────────────────────────────────
            // 1. Safe Mode Fail-Safe
            // ────────────────────────────────────────────────────────────
            const spawns = room.find(FIND_MY_SPAWNS);
            const breached = hostiles.some(h => spawns.some(s => h.pos.getRangeTo(s) <= 3));
            if (breached && room.controller && room.controller.safeModeAvailable > 0 && !room.controller.safeMode && !room.controller.safeModeCooldown) {
                room.controller.activateSafeMode();
                log.alert(`safemode-${room.name}`, `CRITICAL BREACH! Safe mode activated in ${room.name}`);
            }

            // ────────────────────────────────────────────────────────────
            // 2. Synchronized Tower Network (Anti-Drainer)
            // ────────────────────────────────────────────────────────────
            if (towers.length > 0) {
                const target = towers[0].pos.findClosestByRange(hostiles);
                if (target) {
                    const totalDpt = towers.reduce((sum, t) => sum + this.calculateTowerDamage(t, target.pos), 0);
                    const totalHpt = this.calculateEnemyHeal(target);

                    if (totalDpt > totalHpt * 1.1 || target.owner.username === "Invader") {
                        towers.forEach(t => t.attack(target));
                    } else {
                        log.warning(`HOLD FIRE in ${room.name}: Enemy HPT (${totalHpt}) exceeds Tower DPT (${totalDpt}).`);
                    }
                }
            }
        } else if (towers.length > 0) {
            // ────────────────────────────────────────────────────────────
            // 3. Peacetime Repairs (low-HP ramparts)
            // ────────────────────────────────────────────────────────────
            const ramparts = room.find(FIND_MY_STRUCTURES, {
                filter: (s: AnyOwnedStructure) => s.structureType === STRUCTURE_RAMPART && s.hits < 10000
            });
            if (ramparts.length > 0) {
                const target = ramparts.sort((a, b) => a.hits - b.hits)[0];
                for (const tower of towers) {
                    if (tower.store.energy > 500) tower.repair(target);
                }
            }
        }

        // ────────────────────────────────────────────────────────────────
        // 4. Direct Defender Micro (IoC — Overlord owns the brain)
        // ────────────────────────────────────────────────────────────────
        for (const defender of this.defenders) {
            if (!defender.isAlive() || !defender.pos) continue;
            const creep = defender.creep!;

            // 4a. Pre-heal (simultaneous with ranged attacks)
            if (creep.hits < creep.hitsMax && creep.getActiveBodyparts(HEAL) > 0) {
                defender.heal(creep);
            } else {
                const wounded = defender.pos.findInRange(FIND_MY_CREEPS, 3, {
                    filter: (c: Creep) => c.hits < c.hitsMax
                });
                if (wounded.length > 0) {
                    const healTarget = wounded.sort((a, b) => a.hits - b.hits)[0];
                    if (defender.pos.isNearTo(healTarget)) defender.heal(healTarget);
                    else defender.rangedHeal(healTarget);
                }
            }

            // 4b. Combat
            if (hostiles.length > 0) {
                const target = defender.pos.findClosestByRange(hostiles);
                if (target) {
                    const range = defender.pos.getRangeTo(target);
                    if (creep.getActiveBodyparts(RANGED_ATTACK) > 0 && range <= 3) {
                        if (range <= 1) defender.rangedMassAttack();
                        else defender.rangedAttack(target);
                    } else if (creep.getActiveBodyparts(ATTACK) > 0 && range <= 1) {
                        defender.attack(target);
                    }

                    // 4c. Movement (Kite or Charge)
                    const isRanged = creep.getActiveBodyparts(RANGED_ATTACK) > creep.getActiveBodyparts(ATTACK);
                    if (isRanged && range < 3) {
                        const path = PathFinder.search(
                            defender.pos,
                            { pos: target.pos, range: 4 },
                            { flee: true, roomCallback: () => new PathFinder.CostMatrix() }
                        );
                        if (path.path.length > 0) {
                            TrafficManager.register(defender, defender.pos.getDirectionTo(path.path[0])!, 1);
                        }
                    } else if (range > (isRanged ? 3 : 1)) {
                        defender.travelTo(target.pos);
                    }
                }
            } else {
                // Idle: rally near storage
                if (room.storage) defender.travelTo(room.storage.pos, 3);
            }
        }
    }
}
