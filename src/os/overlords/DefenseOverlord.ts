import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { CombatZerg } from "../zerg/CombatZerg";
import { TrafficManager } from "../infrastructure/TrafficManager";
import { Logger } from "../../utils/Logger";

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
     * Calculate damage reduction from TOUGH parts.
     * XGHO2 = 70% reduction (0.3 multiplier).
     */
    private calculateEnemyToughMultiplier(hostile: Creep): number {
        const toughParts = hostile.body.filter(p => p.type === TOUGH && p.hits > 0);
        if (toughParts.length === 0) return 1.0;

        if (toughParts.some(p => p.boost === 'XGHO2')) return 0.3;
        if (toughParts.some(p => p.boost === 'GHO2')) return 0.5;
        if (toughParts.some(p => p.boost === 'GO')) return 0.7;
        return 1.0;
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

    // ── Dynamic Body Scaling ─────────────────────────────────────────────

    private getDefenderBody(capacity: number): BodyPartConstant[] {
        if (capacity < 400) return [RANGED_ATTACK, MOVE]; // RCL 1 (200 energy)
        if (capacity < 800) return [RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE]; // RCL 2 (400 energy)
        if (capacity < 1300) return [RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, HEAL, MOVE]; // RCL 3 (700 energy)

        // RCL 4+ (1300+ energy) - The 1040 energy bruiser
        return [
            TOUGH, TOUGH, MOVE, MOVE,
            RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE,
            HEAL, MOVE
        ];
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
                const capacity = room.energyCapacityAvailable;
                this.colony.hatchery.enqueue({
                    priority: 100,
                    bodyTemplate: this.getDefenderBody(capacity),
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
            // 1. Safe Mode Fail-Safe (Pathfinding Threat Detection)
            // ────────────────────────────────────────────────────────────
            const spawns = room.find(FIND_MY_SPAWNS);
            const dangerousHostiles = hostiles.filter(h =>
                h.owner.username !== "Invader" &&
                (h.getActiveBodyparts(ATTACK) > 0 ||
                    h.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                    h.getActiveBodyparts(WORK) > 0)
            );

            let pathBreached = false;
            if (spawns.length > 0 && dangerousHostiles.length > 0) {
                // Check if there is an open path to the spawn (Ramparts breached)
                const cm = new PathFinder.CostMatrix();
                room.find(FIND_STRUCTURES).forEach(s => {
                    if (s.structureType === STRUCTURE_RAMPART && (s as OwnedStructure).my) cm.set(s.pos.x, s.pos.y, 255);
                    if (s.structureType === STRUCTURE_WALL) cm.set(s.pos.x, s.pos.y, 255);
                });

                const path = PathFinder.search(spawns[0].pos, dangerousHostiles.map(h => ({ pos: h.pos, range: 1 })), {
                    maxOps: 2000,
                    roomCallback: () => cm
                });

                if (!path.incomplete) pathBreached = true;
            }

            if (pathBreached && room.controller && room.controller.safeModeAvailable > 0 && !room.controller.safeMode && !room.controller.safeModeCooldown) {
                room.controller.activateSafeMode();
                log.error(`CRITICAL BREACH! Safe mode activated in ${room.name} due to Pathfinding Threat!`);
            }

            // ────────────────────────────────────────────────────────────
            // 2. Synchronized Tower Network (Target Sweeping & TOUGH Math)
            // ────────────────────────────────────────────────────────────
            if (towers.length > 0) {
                let fired = false;

                // Iterate ALL hostiles and apply TOUGH Math
                for (const target of hostiles) {
                    const rawDpt = towers.reduce((sum, t) => sum + this.calculateTowerDamage(t, target.pos), 0);
                    const toughMult = this.calculateEnemyToughMultiplier(target);
                    const effectiveDpt = rawDpt * toughMult;
                    const totalHpt = this.calculateEnemyHeal(target);

                    if (effectiveDpt > totalHpt * 1.1 || target.owner.username === "Invader") {
                        towers.forEach(t => t.attack(target));
                        fired = true;
                        break; // Found a killable target! Focus fire.
                    }
                }

                if (!fired) {
                    log.warning(`HOLD FIRE in ${room.name}: Enemies out-healing effective DPT.`);
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

            let meleeEngaged = false;
            let rangedEngaged = false;

            // 4a. Target Identification & Combat
            const target = hostiles.length > 0 ? defender.pos.findClosestByRange(hostiles) : null;

            if (target) {
                const range = defender.pos.getRangeTo(target);

                // Ranged Pipeline
                if (creep.getActiveBodyparts(RANGED_ATTACK) > 0 && range <= 3) {
                    if (range <= 1) defender.rangedMassAttack();
                    else defender.rangedAttack(target);
                    rangedEngaged = true;
                }

                // Work Pipeline (Notice: separate IF, not ELSE IF)
                if (creep.getActiveBodyparts(ATTACK) > 0 && range <= 1) {
                    defender.attack(target);
                    meleeEngaged = true;
                }

                // Movement
                const isRanged = creep.getActiveBodyparts(RANGED_ATTACK) > creep.getActiveBodyparts(ATTACK);
                if (isRanged && range < 3) {
                    const path = PathFinder.search(
                        defender.pos,
                        { pos: target.pos, range: 4 },
                        { flee: true, roomCallback: () => new PathFinder.CostMatrix() }
                    );
                    if (path.path.length > 0) TrafficManager.register(defender, defender.pos.getDirectionTo(path.path[0])!, 1);
                } else if (range > (isRanged ? 3 : 1)) {
                    defender.travelTo(target.pos);
                }
            } else {
                // Idle: rally near storage or spawn
                const rallyPoint = room.storage?.pos || room.find(FIND_MY_SPAWNS)[0]?.pos;
                if (rallyPoint) defender.travelTo(rallyPoint, 3);
            }

            // 4b. Pre-Healing (Execute regardless of current hits to negate burst damage)
            if (creep.getActiveBodyparts(HEAL) > 0) {
                const wounded = defender.pos.findInRange(FIND_MY_CREEPS, 3, { filter: (c: Creep) => c.hits < c.hitsMax });

                // Unconditional Pre-Heal: prioritize most damaged ally, otherwise pre-heal self
                const healTarget = wounded.length > 0 ? wounded.sort((a, b) => a.hits - b.hits)[0] : creep;

                if (defender.pos.isNearTo(healTarget) && !meleeEngaged) {
                    defender.heal(healTarget);
                } else if (!rangedEngaged && defender.pos.getRangeTo(healTarget) <= 3) {
                    defender.rangedHeal(healTarget);
                } else if (!meleeEngaged) {
                    defender.heal(creep); // Fallback: always pre-heal self
                }
            }
        }
    }
}
