// ============================================================================
// TrafficManager — Priority-based movement resolution
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";

const log = new Logger("TrafficManager");

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
            const targetPos = (zerg.pos as any).getPositionAtDirection(intent.direction);

            if (!targetPos) continue;

            // Check for creeps at target
            const creepsAtTarget = targetPos.lookFor(LOOK_CREEPS);
            const blocker = creepsAtTarget.length > 0 ? (creepsAtTarget[0] as Creep) : null;

            if (blocker && blocker.owner && blocker.owner.username === zerg.room.controller?.owner?.username) {
                // It's a friendly blocker.
                // Is it moving? Check if it has an intent (not efficient O(N), but acceptable for now)
                const blockerIntent = this.intents.find(i => i.zerg.name === blocker.name);

                if (!blockerIntent) {
                    // Blocker is stationary. Shove if we have higher priority.
                    // Lower value = higher priority.
                    // We need to know blocker's priority. Since it has no intent, assume lowest priority (e.g. 100)?
                    // Or implies it's idle.

                    // For now, if current intent is priority 0 (Critical), we shove anything idle.
                    if (intent.priority === 0) {
                        this.shove(blocker);
                        this.shovesThisTick++;
                    }
                }
            }

            // Execute move
            zerg.creep.move(intent.direction);
            this.movesThisTick++;
        }

        // Report
        if (this.shovesThisTick > 0) {
            log.debug(`Shoved ${this.shovesThisTick} creeps.`);
        }

        // Report
        if (Game.time % 10 === 0) {
            log.debug(`Traffic: ${this.movesThisTick} moves, ${this.shovesThisTick} shoves.`);
        }

        // Cleanup
        this.intents = [];
        this.movesThisTick = 0;
        this.shovesThisTick = 0;
    }

    private static shove(creep: Creep): void {
        // Find a random free adjacent square
        const directions: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
        // Shuffle directions
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        for (const dir of directions) {
            const pos = (creep.pos as any).getPositionAtDirection(dir);
            if (pos && pos.lookFor(LOOK_CREEPS).length === 0 && pos.lookFor(LOOK_STRUCTURES).every((s: any) => s.structureType !== STRUCTURE_WALL)) {
                // Found a spot
                creep.move(dir);
                return;
            }
        }
    }
}
