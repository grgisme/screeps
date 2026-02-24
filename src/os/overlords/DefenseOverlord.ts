import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { CombatZerg } from "../zerg/CombatZerg";
import { TrafficManager } from "../infrastructure/TrafficManager";
import { MovePriority } from "../infrastructure/MovePriority";
import { Logger, LogLevel } from "../../utils/Logger";

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

    /**
     * Role priority for tower targeting:
     *   0 = Healer  (must die first — negates all tower DPS if alive)
     *   1 = Ranged  (next threat after healers)
     *   2 = Melee   (lowest priority)
     * Sorted ascending so lower-numbered roles are targeted first.
     */
    private getHostilePriority(hostile: Creep): number {
        if (hostile.body.some(p => p.type === HEAL && p.hits > 0)) return 0;
        if (hostile.body.some(p => p.type === RANGED_ATTACK && p.hits > 0)) return 1;
        return 2;
    }

    // ── Dynamic Body Scaling ─────────────────────────────────────────────

    /**
     * Classify the current hostile force.
     * Priority: healer > ranged > dismantler > melee > unknown.
     * "healer" takes top priority because alive healers negate all tower DPS.
     */
    private getThreatProfile(hostiles: Creep[]): 'healer' | 'ranged' | 'dismantler' | 'melee' | 'unknown' {
        if (hostiles.length === 0) return 'unknown';
        const hasHealer = hostiles.some(h => h.body.some(p => p.type === HEAL && p.hits > 0));
        const hasRanged = hostiles.some(h => h.body.some(p => p.type === RANGED_ATTACK && p.hits > 0));
        const hasDismantler = hostiles.some(h => h.body.some(p => p.type === WORK && p.hits > 0));
        const hasMelee = hostiles.some(h => h.body.some(p => p.type === ATTACK && p.hits > 0));
        if (hasHealer) return 'healer';
        if (hasRanged) return 'ranged';
        if (hasDismantler) return 'dismantler';
        if (hasMelee) return 'melee';
        return 'unknown';
    }

    /**
     * Choose a counter-body based on what is actually attacking.
     *
     * Threat → Body strategy:
     *   healer     → high ATTACK count; raw melee DPS overwhelms regen
     *   melee      → pure ranged kiter; stay at range 3, never get hit
     *   dismantler → ranged kiter; WORK parts target structures, not us
     *   ranged     → TOUGH + self-HEAL + RANGED_ATTACK to trade efficiently
     *   unknown    → generic RANGED + HEAL (safe default / pre-spawn)
     */
    private getDefenderBody(capacity: number, hostiles: Creep[] = []): BodyPartConstant[] {
        // Low-RCL rooms: no energy for differentiated bodies
        if (capacity < 400) return [RANGED_ATTACK, MOVE];
        if (capacity < 800) return [RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE];

        const threat = this.getThreatProfile(hostiles);
        log.info(`Threat profile: ${threat} (hostiles=${hostiles.length}, capacity=${capacity})`);

        // ── RCL 3 tier (800–1299 energy) ────────────────────────────────
        if (capacity < 1300) {
            switch (threat) {
                case 'healer':
                    // Max raw melee DPS at this tier — 3 ATTACK + HEAL = 690 energy
                    return [ATTACK, ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE, MOVE];
                case 'melee':
                case 'dismantler':
                    // Ranged kiter — 2 RANGED + HEAL = 700 energy
                    return [RANGED_ATTACK, RANGED_ATTACK, HEAL, MOVE, MOVE, MOVE];
                case 'ranged':
                default:
                    // Generic: RANGED + HEAL (same as old body)
                    return [RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, HEAL, MOVE];
            }
        }

        // ── RCL 4+ tier (1300+ energy) ──────────────────────────────────
        switch (threat) {
            case 'healer':
                // Brawler: 4 ATTACK + 2 HEAL + TOUGH absorb = 1140 energy
                // Movement: closes to melee (ATTACK > RANGED_ATTACK → isRanged=false in run())
                return [
                    TOUGH, TOUGH, MOVE, MOVE,
                    ATTACK, ATTACK, ATTACK, ATTACK,
                    HEAL, HEAL,
                    MOVE, MOVE, MOVE, MOVE
                ];
            case 'melee':
            case 'dismantler':
                // Ranged kiter: 4 RANGED_ATTACK + HEAL — stays at range 3 (isRanged=true)
                return [
                    TOUGH, TOUGH, MOVE, MOVE,
                    RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
                    HEAL,
                    MOVE, MOVE, MOVE
                ];
            case 'ranged':
            default:
                // Existing bruiser — balanced TOUGH+RANGED+HEAL
                return [
                    TOUGH, TOUGH, MOVE, MOVE,
                    RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE,
                    HEAL, MOVE
                ];
        }
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

            // Spawn defenders — cap rises from 2 → 4 when in sustained HOLD FIRE
            // (healer-protected squad that towers can't kill — need more melees to engage)
            const holdFireSince = (Memory.rooms[room.name] as any).holdFireSince as number | undefined;
            const holdFireTicks = holdFireSince !== undefined ? Game.time - holdFireSince : 0;
            const defenderCap = holdFireTicks >= 5 ? 4 : 2;

            if (this.defenders.length < defenderCap) {
                const capacity = room.energyCapacityAvailable;
                // Pass live hostiles so body selection counters the actual threat
                this.colony.hatchery.enqueue({
                    priority: 100,
                    bodyTemplate: this.getDefenderBody(capacity, hostiles),
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

        // ── Predictive Pre-Spawn (Invader Wave Anticipation) ─────────────────
        // NPC Invaders spawn approximately every 100,000 energy harvested.
        // At 90k into a wave we are 10k ticks away from the trigger (at 10 e/t)
        // — enough time to spawn and position a defender before they arrive.
        //
        // Wave index = floor(lifetime / 100k).
        // We pre-spawn once per wave: when the in-wave position >= 90k AND we
        // haven't already pre-spawned for this wave (lastPreDefenseWave < wave).
        const WAVE_SIZE = 100_000;
        const PREWARN_AT = 90_000; // start of the 10k-tick alert window
        const lifetime = this.colony.memory.energyHarvestedLifetime ?? 0;
        const wave = Math.floor(lifetime / WAVE_SIZE);
        const intoWave = lifetime % WAVE_SIZE;
        const lastPreWave = this.colony.memory.lastPreDefenseWave ?? -1;
        const hostilesFree = (room.find(FIND_HOSTILE_CREEPS).length === 0);

        if (intoWave >= PREWARN_AT && wave > lastPreWave && hostilesFree) {
            this.colony.memory.lastPreDefenseWave = wave;

            const capacity = room.energyCapacityAvailable;
            const alreadyGot = this.defenders.length >= 1;
            if (!alreadyGot) {
                log.alert(`pre-defense-${room.name}`,
                    `Wave ${wave + 1} approaching (${lifetime.toLocaleString()} mined). Pre-spawning defender.`,
                    LogLevel.WARNING);
                // No hostiles present yet (hostilesFree=true) — spawn generic body
                this.colony.hatchery.enqueue({
                    priority: 95, // Below active invader response (100), above normal economy
                    bodyTemplate: this.getDefenderBody(capacity), // hostiles=[] → 'unknown' → generic
                    overlord: this,
                    name: `predefender_w${wave}_${Game.time}`,
                    memory: { role: "defender" }
                });
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
            // 1. Preemptive Safe Mode (Protocol Layer 1: Blackout Guard)
            // ────────────────────────────────────────────────────────────
            // During a critical blackout, any attack-capable hostile can kill
            // the lone bootstrapper before it spawns, resetting the 20k-tick
            // passive regen timer. Don't wait for a wall breach — act now.
            if (this.colony.state.isCriticalBlackout) {
                const threats = hostiles.filter(h =>
                    h.getActiveBodyparts(ATTACK) > 0 ||
                    h.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                    h.getActiveBodyparts(WORK) > 0
                );
                const ctrl = room.controller;
                if (threats.length > 0 && ctrl &&
                    ctrl.safeModeAvailable > 0 &&
                    !ctrl.safeMode &&
                    !ctrl.safeModeCooldown) {
                    ctrl.activateSafeMode();
                    log.error(`BLACKOUT + THREAT: Preemptive safe mode activated in ${room.name}!`);
                }
            }

            // ────────────────────────────────────────────────────────────
            // 2. Safe Mode Fail-Safe (Pathfinding Threat Detection)
            // ────────────────────────────────────────────────────────────
            const spawns = room.find(FIND_MY_SPAWNS);

            // T1.1 — Split threat classes so NPC invaders with ATTACK/WORK
            // are also included in the breach check (previously excluded).
            // Pure-ranged NPC invaders stay excluded — towers can handle them
            // and they never breach walls.
            const playerThreat = hostiles.filter(h =>
                h.owner.username !== "Invader" && h.owner.username !== "Source Keeper" &&
                (h.getActiveBodyparts(ATTACK) > 0 ||
                    h.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                    h.getActiveBodyparts(WORK) > 0)
            );
            const npcThreat = hostiles.filter(h =>
                h.owner.username === "Invader" &&
                (h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(WORK) > 0)
            );
            const dangerousHostiles = [...playerThreat, ...npcThreat];

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

            const ctrl = room.controller;

            // T1.3 — Last-charge conservation: don't burn the only safe mode
            // charge on an NPC wave that towers can still handle.
            const shouldUseSafeMode = (reason: 'breach' | 'hp_threshold'): boolean => {
                if (!ctrl || ctrl.safeModeAvailable === 0 || ctrl.safeMode || ctrl.safeModeCooldown) return false;
                if (ctrl.safeModeAvailable === 1 && reason === 'breach') {
                    const allNpc = dangerousHostiles.every(h =>
                        h.owner.username === "Invader" || h.owner.username === "Source Keeper"
                    );
                    if (allNpc && this.towerIds.length > 0) {
                        log.warning(`Conserving last safe mode charge — NPC wave with towers still active.`);
                        return false;
                    }
                }
                return true;
            };

            if (pathBreached && shouldUseSafeMode('breach')) {
                ctrl!.activateSafeMode();
                log.error(`CRITICAL BREACH! Safe mode activated in ${room.name} due to Pathfinding Threat!`);
            }

            // T1.2 — Critical structure HP% trigger: ranged attackers outside
            // ramparts can kill storage/terminal without ever breaching walls.
            // Fire if any critical structure drops below 30% HP.
            if (!pathBreached && dangerousHostiles.length > 0 && shouldUseSafeMode('hp_threshold')) {
                const CRITICAL_TYPES: StructureConstant[] = [
                    STRUCTURE_SPAWN, STRUCTURE_STORAGE, STRUCTURE_TERMINAL, STRUCTURE_TOWER
                ];
                const damaged = room.find(FIND_MY_STRUCTURES).find(s =>
                    CRITICAL_TYPES.includes(s.structureType) &&
                    s.hits / s.hitsMax < 0.30
                );
                if (damaged) {
                    ctrl!.activateSafeMode();
                    log.error(`CRITICAL STRUCTURE: ${damaged.structureType} at ${Math.round(damaged.hits / damaged.hitsMax * 100)}% HP! Safe mode activated in ${room.name}.`);
                }
            }

            // ────────────────────────────────────────────────────────────
            // 2. Synchronized Tower Network (Target Sweeping & TOUGH Math)
            // ────────────────────────────────────────────────────────────
            if (towers.length > 0) {
                let fired = false;

                // Sort by role priority (healer → ranged → melee) before killability check.
                // Without sorting a killable melee near the spawn would be targeted while
                // a distant healer keeps the whole squad alive tick after tick.
                const sortedHostiles = [...hostiles].sort(
                    (a, b) => this.getHostilePriority(a) - this.getHostilePriority(b)
                );

                for (const target of sortedHostiles) {
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
                    // HOLD FIRE: enemies out-heal our effective DPS.
                    // Track how long we've been unable to kill anything — after 5 ticks
                    // the surge cap in init() kicks in and requests extra defenders.
                    if (!(Memory.rooms[room.name] as any).holdFireSince) {
                        (Memory.rooms[room.name] as any).holdFireSince = Game.time;
                        log.warning(`HOLD FIRE in ${room.name}: Enemies out-healing effective DPT. Escalation clock started.`);
                    }
                } else {
                    // Successful kill — clear the escalation clock
                    delete (Memory.rooms[room.name] as any).holdFireSince;
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
                    if (path.path.length > 0) TrafficManager.register(defender, defender.pos.getDirectionTo(path.path[0])!, MovePriority.COMBAT);
                } else if (range > (isRanged ? 3 : 1)) {
                    defender.travelTo(target.pos, 1, MovePriority.COMBAT);
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
