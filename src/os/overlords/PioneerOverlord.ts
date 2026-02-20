// ============================================================================
// PioneerOverlord — Spawns large workers from parent colony to bootstrap a new room
// ============================================================================
// Pioneers carry energy cross-room, build the first Spawn (15,000 energy),
// then harvest locally to accelerate bootstrapping.

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";

const log = new Logger("PioneerOverlord");

export class PioneerOverlord extends Overlord {
    targetRoom: string;
    pioneers: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `pioneer_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    /**
     * Scale pioneer body to parent room capacity.
     * Pattern: [WORK, CARRY, MOVE] segments, max 16 segments (48 parts).
     */
    private getPioneerBody(capacity: number): BodyPartConstant[] {
        const segmentCost = 200; // WORK(100) + CARRY(50) + MOVE(50)
        const maxSegments = Math.min(Math.floor(capacity / segmentCost), 16);
        const segments = Math.max(maxSegments, 1);

        const body: BodyPartConstant[] = [];
        for (let i = 0; i < segments; i++) {
            body.push(WORK, CARRY, MOVE);
        }
        return body;
    }

    init(): void {
        this.pioneers = this.zergs.filter(
            z => z.isAlive() && (z.memory as any)?.role === "pioneer"
        );

        // Check if the target room already has a spawn — if so, pioneers are no longer needed
        const targetRoom = Game.rooms[this.targetRoom];
        if (targetRoom) {
            const spawns = targetRoom.find(FIND_MY_SPAWNS);
            if (spawns.length > 0) return; // Room is self-sufficient
        }

        // Spawn up to 2 pioneers
        if (this.pioneers.length >= 2) return;

        const room = this.colony.room;
        if (!room) return;

        const body = this.getPioneerBody(room.energyCapacityAvailable);
        log.info(`Requesting pioneer for ${this.targetRoom} (${body.length} parts)`);

        this.colony.hatchery.enqueue({
            priority: 50,
            bodyTemplate: body,
            overlord: this,
            name: `pioneer_${this.targetRoom}_${Game.time}`,
            memory: { role: "pioneer", targetRoom: this.targetRoom }
        });
    }

    run(): void {
        for (const pioneer of this.pioneers) {
            if (!pioneer.isAlive()) continue;
            const creep = pioneer.creep;
            if (!creep) continue;

            const mem = pioneer.memory as any;

            // Travel to target room if not there
            if (creep.room.name !== this.targetRoom) {
                pioneer.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                continue;
            }

            // State machine: collecting vs working
            const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
            const capacity = creep.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;

            if (energy === 0) mem.collecting = true;
            if (capacity === 0) mem.collecting = false;

            if (mem.collecting) {
                // Harvest from nearest source
                const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
                if (source) {
                    if (creep.pos.isNearTo(source)) {
                        creep.harvest(source);
                    } else {
                        pioneer.travelTo(source.pos, 1);
                    }
                }
            } else {
                // Priority 1: Build spawn construction sites
                const spawnSite = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
                    filter: (s: ConstructionSite) => s.structureType === STRUCTURE_SPAWN
                });
                if (spawnSite) {
                    if (creep.pos.inRangeTo(spawnSite, 3)) {
                        creep.build(spawnSite);
                    } else {
                        pioneer.travelTo(spawnSite.pos, 3);
                    }
                    continue;
                }

                // Priority 2: Build other construction sites
                const site = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
                if (site) {
                    if (creep.pos.inRangeTo(site, 3)) {
                        creep.build(site);
                    } else {
                        pioneer.travelTo(site.pos, 3);
                    }
                    continue;
                }

                // Priority 3: Upgrade controller
                const controller = creep.room.controller;
                if (controller?.my) {
                    if (creep.pos.inRangeTo(controller, 3)) {
                        creep.upgradeController(controller);
                    } else {
                        pioneer.travelTo(controller.pos, 3);
                    }
                }
            }
        }
    }
}
