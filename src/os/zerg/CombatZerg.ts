
import { Zerg } from "./Zerg";

/**
 * CombatZerg is a specialized Zerg for military units.
 * It implements an "Action Pipeline" to execute multiple compatible actions in a single tick.
 */
export class CombatZerg extends Zerg {

    constructor(creepName: string) {
        super(creepName);
    }

    /**
     * The main combat loop for a single tick.
     * Logic:
     * 1. Pre-heal (Self or Squad) -> Free action if using Ranged Attack, or simultaneous with Melee.
     * 2. Attack (Melee or Ranged)
     * 3. Move (Kite or Chase)
     */
    autoEngage(targets: (Creep | Structure)[]): void {
        if (targets.length === 0 || !this.isAlive()) return;
        const target = this.pos!.findClosestByRange(targets);
        if (!target || !("id" in target)) return; // Ensure it's not a RoomPosition or null

        // 1. Heal Logic (Pre-healing)
        // If we have HEAL parts, use them.
        // Priority: Critical Health Myself > Critical Health Friend > Myself > Friend
        if (this.creep!.getActiveBodyparts(HEAL) > 0) {
            this.handleHealing();
        }

        // 2. Combat Logic
        const range = this.pos!.getRangeTo(target);

        // Ranged Attack (Mass Attack or Single)
        if (this.creep!.getActiveBodyparts(RANGED_ATTACK) > 0) {
            if (range <= 3) {
                // simple logic: if multiple enemies in range 3, mass attack?
                // For now, simple ranged attack
                if (range <= 1) {
                    // If close, mass attack is usually efficient if surrounded, but rangedAttack is safer single target dps.
                    // Let's stick to rangedAttack for focused fire unless explicitly surrounded.
                    this.creep!.rangedAttack(target as Creep | Structure);
                } else {
                    this.creep!.rangedAttack(target as Creep | Structure);
                }
            }
        }

        // Melee Attack
        if (this.creep!.getActiveBodyparts(ATTACK) > 0) {
            if (range <= 1) {
                this.creep!.attack(target as Creep | Structure);
            }
        }

        // 3. Movement Logic (Kiting)
        this.kite(target as RoomPosition | { pos: RoomPosition });
    }

    /**
     * Handle healing logic.
     * Heals self or nearby damaged allies.
     */
    private handleHealing(): void {
        const creep = this.creep;
        if (!creep) return;
        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
        } else {
            // Heal nearby wounded friends?
            const wounded = this.pos!.findInRange(FIND_MY_CREEPS, 3, {
                filter: (c) => c.hits < c.hitsMax
            });
            if (wounded.length > 0) {
                const target = wounded.sort((a, b) => a.hits - b.hits)[0];
                if (this.pos!.isNearTo(target)) {
                    creep.heal(target);
                } else {
                    creep.rangedHeal(target);
                }
            }
        }
    }

    /**
     * Maintain optimal range to target.
     * Ranged: Range 3.
     * Melee: Range 1.
     */
    kite(target: RoomPosition | { pos: RoomPosition }): void {
        const targetPos = "pos" in target ? target.pos : target;
        const range = this.pos!.getRangeTo(targetPos);

        const isRanged = this.creep!.getActiveBodyparts(RANGED_ATTACK) > this.creep!.getActiveBodyparts(ATTACK);

        if (isRanged) {
            // Ranged behavior: Keep at range 3
            if (range < 3) {
                // Too close! Flee.
                this.flee(targetPos);
            } else if (range > 3) {
                // Too far. Approach.
                this.travelTo(targetPos, 3);
            }
            // If at range 3, stay put (or move to maintain if they move?)
        } else {
            // Melee behavior: Charge!
            if (range > 1) {
                this.travelTo(targetPos, 1);
            }
        }
    }

    /**
     * Flee from a target position.
     */
    private flee(target: RoomPosition): void {
        const path = PathFinder.search(this.pos!, { pos: target, range: 4 }, {
            flee: true,
            maxOps: 500,
            roomCallback: () => {
                // basic loose cost matrix, rely on default terrain
                return new PathFinder.CostMatrix();
            }
        });
        if (path.path.length > 0) {
            this.creep!.move(this.pos!.getDirectionTo(path.path[0])!);
        } else {
            const direction = this.pos!.getDirectionTo(target);
            const opposite = ((direction + 3) % 8) + 1;
            this.creep!.move(opposite as DirectionConstant);
        }
    }
}
