import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Zerg } from "../zerg/Zerg";
import { HarvestTask } from "../tasks/HarvestTask";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { PickupTask } from "../tasks/PickupTask";
import { Logger } from "../../utils/Logger";

const log = new Logger("RemoteMiningOverlord");

export class RemoteMiningOverlord extends Overlord {
    targetRoom: string;
    sites: MiningSite[] = [];
    miners: Zerg[] = [];
    haulers: Zerg[] = [];

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `remoteMining_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        this.miners = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "miner");
        this.haulers = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === "hauler");

        const room = Game.rooms[this.targetRoom];
        if (!room) return;

        const hostiles = room.find(FIND_HOSTILE_CREEPS).filter(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK));

        if (!Memory.rooms) Memory.rooms = {};
        if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;

        if (hostiles.length > 0) {
            if (!Memory.rooms[room.name].isDangerous) {
                log.alert(`invader-${this.targetRoom}`, `Invader detected in ${this.targetRoom}! Suspending mining.`);
                Memory.rooms[room.name].isDangerous = true;
            }
            Memory.rooms[room.name].dangerUntil = Game.time + 100;
            return;
        } else if (Memory.rooms[room.name].isDangerous && Game.time > (Memory.rooms[room.name].dangerUntil || 0)) {
            delete Memory.rooms[room.name].isDangerous;
            delete Memory.rooms[room.name].dangerUntil;
        }

        if (this.sites.length === 0) {
            const sources = room.find(FIND_SOURCES);
            for (const source of sources) {
                const site = new MiningSite(this.colony, source.id);
                this.calculateRemoteDistance(site);
                this.sites.push(site);
            }
        }

        for (const site of this.sites) {
            site.refreshStructureIds();
            this.handleSpawning(site);
            this.manageInfrastructure(site, room);
        }
    }

    private calculateRemoteDistance(site: MiningSite): void {
        const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
        if (!dropoff || !site.source) return;
        const path = PathFinder.search(site.source.pos, { pos: dropoff.pos, range: 1 });
        site.distance = path.path.length;
    }

    private handleSpawning(site: MiningSite): void {
        const siteMiners = this.miners.filter(m => (m.memory as any)?.state?.siteId === site.sourceId);
        if (siteMiners.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 80,
                bodyTemplate: [WORK, WORK, MOVE, MOVE],
                overlord: this,
                name: `rminer_${site.sourceId}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.sourceId } }
            });
        }

        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any)?.state?.siteId === site.sourceId)
            .reduce((sum, h) => sum + (h.store?.getCapacity() ?? 0), 0);

        if (currentPower < powerNeeded) {
            this.colony.hatchery.enqueue({
                priority: 40,
                bodyTemplate: [WORK, CARRY, CARRY, MOVE, MOVE],
                overlord: this,
                name: `rhauler_${site.sourceId}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.sourceId } }
            });
        }
    }

    private manageInfrastructure(site: MiningSite, room: Room): void {
        if (Game.time % 100 !== 0) return;

        if (site.containerPos && !site.containerId) {
            const hasSite = site.containerPos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_CONTAINER);
            if (!hasSite) site.containerPos.createConstructionSite(STRUCTURE_CONTAINER);
        }

        const username = this.colony.room?.controller?.owner?.username;
        if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username === username))) {
            const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
            if (!dropoff || !site.source) return;

            const existing = new Set([
                ...room.find(FIND_STRUCTURES).filter(s => s.structureType === STRUCTURE_ROAD).map(s => `${s.pos.x},${s.pos.y}`),
                ...room.find(FIND_MY_CONSTRUCTION_SITES).filter(s => s.structureType === STRUCTURE_ROAD).map(s => `${s.pos.x},${s.pos.y}`)
            ]);

            const path = PathFinder.search(site.source.pos, { pos: dropoff.pos, range: 1 }, {
                plainCost: 2, swampCost: 4, roomCallback: () => new PathFinder.CostMatrix()
            });

            if (!path.incomplete) {
                for (const pos of path.path) {
                    if (pos.roomName === this.targetRoom) {
                        const terrain = Game.map.getRoomTerrain(pos.roomName);
                        if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL && !existing.has(`${pos.x},${pos.y}`)) {
                            if (pos.createConstructionSite(STRUCTURE_ROAD) === OK) return;
                        }
                    }
                }
            }
        }
    }

    run(): void {
        for (const miner of this.miners) {
            if (!miner.isAlive() || miner.task) continue;
            const siteId = (miner.memory as any)?.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (miner.room?.name !== this.targetRoom) {
                miner.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
            } else if (site?.source) {
                miner.setTask(new HarvestTask(site.source.id));
            }
        }

        for (const hauler of this.haulers) {
            if (!hauler.isAlive()) continue;

            if (hauler.store?.energy && hauler.store.energy > 0 && hauler.creep?.getActiveBodyparts(WORK)) {
                const road = hauler.pos?.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax);
                if (road) hauler.repair(road);
            }

            if (hauler.task) continue;

            const siteId = (hauler.memory as any)?.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (hauler.store?.getUsedCapacity() === 0) {
                if (hauler.room?.name !== this.targetRoom) {
                    hauler.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                    continue;
                }
                if (site?.containerId) {
                    hauler.setTask(new WithdrawTask(site.containerId));
                } else if (site?.source) {
                    const dropped = site.source.pos.findInRange(FIND_DROPPED_RESOURCES, 1).find(r => r.resourceType === RESOURCE_ENERGY);
                    if (dropped) hauler.setTask(new PickupTask(dropped.id as Id<Resource>));
                    else hauler.travelTo(site.source.pos, 3);
                }
            } else {
                const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
                if (dropoff) hauler.setTask(new TransferTask(dropoff.id as Id<Structure | Creep>));
            }
        }
    }
}
