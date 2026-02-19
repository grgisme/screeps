
import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { CombatZerg } from "../zerg/CombatZerg";
import { TrafficManager } from "../infrastructure/TrafficManager";
import { Logger } from "../../utils/Logger";

const log = new Logger("DestroyerOverlord");

export class DestroyerOverlord extends Overlord {
    destroyers: CombatZerg[] = [];
    targetRoom: string;

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `destroyer_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    // ── Dynamic Body Scaling ─────────────────────────────────────────────

    private getDestroyerBody(capacity: number): BodyPartConstant[] {
        if (capacity < 400) return [ATTACK, MOVE]; // 130 energy
        if (capacity < 800) return [ATTACK, MOVE, ATTACK, MOVE]; // 260 energy
        if (capacity < 1300) return [TOUGH, MOVE, ATTACK, ATTACK, MOVE, MOVE, HEAL, MOVE]; // 620 energy

        // RCL 4+ - The 1000 energy bruiser
        return [
            TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE,
            ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE,
            HEAL, MOVE
        ];
    }

    init(): void {
        // Heap-safe destroyer resolution — no wrapper thrashing
        this.destroyers = this.zergs.filter(
            z => z.isAlive() && (z.memory as any)?.role === "destroyer"
        ) as CombatZerg[];

        // Spawn 1 Destroyer
        if (this.destroyers.length < 1) {
            const room = this.colony.room;
            if (!room) return;

            this.colony.hatchery.enqueue({
                priority: 80,
                bodyTemplate: this.getDestroyerBody(room.energyCapacityAvailable),
                overlord: this,
                name: `destroyer_${this.targetRoom}_${Game.time}`,
                memory: { role: "destroyer" }
            });
        }
    }

    run(): void {
        for (const destroyer of this.destroyers) {
            if (!destroyer.isAlive() || !destroyer.pos) continue;
            const creep = destroyer.creep!;

            // ────────────────────────────────────────────────────────
            // 1. Retreat Logic — fall back to home when critically hurt
            // ────────────────────────────────────────────────────────
            if (creep.hits < creep.hitsMax * 0.5) {
                const home = Game.rooms[this.colony.name];
                if (home) {
                    const rallyPoint = home.storage?.pos || home.find(FIND_MY_SPAWNS)[0]?.pos;
                    if (rallyPoint) destroyer.travelTo(rallyPoint, 5);
                }
                // Pre-heal self while retreating
                if (creep.getActiveBodyparts(HEAL) > 0) destroyer.heal(creep);
                continue;
            }

            // ────────────────────────────────────────────────────────
            // 2. Travel to Target Room
            // ────────────────────────────────────────────────────────
            if (creep.room.name !== this.targetRoom) {
                destroyer.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                // Pre-heal self in transit
                if (creep.getActiveBodyparts(HEAL) > 0) destroyer.heal(creep);
                continue;
            }

            // ────────────────────────────────────────────────────────
            // 3. In Target Room — Direct Micro (IoC)
            // ────────────────────────────────────────────────────────
            const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
            const structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
                filter: (s: AnyOwnedStructure) =>
                    s.structureType === STRUCTURE_INVADER_CORE ||
                    s.structureType === STRUCTURE_TOWER
            });
            const targets: (Creep | Structure)[] = [...hostiles, ...structures];

            let meleeEngaged = false;
            let rangedEngaged = false;

            // 3a. Combat
            if (targets.length > 0) {
                const target = destroyer.pos.findClosestByRange(targets);
                if (target) {
                    const range = destroyer.pos.getRangeTo(target);

                    if (creep.getActiveBodyparts(RANGED_ATTACK) > 0 && range <= 3) {
                        if (range <= 1) destroyer.rangedMassAttack();
                        else destroyer.rangedAttack(target);
                        rangedEngaged = true;
                    }

                    if (creep.getActiveBodyparts(ATTACK) > 0 && range <= 1) {
                        destroyer.attack(target);
                        meleeEngaged = true;
                    }

                    // 3b. Movement (Kite or Charge)
                    const isRanged = creep.getActiveBodyparts(RANGED_ATTACK) > creep.getActiveBodyparts(ATTACK);
                    if (isRanged && range < 3) {
                        const path = PathFinder.search(
                            destroyer.pos,
                            { pos: target.pos, range: 4 },
                            { flee: true, roomCallback: () => new PathFinder.CostMatrix() }
                        );
                        if (path.path.length > 0) {
                            TrafficManager.register(destroyer, destroyer.pos.getDirectionTo(path.path[0])!, 1);
                        }
                    } else if (range > (isRanged ? 3 : 1)) {
                        destroyer.travelTo(target.pos);
                    }
                }
            } else {
                // Room clear — idle / patrol
                log.info("Target room clear.");
            }

            // 3c. Pre-Healing (Post-Combat intent registration)
            if (creep.getActiveBodyparts(HEAL) > 0) {
                const wounded = destroyer.pos.findInRange(FIND_MY_CREEPS, 3, {
                    filter: (c: Creep) => c.hits < c.hitsMax
                });

                // Pre-heal self if no one is hurt, otherwise heal lowest HP ally
                const healTarget = wounded.length > 0 ? wounded.sort((a, b) => a.hits - b.hits)[0] : creep;

                if (destroyer.pos.isNearTo(healTarget) && !meleeEngaged) {
                    destroyer.heal(healTarget);
                } else if (!rangedEngaged && destroyer.pos.getRangeTo(healTarget) <= 3) {
                    destroyer.rangedHeal(healTarget);
                } else if (!meleeEngaged) {
                    destroyer.heal(creep); // Fallback: always pre-heal self
                }
            }
        }
    }
}
