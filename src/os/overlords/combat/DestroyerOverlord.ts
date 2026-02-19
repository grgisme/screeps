
import { Overlord } from "../Overlord";
import type { Colony } from "../../colony/Colony";
import { CombatZerg } from "../../zerg/CombatZerg";
import { TrafficManager } from "../../infrastructure/TrafficManager";
import { Logger } from "../../../utils/Logger";

const log = new Logger("DestroyerOverlord");

export class DestroyerOverlord extends Overlord {
    destroyers: CombatZerg[] = [];
    targetRoom: string;

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `destroyer_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        // Heap-safe destroyer resolution — no wrapper thrashing
        this.destroyers = this.zergs.filter(
            z => z.isAlive() && (z.memory as any)?.role === "destroyer"
        ) as CombatZerg[];

        // Spawn 1 Destroyer
        if (this.destroyers.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 80,
                bodyTemplate: [
                    TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE,
                    ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE,
                    HEAL, MOVE
                ],
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
                if (home && home.storage) {
                    destroyer.travelTo(home.storage, 5);
                }
                // Self-heal while retreating (uses work pipeline)
                if (creep.getActiveBodyparts(HEAL) > 0) {
                    destroyer.heal(creep);
                }
                continue;
            }

            // ────────────────────────────────────────────────────────
            // 2. Travel to Target Room
            // ────────────────────────────────────────────────────────
            if (creep.room.name !== this.targetRoom) {
                destroyer.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                // Self-heal in transit
                if (creep.getActiveBodyparts(HEAL) > 0 && creep.hits < creep.hitsMax) {
                    destroyer.heal(creep);
                }
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

            // 3c. Healing (Post-Combat)
            if (creep.getActiveBodyparts(HEAL) > 0) {
                if (creep.hits < creep.hitsMax) {
                    if (!meleeEngaged) destroyer.heal(creep);
                } else {
                    const wounded = destroyer.pos.findInRange(FIND_MY_CREEPS, 3, {
                        filter: (c: Creep) => c.hits < c.hitsMax
                    });
                    if (wounded.length > 0) {
                        const healTarget = wounded.sort((a, b) => a.hits - b.hits)[0];
                        if (destroyer.pos.isNearTo(healTarget) && !meleeEngaged) destroyer.heal(healTarget);
                        else if (!rangedEngaged) destroyer.rangedHeal(healTarget);
                    }
                }
            }
        }
    }
}
