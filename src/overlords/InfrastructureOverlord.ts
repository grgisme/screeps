/**
 * InfrastructureOverlord — Automated construction site placer.
 *
 * Priority 3 Overlord that never spawns Zergs. Instead, it:
 *   1. Monitors the current RCL
 *   2. Compares the BunkerStamp against existing structures
 *   3. Places ConstructionSites for missing structures as they unlock
 *   4. Places road ConstructionSites from bunker to sources/controller
 *
 * Runs every ~10 ticks to avoid wasting CPU on checks.
 */
import { Overlord, SpawnRequest } from "./Overlord";
import { roomPlanner } from "../planning/RoomPlanner";

export class InfrastructureOverlord extends Overlord {
    /** Last RCL we planned for (avoid redundant planning) */
    private lastPlannedRCL: number = 0;

    /** Tick when we last placed sites */
    private lastPlaceTick: number = 0;

    /** Sites placed this lifecycle */
    private sitesPlaced: number = 0;

    constructor(roomName: string) {
        super(`infra-${roomName}`, roomName, 3);
    }

    // ─── OVERLORD INTERFACE ────────────────────────────────────────

    /** No Zergs to sense for */
    sense(): void {
        // Nothing to sense — we don't manage creeps
    }

    /** No Zergs to assign tasks to */
    assign(): void {
        // No-op
    }

    /** Never spawns Zergs */
    getSpawnRequests(): SpawnRequest[] {
        return [];
    }

    /**
     * Override run() to skip the Zerg execution loop.
     * Instead, we place construction sites periodically.
     */
    run(): void {
        if (!this.active) return;

        const room = this.room;
        if (!room || !room.controller?.my) return;

        const rcl = room.controller.level;

        // Only run every 10 ticks (construction sites don't expire fast)
        if (Game.time - this.lastPlaceTick < 10) return;
        this.lastPlaceTick = Game.time;

        // Place structures from the BunkerStamp
        this.placeStampStructures(room, rcl);

        // Place roads (start at RCL 3 when we have enough economy)
        if (rcl >= 3) {
            this.placeRoads(room);
        }
    }

    // ─── CONSTRUCTION LOGIC ────────────────────────────────────────

    /**
     * Place construction sites for missing BunkerStamp structures.
     * Respects the 100 construction site global limit.
     */
    private placeStampStructures(room: Room, rcl: number): void {
        const missing = roomPlanner.getMissingStructures(this.roomName, rcl);
        if (missing.length === 0) return;

        // Count existing construction sites (global limit is 100)
        const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
        const maxNew = Math.min(5, 100 - existingSites); // Place up to 5 per cycle
        if (maxNew <= 0) return;

        let placed = 0;
        for (const struct of missing) {
            if (placed >= maxNew) break;

            // Don't place roads here — they have their own method
            if (struct.structureType === STRUCTURE_ROAD) continue;

            const pos = new RoomPosition(struct.x, struct.y, this.roomName);
            const result = pos.createConstructionSite(struct.structureType);

            if (result === OK) {
                placed++;
                this.sitesPlaced++;
                if (placed === 1 || rcl !== this.lastPlannedRCL) {
                    console.log(`🏗️ INFRA ${this.roomName}: Placing ${struct.structureType} at (${struct.x},${struct.y}) [RCL ${rcl}]`);
                }
            } else if (result === ERR_INVALID_TARGET) {
                // Something already there or terrain mismatch — skip
            } else if (result === ERR_RCL_NOT_ENOUGH) {
                // Already at structure limit for this type at this RCL
                break;
            }
        }

        this.lastPlannedRCL = rcl;
    }

    /**
     * Place road construction sites from bunker to sources/controller.
     */
    private placeRoads(room: Room): void {
        const missingRoads = roomPlanner.getMissingRoads(this.roomName);
        if (missingRoads.length === 0) return;

        const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
        const maxNew = Math.min(3, 100 - existingSites); // Place up to 3 road sites per cycle
        if (maxNew <= 0) return;

        let placed = 0;
        for (const road of missingRoads) {
            if (placed >= maxNew) break;

            const pos = new RoomPosition(road.x, road.y, this.roomName);
            const result = pos.createConstructionSite(STRUCTURE_ROAD);

            if (result === OK) {
                placed++;
            }
        }
    }

    // ─── DIAGNOSTICS ───────────────────────────────────────────────

    toString(): string {
        return `InfraOverlord<${this.roomName}|${this.sitesPlaced} placed>`;
    }
}
