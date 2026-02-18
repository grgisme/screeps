export class CreepBody {
    /**
     * Generates a body by repeating the pattern as many times as possible within the energy limit.
     * Ensures TOUGH parts are at the front and limits the total body size to 50 parts.
     */
    static grow(template: BodyPartConstant[], energyLimit: number): BodyPartConstant[] {
        const body: BodyPartConstant[] = [];
        const patternCost = template.reduce((sum, part) => sum + BODYPART_COST[part], 0);
        const maxRepeats = Math.floor(energyLimit / patternCost);
        const limitPos = 50;

        // How many times can we repeat the pattern?
        let repeats = maxRepeats;

        // Safety check: if pattern is empty or cost is 0, return empty
        if (patternCost === 0 || template.length === 0) return [];

        // If we can't afford even one repeat, return one copy anyway
        // (the Hatchery will wait for energy or drop if truly impossible)
        if (maxRepeats === 0) {
            return this.sort([...template]);
        }

        for (let i = 0; i < repeats; i++) {
            if (body.length + template.length > limitPos) break;
            body.push(...template);
        }

        return this.sort(body);
    }

    /**
     * Sorts body parts: TOUGH first, random others, potentially MOVE last if we wanted to be fancy.
     * For now, just ensuring TOUGH is first for damage mitigation.
     */
    static sort(body: BodyPartConstant[]): BodyPartConstant[] {
        return body.sort((a, b) => {
            if (a === TOUGH && b !== TOUGH) return -1;
            if (a !== TOUGH && b === TOUGH) return 1;
            // Optional: Move HEAL to end? MOVE to end?
            // "Part Ordering: Ensure TOUGH parts are first (if present) and MOVE parts are distributed or at the end for "Move-Last" survivability."
            // Let's put MOVE at the end for now to enable "move last" behavior which can be beneficial.
            if (a === MOVE && b !== MOVE) return 1;
            if (a !== MOVE && b === MOVE) return -1;
            return 0;
        });
    }
}
