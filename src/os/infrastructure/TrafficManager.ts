// ============================================================================
// TrafficManager — Priority-based movement resolution
// ============================================================================

import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";
import { getPositionAtDirection } from "../../utils/RoomPosition"; // Explicit Import

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

    static register(zerg: Zerg, direction: DirectionConstant, priority: number): void {
        this.intents.push({ zerg, direction, priority });
    }

    static run(): void {
        try {
            // ── DIAGNOSTIC LOG (remove after debugging) ──
            if (Game.time % 5 === 0) {
                const names = this.intents.map(i => `${i.zerg.name}:dir${i.direction}`);
                console.log(`[DIAG:Traffic] ${this.intents.length} intents: ${names.join(', ')}`);
            }

            this.intents.sort((a, b) => a.priority - b.priority);

            for (const intent of this.intents) {
                if ((intent.direction as number) === 0) continue; // Skip swapped/cancelled intents

                const zerg = intent.zerg;
                if (!zerg.pos) continue;

                const targetPos = getPositionAtDirection(zerg.pos, intent.direction);

                if (!targetPos) {
                    // Border transition
                    zerg.creep!.move(intent.direction);
                    this.movesThisTick++;
                    continue;
                }

                const creepsAtTarget = targetPos.lookFor(LOOK_CREEPS);
                const blocker = creepsAtTarget.length > 0 ? creepsAtTarget[0] : null;

                // ── FIX: Safe hostile detection via `blocker.my` for Remote Rooms ──
                if (blocker && blocker.my) {
                    const blockerIntentIndex = this.intents.findIndex(i => i.zerg.name === blocker.name && (i.direction as number) !== 0);
                    const blockerIntent = blockerIntentIndex > -1 ? this.intents[blockerIntentIndex] : null;

                    if (!blockerIntent) {
                        // Blocker is stationary — shove it out of the way.
                        // Fix #2: Removed priority < 10 gate. shove() already
                        // protects miners and localized-task creeps.
                        const shoved = this.shove(blocker, zerg);
                        if (shoved) this.shovesThisTick++;
                    } else if (intent.priority < blockerIntent.priority) {
                        // Fix #1: Only force swap on true head-to-head deadlocks.
                        // Without this, a higher-priority creep behind a lower-priority
                        // one walking the SAME direction yanks it backward ("conveyor belt").
                        const isHeadToHead = blockerIntent.direction === blocker.pos.getDirectionTo(zerg.pos);

                        if (isHeadToHead) {
                            const swapDir = blocker.pos.getDirectionTo(zerg.pos);
                            blocker.move(swapDir);
                            blocker.say("🔄");
                            this.shovesThisTick++;

                            // Cancel blocker's old intent so it doesn't overwrite our swap
                            this.intents[blockerIntentIndex].direction = 0 as DirectionConstant;
                        }
                    }
                }

                // ── DIAGNOSTIC LOG (remove after debugging) ──
                const moveResult = zerg.creep!.move(intent.direction);
                if (Game.time % 5 === 0) {
                    console.log(`[DIAG:Traffic] MOVE ${zerg.name} dir=${intent.direction} result=${moveResult} fatigue=${zerg.creep!.fatigue} pos=${zerg.pos}`);
                }
                this.movesThisTick++;
            }

            if (this.shovesThisTick > 0 && Game.time % 5 === 0) {
                log.debug(`Traffic: ${this.movesThisTick} moves, ${this.shovesThisTick} shoves/swaps.`);
            }
        } finally {
            // Guarantee state clearing to prevent Intent Bleed if the loop crashes
            this.intents = [];
            this.movesThisTick = 0;
            this.shovesThisTick = 0;
        }
    }

    private static shove(creep: Creep, initiator: Zerg): boolean {
        if (creep.fatigue > 0) return false;
        if ((creep.memory as any).role === "miner") return false; // Protect Static Miners

        // Shove Dance Prevention: Do not shove creeps actively performing localized tasks
        const taskName = (creep.memory as any).task?.name;
        if (taskName === "Harvest" || taskName === "Upgrade") {
            return false;
        }

        const directions: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        for (const dir of directions) {
            const pos = getPositionAtDirection(creep.pos, dir);
            if (!pos) continue;

            // ── FIX 5: Prevent Exit Bouncing ──
            if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) continue;

            const isBlockedByCreep = pos.lookFor(LOOK_CREEPS).length > 0;

            // ── FIX 3: Correctly use OBSTACLE_OBJECT_TYPES ──
            const isBlockedByStructure = pos.lookFor(LOOK_STRUCTURES).some((s: Structure) =>
                (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType) ||
                (s.structureType === STRUCTURE_RAMPART && !(s as OwnedStructure).my)
            );

            const isWall = (Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y) & TERRAIN_MASK_WALL) !== 0;

            if (!isBlockedByCreep && !isBlockedByStructure && !isWall) {
                creep.move(dir);
                creep.say("🚶");
                return true;
            }
        }

        // ── FIX 4: The Swap Fallback ──
        if (initiator.pos) {
            const swapDir = creep.pos.getDirectionTo(initiator.pos);
            creep.move(swapDir);
            creep.say("🔄");
            return true;
        }

        return false;
    }
}
