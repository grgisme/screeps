// ============================================================================
// ColonizeDirective — Automates the 3-phase room expansion lifecycle
// ============================================================================
// Triggered by placing a flag named "claim:RoomName" (e.g. "claim:W4N1").
//
// Phase 1: SCOUTING   — ScoutOverlord if room invisible
// Phase 2: CLAIMING   — ClaimerOverlord sends [CLAIM, MOVE] to take controller
// Phase 3: BOOTSTRAP  — PioneerOverlord sends large workers to build first Spawn
//
// Once the new room has a completed Spawn, the directive's job is done.
// The Kernel will auto-detect the new Colony on the next tick.

import { Directive } from "./Directive";
import type { Colony } from "../colony/Colony";
import { ScoutOverlord } from "../overlords/ScoutOverlord";
import { ClaimerOverlord } from "../overlords/ClaimerOverlord";
import { PioneerOverlord } from "../overlords/PioneerOverlord";
import { Logger } from "../../utils/Logger";

const log = new Logger("ColonizeDirective");

enum ColonizePhase {
    SCOUTING = "scouting",
    CLAIMING = "claiming",
    BOOTSTRAPPING = "bootstrapping",
    COMPLETE = "complete",
}

export class ColonizeDirective extends Directive {
    private scoutOverlord: ScoutOverlord | null = null;
    private claimerOverlord: ClaimerOverlord | null = null;
    private pioneerOverlord: PioneerOverlord | null = null;
    private phase: ColonizePhase = ColonizePhase.SCOUTING;

    constructor(flag: Flag, colony: Colony) {
        super(flag, colony);
    }

    init(): void {
        const target = this.targetRoom;
        const targetRoom = Game.rooms[target];

        // ── Phase transitions ──────────────────────────────────────────────

        // Complete: target room has a spawn → nothing more to do
        if (targetRoom) {
            const spawns = targetRoom.find(FIND_MY_SPAWNS);
            if (spawns.length > 0) {
                if (this.phase !== ColonizePhase.COMPLETE) {
                    this.phase = ColonizePhase.COMPLETE;
                    log.info(`🏠 Colony ${target} fully bootstrapped! Directive complete.`);
                }
                return;
            }
        }

        // Phase 1: SCOUTING — room invisible, need vision
        if (!this.isTargetVisible) {
            this.phase = ColonizePhase.SCOUTING;
            if (!this.scoutOverlord) {
                log.info(`Phase 1: Scouting ${target}`);
                this.scoutOverlord = new ScoutOverlord(this.colony, target);
                this.registerOverlord(this.scoutOverlord);
            }
            return;
        }

        // Phase 2: CLAIMING — room visible, controller not yet ours
        if (!targetRoom?.controller?.my) {
            this.phase = ColonizePhase.CLAIMING;
            if (!this.claimerOverlord) {
                log.info(`Phase 2: Claiming ${target}`);
                this.claimerOverlord = new ClaimerOverlord(this.colony, target);
                this.registerOverlord(this.claimerOverlord);
            }
            return;
        }

        // Phase 3: BOOTSTRAPPING — room claimed, need a spawn
        this.phase = ColonizePhase.BOOTSTRAPPING;
        if (!this.pioneerOverlord) {
            log.info(`Phase 3: Bootstrapping ${target} — deploying pioneers`);
            this.pioneerOverlord = new PioneerOverlord(this.colony, target);
            this.registerOverlord(this.pioneerOverlord);
        }

        // Ensure a spawn construction site exists in the target room
        this.ensureSpawnSite(targetRoom);
    }

    /**
     * Place a spawn construction site in the target room if none exists.
     * Uses the room's center-ish area to find the best spot.
     */
    private ensureSpawnSite(room: Room): void {
        const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s: ConstructionSite) => s.structureType === STRUCTURE_SPAWN
        });
        if (existingSites.length > 0) return;

        const existingSpawns = room.find(FIND_MY_SPAWNS);
        if (existingSpawns.length > 0) return;

        // Find a clear spot near the controller
        const controller = room.controller;
        if (!controller) return;

        const terrain = Game.map.getRoomTerrain(room.name);

        // Scan in expanding rings from controller to find a buildable tile
        for (let range = 2; range <= 8; range++) {
            for (let dx = -range; dx <= range; dx++) {
                for (let dy = -range; dy <= range; dy++) {
                    if (Math.abs(dx) !== range && Math.abs(dy) !== range) continue; // Ring only
                    const x = controller.pos.x + dx;
                    const y = controller.pos.y + dy;
                    if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                    if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) continue;

                    // Check no structures at this position
                    const pos = new RoomPosition(x, y, room.name);
                    const structures = pos.lookFor(LOOK_STRUCTURES);
                    if (structures.length > 0) continue;

                    const result = pos.createConstructionSite(STRUCTURE_SPAWN);
                    if (result === OK) {
                        log.info(`Placed spawn construction site at ${x},${y} in ${room.name}`);
                        return;
                    }
                }
            }
        }

        log.warning(`Could not find a valid spawn site in ${room.name}`);
    }

    run(): void {
        // All logic is handled via overlords — nothing extra needed
    }
}
