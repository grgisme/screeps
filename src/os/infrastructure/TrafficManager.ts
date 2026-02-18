// ============================================================================
// TrafficManager — Priority-based movement resolution
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";

const log = new Logger("TrafficManager");

/** Direction offsets: [dx, dy] indexed by DirectionConstant (1-8). */
const DIR_OFFSETS: Record<DirectionConstant, [number, number]> = {
    [TOP]: [0, -1],
    [TOP_RIGHT]: [1, -1],
    [RIGHT]: [1, 0],
    [BOTTOM_RIGHT]: [1, 1],
    [BOTTOM]: [0, 1],
    [BOTTOM_LEFT]: [-1, 1],
    [LEFT]: [-1, 0],
    [TOP_LEFT]: [-1, -1],
};

/**
 * Get the RoomPosition one step in the given direction from `pos`.
 * Returns null if the result would be out of bounds (0–49).
 */
function positionAtDirection(pos: RoomPosition, dir: DirectionConstant): RoomPosition | null {
    const [dx, dy] = DIR_OFFSETS[dir];
    const x = pos.x + dx;
    const y = pos.y + dy;
    if (x < 0 || x > 49 || y < 0 || y > 49) return null;
    return new RoomPosition(x, y, pos.roomName);
}

export interface MoveIntent {
    zerg: Zerg;
    direction: DirectionConstant;
    priority: number;
}

export class TrafficManager {
    private static intents: MoveIntent[] = [];
    private static movesThisTick = 0;
    private static shovesThisTick = 0;

    /**
     * Register a movement intent for this tick.
     */
    static register(zerg: Zerg, direction: DirectionConstant, priority: number): void {
        this.intents.push({ zerg, direction, priority });
    }

    /**
     * Resolve conflicts and execute moves.
     * High priority (lower number) moves first.
     */
    static run(): void {
        // Sort by priority (ascending: 0 is highest)
        this.intents.sort((a, b) => a.priority - b.priority);

        for (const intent of this.intents) {
            const zerg = intent.zerg;
            const targetPos = positionAtDirection(zerg.pos!, intent.direction);

            if (!targetPos) continue;

            // Check for creeps at target
            const creepsAtTarget = targetPos.lookFor(LOOK_CREEPS);
            const blocker = creepsAtTarget.length > 0 ? (creepsAtTarget[0] as Creep) : null;

            // If blocked by a friendly creep
            if (blocker && blocker.owner && blocker.owner.username === zerg.room!.controller?.owner?.username) {
                // Is the blocker moving?
                const blockerIntent = this.intents.find(i => i.zerg.name === blocker.name);

                // If blocker is stationary (idle), try to shove it
                if (!blockerIntent) {
                    // Only shove if we have higher priority (lower value)
                    // Assume idle creeps have priority ~100.
                    // If current intent is critical (0) or high (1), we shove.
                    // For now, allow shoving for any priority < 10.
                    if (intent.priority < 10) {
                        const shoved = this.shove(blocker);
                        if (shoved) {
                            this.shovesThisTick++;
                        }
                    }
                }
            }

            // Execute move
            zerg.creep!.move(intent.direction);
            this.movesThisTick++;
        }

        // Report
        if (this.shovesThisTick > 0 && Game.time % 5 === 0) {
            log.debug(`Traffic: ${this.movesThisTick} moves, ${this.shovesThisTick} shoves.`);
        }

        // Cleanup
        this.intents = [];
        this.movesThisTick = 0;
        this.shovesThisTick = 0;
    }

    /**
     * Shove a blocker to a random free adjacent square.
     * Returns true if a shove command was successfully issued.
     */
    private static shove(creep: Creep): boolean {
        // 1. Check fatigue
        if (creep.fatigue > 0) {
            return false;
        }

        // 2. Find a random free adjacent square
        const directions: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
        // Shuffle directions
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        for (const dir of directions) {
            const pos = positionAtDirection(creep.pos, dir);
            if (!pos) continue;

            // Check for obstacles
            const creeps = pos.lookFor(LOOK_CREEPS);
            const structures = pos.lookFor(LOOK_STRUCTURES);
            const terrain = Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y);

            const isBlockedByCreep = creeps.length > 0;
            const isBlockedByStructure = structures.some((s: any) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART && !s.my)
            );
            const isWall = terrain === TERRAIN_MASK_WALL;

            if (!isBlockedByCreep && !isBlockedByStructure && !isWall) {
                // Found a spot!
                creep.move(dir);
                creep.say("shove");
                return true;
            }
        }
        return false;
    }
}

