// ============================================================================
// QueenOverlord — Mobile Base Distributor (RCL 4+)
// ============================================================================
//
// The Queen is the mobile counterpart to the stationary Filler anchor.
// Division of labor:
//   Filler (Anchor) — inner 7 extensions + spawns (range-1, never moves)
//   Queen (Distributor) — outer extensions, towers, labs, terminal
//
// Activation: requires room.storage (RCL 4+).
// Body:  [CARRY×2, MOVE] × N — 2:1 ratio on roaded bunker paths.
// Priority: 82 (below Filler 85, above Workers 30).
//
// Energy flow at RCL 4+:
//   Transporters → Storage → Filler (inner ring) + Queen (outer ring)
//   Transporters no longer route to individual extensions or towers —
//   that responsibility belongs entirely to the Queen.
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { Logger } from "../../utils/Logger";

const log = new Logger("Queen");

export class QueenOverlord extends Overlord {
    queens: Zerg[] = [];

    constructor(colony: Colony) {
        super(colony, "queen");
    }

    init(): void {
        this.queens = this.zergs
            .filter(z => z.isAlive() && (z.memory as any)?.role === "queen");

        this.handleSpawning();
    }

    run(): void {
        const room = this.colony.room;
        if (!room) return;

        // Queen only operates with Storage - gate hard here too in case storage
        // is demolished mid-game (very rare, but safe).
        if (!room.storage) return;

        // Compute filler tile for inner-ring exclusion
        const anchor = (this.colony.memory as any)?.anchor as { x: number; y: number } | undefined;
        const fillerTileCoord = BunkerLayout.fillerTiles[0];
        const fillerPos = anchor
            ? new RoomPosition(
                anchor.x + fillerTileCoord.x,
                anchor.y + fillerTileCoord.y,
                room.name)
            : null;

        for (const queen of this.queens) {
            if (!queen.isAlive()) continue;
            if (queen.task) continue;

            const energy = queen.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;

            if (energy === 0) {
                // ── Withdraw from hub link first (if has surplus), else Storage ──
                const hubLink = this.colony.linkNetwork?.hubLink;
                if (hubLink && hubLink.store.energy > 600) {
                    queen.setTask(new WithdrawTask(hubLink.id as Id<Structure>));
                } else if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    queen.setTask(new WithdrawTask(room.storage.id as Id<Structure>));
                }
                // If storage is also empty, the Queen idles — LogisticsNetwork
                // will dispatch a transporter to refill storage eventually.

            } else {
                // ── Fill priority cascade ──
                // 1. Towers with serious deficit (> 200 free capacity)
                const tower = queen.pos?.findClosestByRange(FIND_MY_STRUCTURES, {
                    filter: (s: Structure) =>
                        s.structureType === STRUCTURE_TOWER &&
                        (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 200
                }) as StructureTower | null | undefined;

                if (tower) {
                    queen.setTask(new TransferTask(tower.id as Id<Structure>));
                    continue;
                }

                // 2. Outer extensions (skip inner ring — Filler's domain)
                const outerExt = queen.pos?.findClosestByRange(FIND_MY_STRUCTURES, {
                    filter: (s: Structure) => {
                        if (s.structureType !== STRUCTURE_EXTENSION) return false;
                        if ((s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return false;
                        // Skip inner-ring extensions (Filler handles those)
                        if (fillerPos && fillerPos.getRangeTo(s.pos) <= 1) return false;
                        return true;
                    }
                }) as StructureExtension | null | undefined;

                if (outerExt) {
                    queen.setTask(new TransferTask(outerExt.id as Id<Structure>));
                    continue;
                }

                // 3. Labs (RCL 6+)
                const lab = queen.pos?.findClosestByRange(FIND_MY_STRUCTURES, {
                    filter: (s: Structure) =>
                        s.structureType === STRUCTURE_LAB &&
                        (s as StructureLab).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                }) as StructureLab | null | undefined;

                if (lab) {
                    queen.setTask(new TransferTask(lab.id as Id<Structure>));
                    continue;
                }

                // 4. Terminal top-up (keep 3000e minimum for market ops)
                const terminal = room.terminal;
                if (terminal && terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 3000) {
                    queen.setTask(new TransferTask(terminal.id as Id<Structure>));
                    continue;
                }

                // 5. Towers with small deficit (top them off when nothing else needs it)
                const towerTopup = queen.pos?.findClosestByRange(FIND_MY_STRUCTURES, {
                    filter: (s: Structure) =>
                        s.structureType === STRUCTURE_TOWER &&
                        (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                }) as StructureTower | null | undefined;

                if (towerTopup) {
                    queen.setTask(new TransferTask(towerTopup.id as Id<Structure>));
                    continue;
                }

                // Nothing to fill — dump surplus back into Storage rather than
                // holding a full load indefinitely.
                if (room.storage && room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    queen.setTask(new TransferTask(room.storage.id as Id<Structure>));
                }
            }
        }
    }

    private handleSpawning(): void {
        const room = this.colony.room;
        if (!room) return;

        // Activation gate: Queen only operates at RCL 4+ with Storage
        if (!room.storage) return;

        // 1 Queen at all RCLs (may scale to 2 at RCL 8 if needed — out of scope here)
        const maxQueens = 1;

        // Pre-spawn TTL replacement
        let activeQueens = 0;
        for (const q of this.queens) {
            const ttl = q.creep?.ticksToLive ?? Infinity;
            const bodySize = q.creep?.body?.length ?? 6;
            const preSpawnThreshold = (bodySize * 3) + 20; // spawn time + walk to storage
            if (ttl > preSpawnThreshold) {
                activeQueens++;
            } else {
                log.debug(() => `Pre-spawn: Queen TTL=${ttl}, threshold=${preSpawnThreshold}`);
            }
        }

        if (activeQueens >= maxQueens) return;

        // Body: [CARRY, CARRY, MOVE] × N — 2:1 ratio for roaded bunker.
        // Cap at 9 segments (18 CARRY, 9 MOVE = 27 parts) to leave room for
        // a body upgrade without exhausting the spawn budget.
        const capacity = room.energyCapacityAvailable;
        const segments = Math.min(Math.floor(capacity / 150), 9);

        if (segments < 1) return; // Can't afford even 1 segment

        const template: BodyPartConstant[] = [];
        for (let i = 0; i < segments; i++) {
            template.push(CARRY, CARRY, MOVE);
        }

        this.colony.hatchery.enqueue({
            priority: 82,
            bodyTemplate: template,
            overlord: this,
            name: `Queen_${this.colony.name}_${Game.time}`,
            memory: { role: "queen" }
        });

        log.debug(() => `Queen requested. Segments: ${segments}, Energy cap: ${capacity}`);
    }
}
