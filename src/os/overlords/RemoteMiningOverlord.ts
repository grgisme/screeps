import { Overlord } from "./Overlord";
import type { Colony } from "../colony/Colony";
import { MiningSite } from "../colony/MiningSite";
import { Zerg } from "../zerg/Zerg";
import { HarvestTask } from "../tasks/HarvestTask";
import { RepairTask } from "../tasks/RepairTask";
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
        }
    }

    private calculateRemoteDistance(site: MiningSite): void {
        const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
        if (!dropoff || !site.source) return;
        const path = PathFinder.search(site.source.pos, { pos: dropoff.pos, range: 1 });
        site.distance = path.path.length;
    }

    private handleSpawning(site: MiningSite): void {
        const capacity = this.colony.room?.energyCapacityAvailable ?? 300;

        // 1. Exact 5-WORK Math + 1 CARRY for Static Repair
        const siteMiners = this.miners.filter(m => (m.memory as any)?.state?.siteId === site.sourceId);
        if (siteMiners.length < 1) {
            let minerBody: BodyPartConstant[] = [WORK, WORK, MOVE, MOVE];
            if (capacity >= 800) {
                minerBody = [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // 6 WORK for unreserved catchup
            } else if (capacity >= 700) {
                minerBody = [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]; // Exact 5-WORK
            }

            this.colony.hatchery.enqueue({
                priority: 80,
                bodyTemplate: minerBody,
                overlord: this,
                name: `rminer_${site.sourceId.slice(-4)}_${Game.time}`,
                memory: { role: "miner", state: { siteId: site.sourceId } }
            });
        }

        // 2. Part-Count Balanced Haulers
        const powerNeeded = site.calculateHaulingPowerNeeded();
        const currentPower = this.haulers
            .filter(h => (h.memory as any)?.state?.siteId === site.sourceId)
            .reduce((sum, h) => sum + (h.store?.getCapacity() ?? 0), 0);

        if (currentPower < powerNeeded) {
            let haulerBody: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE];

            if (capacity >= 450) {
                // Reserve 150 energy for WORK (100) + MOVE (50) for road repair
                const haulCapacity = capacity - 150;
                const carryPairs = Math.floor(haulCapacity / 150); // CARRY, CARRY, MOVE = 150
                haulerBody = [WORK, MOVE];
                for (let i = 0; i < carryPairs; i++) {
                    haulerBody.push(CARRY, CARRY, MOVE);
                    if (haulerBody.length >= 47) break; // 50 part limit
                }
            }

            this.colony.hatchery.enqueue({
                priority: 40,
                bodyTemplate: haulerBody,
                overlord: this,
                name: `rhauler_${site.sourceId.slice(-4)}_${Game.time}`,
                memory: { role: "hauler", state: { siteId: site.sourceId } }
            });
        }
    }

    run(): void {
        const isDangerous = Memory.rooms[this.targetRoom]?.isDangerous;
        const fallbackPos = this.colony.room?.storage?.pos || this.colony.room?.find(FIND_MY_SPAWNS)?.[0]?.pos;

        for (const miner of this.miners) {
            if (!miner.isAlive() || miner.task) continue;

            if (isDangerous && fallbackPos) {
                miner.travelTo(fallbackPos, 3);
                continue;
            }

            const siteId = (miner.memory as any)?.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (miner.room?.name !== this.targetRoom) {
                miner.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                continue;
            }

            // ── FIX: Static In-Place Container Repair ──
            const container = site?.container;
            if (container && container.hits < container.hitsMax - 1000 && (miner.store?.energy ?? 0) > 0) {
                miner.setTask(new RepairTask(container.id));
            } else if (!miner.task && site?.source) {
                miner.setTask(new HarvestTask(site.source.id));
            }
        }

        for (const hauler of this.haulers) {
            if (!hauler.isAlive()) continue;

            if (isDangerous) {
                // Fix 2: Scavenger Idle — haulers hold at the room EXIT, not the colony core.
                // Flooding the base with retreating haulers gridlocks storage/spawn.
                // Haulers wait at the border and re-enter the moment danger clears.
                if (hauler.room?.name === this.targetRoom) {
                    // Still inside the dangerous room — exit toward home
                    hauler.travelTo(new RoomPosition(25, 25, this.colony.name), 20);
                } else if (hauler.room?.name === this.colony.name) {
                    // Back in the safe room — park at the room exit tile toward target
                    const exitDir = Game.map.findExit(this.colony.name, this.targetRoom) as ExitConstant;
                    const exits = hauler.room.find(exitDir);
                    const nearestExit = exits.sort((a, b) => hauler.pos!.getRangeTo(a) - hauler.pos!.getRangeTo(b))[0];
                    if (nearestExit && hauler.pos && hauler.pos.getRangeTo(nearestExit) > 3) {
                        hauler.travelTo(nearestExit, 3);
                    }
                    // Within 3 of exit — hold position and wait for danger to clear
                }
                continue;
            }

            if (hauler.store?.energy && hauler.store.energy > 0 && hauler.creep?.getActiveBodyparts(WORK)) {
                const road = hauler.pos?.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax);
                if (road) hauler.repair(road);
            }

            if (hauler.task) continue;

            const mem = hauler.memory as any;
            if (hauler.store?.getUsedCapacity() === 0) mem.collecting = true;
            if (hauler.store?.getFreeCapacity() === 0) mem.collecting = false;

            const siteId = mem.state?.siteId;
            const site = this.sites.find(s => s.sourceId === siteId);

            if (mem.collecting) {
                if (hauler.room?.name !== this.targetRoom) {
                    hauler.travelTo(new RoomPosition(25, 25, this.targetRoom), 20);
                } else if (site?.containerId) {
                    hauler.setTask(new WithdrawTask(site.containerId));
                } else if (site?.source) {
                    const dropped = site.source.pos.findInRange(FIND_DROPPED_RESOURCES, 1).find(r => r.resourceType === RESOURCE_ENERGY && r.amount > 50);
                    if (dropped) hauler.setTask(new PickupTask(dropped.id as Id<Resource>));
                    else hauler.travelTo(site.source.pos, 3);
                }
            } else {
                // ── FIX: Integrate Returning Haulers with the Global Broker! ──
                if (hauler.room?.name === this.colony.name) {
                    const targetId = this.colony.logistics.matchTransfer(hauler as any);
                    if (targetId) {
                        hauler.setTask(new TransferTask(targetId as Id<Structure | Creep>));
                        continue;
                    }
                }

                const dropoff = this.colony.room?.storage || this.colony.room?.find(FIND_MY_SPAWNS)?.[0];
                if (dropoff) hauler.setTask(new TransferTask(dropoff.id as Id<Structure | Creep>));
            }
        }
    }
}
