// ============================================================================
// CreepBody — Body generation with energy-aware scaling and combat-optimal
//             part ordering.
// ============================================================================

/**
 * Part priority map for damage-optimal body ordering.
 *
 * In Screeps, damage is applied to body parts front-to-back. The optimal
 * ordering places cheap/expendable parts first (damage sponge) and critical
 * parts last (survive longest):
 *
 *   TOUGH → WORK → CARRY → ATTACK → RANGED_ATTACK → CLAIM → MOVE → HEAL
 *
 * - TOUGH (0): Cheapest part, best damage sponge, boosted TOUGH reduces
 *   all incoming damage.
 * - MOVE (6): Second-to-last — losing MOVE cripples the creep but it
 *   can still fight/heal for a few more hits.
 * - HEAL (7): Absolute last — the most valuable part on military creeps.
 *   Every tick of healing that survives is worth more than any other part.
 */
const PART_PRIORITY: Record<BodyPartConstant, number> = {
    [TOUGH]: 0,
    [WORK]: 1,
    [CARRY]: 2,
    [ATTACK]: 3,
    [RANGED_ATTACK]: 4,
    [CLAIM]: 5,
    [MOVE]: 6,
    [HEAL]: 7,
};

export class CreepBody {
    /**
     * Generates a body by repeating the pattern as many times as possible
     * within the energy limit. Returns an empty array if the template
     * cannot be afforded even once — this signals the Hatchery to skip
     * or spawn a cheaper alternative instead of deadlocking the queue.
     *
     * Body is sorted in combat-optimal order (TOUGH first, HEAL last).
     * Total body size is capped at 50 parts (Screeps engine limit).
     */
    static grow(template: BodyPartConstant[], energyLimit: number): BodyPartConstant[] {
        // Safety: empty template or zero-cost template → empty body
        if (template.length === 0) return [];

        const patternCost = template.reduce((sum, part) => sum + BODYPART_COST[part], 0);
        if (patternCost === 0) return [];

        const maxRepeats = Math.floor(energyLimit / patternCost);

        // If we can't afford even one repeat, return empty.
        // This prevents the Hatchery from issuing ERR_NOT_ENOUGH_ENERGY
        // indefinitely, which would deadlock the spawn queue.
        if (maxRepeats === 0) {
            return [];
        }

        const body: BodyPartConstant[] = [];
        const maxParts = 50;

        for (let i = 0; i < maxRepeats; i++) {
            if (body.length + template.length > maxParts) break;
            body.push(...template);
        }

        return this.sort(body);
    }

    /**
     * Sorts body parts in combat-optimal order using a predefined priority
     * map. This replaces brittle if/else chains with a single O(1) lookup
     * per comparison.
     *
     * Order: TOUGH → WORK → CARRY → ATTACK → RANGED_ATTACK → CLAIM → MOVE → HEAL
     */
    static sort(body: BodyPartConstant[]): BodyPartConstant[] {
        return body.sort((a, b) => PART_PRIORITY[a] - PART_PRIORITY[b]);
    }
}
