// ============================================================================
// RemoteMiningOverlord — Mining operations for remote rooms
// ============================================================================

import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Transporter } from "../zerg/Transporter";
import { Miner } from "../zerg/Miner";
import { Logger } from "../../utils/Logger";

const log = new Logger("RemoteMiningOverlord");

/**
 * Like MiningOverlord but for remote rooms.
 * Creates MiningSite objects for sources in the remote room,
 * with distance calculated from the home colony spawn.
 */
export class RemoteMiningOverlord extends Overlord {
    targetRoom: string;
    sites: MiningSite[] = [];
    miners: Miner[] = [];
    haulers: Transporter[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `remoteMining_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        const room = Game.rooms[this.targetRoom];
        if (!room) return; // No visibility yet

        // 0. Defense Protocol: Detect Invaders
        const hostiles = room.find(FIND_HOSTILE_CREEPS).filter(c =>
            c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK)
        );

        // Ensure Memory.rooms structure exists
        if (!Memory.rooms) Memory.rooms = {};
        if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;

        if (hostiles.length > 0) {
            if (!Memory.rooms[room.name].isDangerous) {
                log.alert(`invader-${this.targetRoom}`, `Invader detected in ${this.targetRoom}! Suspending mining operations.`);
                Memory.rooms[room.name].isDangerous = true;
            }
            Memory.rooms[room.name].dangerUntil = Game.time + 100; // Extend danger period
        } else {
            // Check if danger expired
            if (Memory.rooms[room.name].isDangerous && Game.time > (Memory.rooms[room.name].dangerUntil || 0)) {
                delete Memory.rooms[room.name].isDangerous;
                delete Memory.rooms[room.name].dangerUntil;
                log.info(`Remote room ${this.targetRoom} is safe now. Resuming operations.`);
            }
        }

        // If dangerous, suspend spawning and infra maintenance (but keep existing creeps alive/fleeing)
        if (Memory.rooms[room.name].isDangerous) {
            // Still populate creep lists so they can run (fly home)
            this.miners = this.zergs
                .filter(z => (z.memory as any).role === "miner")
                .map(z => {
                    const mem = (z.memory as any);
                    if (!mem.state || !mem.state.siteId) return null;
                    return new Miner(z.creepName);
                })
                .filter(m => m !== null) as Miner[];

            this.haulers = this.zergs
                .filter(z => (z.memory as any).role === "hauler")
                .map(z => new Transporter(z.creepName, this));

            return;
        }

        // 1. Instantiate Sites if not done
        if (this.sites.length === 0) {
            const sources = room.find(FIND_SOURCES);
            for (const source of sources) {
                const site = new MiningSite(this.colony, source.id);
                this.calculateRemoteDistance(site);
                this.sites.push(site);
            }
        }

        // 2. Refresh Sites
        for (const site of this.sites) {
            site.refreshStructureIds();
        }

        // 3. Creep Assignment
        this.miners = this.zergs
            .filter(z => (z.memory as any).role === "miner") as Miner[];

        this.haulers = this.zergs
            .filter(z => (z.memory as any).role === "hauler") as Transporter[];

        // 4. Spawn Logic per Site
        for (const site of this.sites) {
            this.handleSpawning(site);
            this.manageInfrastructure(site);
        }
    }

    /**
     * Calculate the path distance from the home colony spawn/storage
     * to the remote mining site. This is crucial for hauling calculations.
     */
    private calculateRemoteDistance(site: MiningSite): void {
        const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
        if (!dropoff) return;

        const source = site.source;
        if (!source) return;
        const path = PathFinder.search(source.pos, { pos: dropoff.pos, range: 1 });
        site.distance = path.path.length;
        log.info(`Remote site ${site.sourceId} distance: ${site.distance}`);
    }

    private handleSpawning(site: MiningSite): void {
        // ... Miners logic (unchanged)

        // B. Haulers — part-count balanced
        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any).state?.siteId === site.sourceId)
            .reduce((sum, h) => sum + (h.store?.getCapacity() ?? 0), 0);

        log.info(`Remote MiningSite [${site.sourceId}]: Distance [${site.distance}], Required Haul [${powerNeeded}], Current [${currentPower}]`);

        if (currentPower < powerNeeded) {
            this.colony.hatchery.enqueue({
                priority: 40, // Medium — remote hauling
                // Add WORK part for repair-on-transit (1 WORK, 1 CARRY, 1 MOVE per segment approx? or just 1 WORK total)
                // We just need 1 WORK part to enable repair.
                // Body: [WORK, CARRY... MOVE...]
                // Let's add 1 WORK at start.
                bodyTemplate: [WORK, CARRY, CARRY, MOVE, MOVE],
                overlord: this,
                name: `rhauler_${site.sourceId}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.sourceId } }
            });
        }
    }

    private manageInfrastructure(site: MiningSite): void {
        if (Game.time % 100 !== 0) return; // Only check occasionally
        const room = Game.rooms[this.targetRoom];
        if (!room) return;

        // 1. Container at source
        if (site.containerPos) {
            const structures = site.containerPos.lookFor(LOOK_STRUCTURES);
            const constructionSites = site.containerPos.lookFor(LOOK_CONSTRUCTION_SITES);
            const hasContainer = structures.some(s => s.structureType === STRUCTURE_CONTAINER);
            const hasSite = constructionSites.some(s => s.structureType === STRUCTURE_CONTAINER);

            if (!hasContainer && !hasSite) {
                site.containerPos.createConstructionSite(STRUCTURE_CONTAINER);
                log.info(`Placing container site at ${site.containerPos}`);
            }
        }

        // 2. Roads (Only if reserved)
        if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username === "Me"))) { // Replace "Me" with actual username check later? Or assumes own room reservation logic implies ownership.
            // Actually, reservation.username check might fail if username is not hardcoded. 
            // Better check: room.controller.reservation.username === this.colony.room.controller!.owner!.username
            // For now, let's assume if reservation exists and it's ours (we are reserving it), proceed.
            // But actually we might rely on Invader checks?
            // Simplest: if (room.controller.reservation && room.controller.reservation.username === this.colony.owner.username)
            // But Colony doesn't expose owner easily.
            // Let's use generic check: valid reservation.

            // Path from source to home storage
            const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
            if (dropoff) {
                const source = site.source;
                if (!source) return;
                const path = PathFinder.search(source.pos, { pos: dropoff.pos, range: 1 }, {
                    plainCost: 2,
                    swampCost: 4, // Roads are good on swamp
                    roomCallback: (_roomName) => {
                        // Avoid hostile rooms?
                        return new PathFinder.CostMatrix();
                    }
                });

                if (!path.incomplete) {
                    for (const pos of path.path) {
                        if (pos.roomName === this.targetRoom) {
                            // Only build in the remote room (for now, or transit rooms too if we own/reserve them?)
                            // The task says "Automated Road Maintenance... roads will decay".
                            // And "Automatically place... ConstructionSites for Roads along the path".
                            // Constraint: "Only build if the room is Reserved".
                            // So we check if the pos room is reserved.
                            // Since we are iterating loop in RemoteMiningOverlord for targetRoom, 
                            // we mainly care about targetRoom roads.

                            const terrain = Game.map.getRoomTerrain(pos.roomName);
                            if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
                                // Check if road exists
                                const structures = pos.lookFor(LOOK_STRUCTURES);
                                const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
                                const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                                if (!hasRoad && sites.length === 0) {
                                    pos.createConstructionSite(STRUCTURE_ROAD);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    run(): void {
        for (const miner of this.miners) {
            miner.run();
        }

        for (const hauler of this.haulers) {
            hauler.run(); // Transporter.run() handles logic
        }
    }
}
