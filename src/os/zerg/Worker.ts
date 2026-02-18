import { Zerg } from "./Zerg";
// import { Overlord } from "../overlords/Overlord";

export class Worker extends Zerg {
    overlord: any; // Type as any to avoid circular dependency for now

    constructor(creepName: string) {
        super(creepName);
    }

    run(): void {
        if (!this.isAlive()) return;
        const creep = this.creep!;
        const mem = this.memory!;

        // State machine: Harvest/Refuel <-> Work
        if (creep.store.getUsedCapacity() === 0) {
            mem.working = false;
        } else if (creep.store.getFreeCapacity() === 0) {
            mem.working = true;
        }

        if (mem.working) {
            this.work();
        } else {
            this.refuel();
        }
    }

    private refuel(): void {
        const creep = this.creep!;
        const room = creep.room;
        const mem = this.memory as any;

        // Clear source lock when full
        if (creep.store.getFreeCapacity() === 0) {
            delete mem._lockedSourceId;
            delete mem._refuelTicks;
            return;
        }

        // Stuck Detection: if refueling for 15+ ticks with 0 energy, clear lock and unstick
        if (creep.store.getUsedCapacity() === 0) {
            mem._refuelTicks = (mem._refuelTicks || 0) + 1;
            if (mem._refuelTicks > 15) {
                creep.say("⛔ Reset");
                delete mem._lockedSourceId;
                const dirs: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
                creep.move(dirs[Math.floor(Math.random() * dirs.length)]);
                mem._refuelTicks = 0;
                return;
            }
        } else {
            mem._refuelTicks = 0;
        }

        // 0. Early-Game Bypass: If there are NO containers and NO storage,
        //    skip all logistics and harvest directly from sources.
        const hasInfrastructure = room.storage ||
            room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.energy > 0
            }).length > 0;

        if (!hasInfrastructure) {
            this.harvestFromSource(mem);
            return;
        }

        // 1. Standard Logistics: withdraw from Storage or Containers
        if (room.storage && room.storage.store.energy > 0) {
            creep.say("🏦");
            if (creep.withdraw(room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.travelTo(room.storage);
            }
            return;
        }

        const container = this.pos!.findClosestByRange(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.energy > 0
        }) as StructureContainer | null;
        if (container) {
            creep.say("📦");
            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.travelTo(container);
            }
            return;
        }

        // 2. Fallback: all containers are empty, harvest from source
        this.harvestFromSource(mem);
    }

    /**
     * Harvest from a locked source. If no lock exists, find and lock one.
     * Force harvest if adjacent. Travel otherwise.
     */
    private harvestFromSource(mem: any): void {
        const creep = this.creep!;
        // Resolve locked source
        let source: Source | null = null;

        if (mem._lockedSourceId) {
            source = Game.getObjectById(mem._lockedSourceId as Id<Source>);
            // Validate: source must exist, be in this room, and have energy
            if (!source || source.pos.roomName !== this.room!.name || source.energy === 0) {
                delete mem._lockedSourceId;
                source = null;
            }
        }

        // No lock or lock invalidated — find and lock a new source
        if (!source) {
            source = this.findOptimalSource();
            if (source) {
                mem._lockedSourceId = source.id;
            }
        }

        if (!source) {
            creep.say("💤");
            return;
        }

        creep.say("⛏️ S" + source.id.slice(-2));

        // Force harvest: if adjacent, harvest immediately — no movement
        if (this.pos!.isNearTo(source)) {
            creep.harvest(source);
            return;
        }

        // Not adjacent — travel to source
        this.travelTo(source);
    }

    /**
     * Find the best source to harvest from, distributing workers evenly.
     * Strictly filters to current room only.
     * Picks the source with the fewest creeps nearby.
     * Tie-break: closest by range.
     */
    private findOptimalSource(): Source | null {
        // FIND_SOURCES: includes depleted sources. Filter to current room + energy > 0.
        const sources = this.room!.find(FIND_SOURCES).filter(s => s.energy > 0);
        if (sources.length === 0) return null;
        if (sources.length === 1) return sources[0];

        let best: Source | null = null;
        let bestScore = Infinity;
        let bestRange = Infinity;

        for (const source of sources) {
            const nearbyCreeps = source.pos.findInRange(FIND_MY_CREEPS, 1).length;
            const range = this.pos!.getRangeTo(source);

            if (nearbyCreeps < bestScore || (nearbyCreeps === bestScore && range < bestRange)) {
                best = source;
                bestScore = nearbyCreeps;
                bestRange = range;
            }
        }

        return best;
    }

    private work(): void {
        const creep = this.creep!;
        const room = creep.room;

        // 1. CRITICAL: Build container sites FIRST (Genesis Build Order)
        //    Without containers, mining stays suspended → workers keep spawning → stagnation
        const containerSite = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
        })[0];
        if (containerSite) {
            creep.say("📦🔨");
            if (creep.build(containerSite) === ERR_NOT_IN_RANGE) {
                this.travelTo(containerSite);
            }
            return;
        }

        // 2. Fill Spawns/Extensions (keep energy flowing for spawning)
        if (room.energyAvailable < room.energyCapacityAvailable) {
            const target = this.pos!.findClosestByRange(FIND_MY_STRUCTURES, {
                filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            });
            if (target) {
                if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    this.travelTo(target);
                }
                return;
            }
        }

        // 3. Build Other Construction Sites (Prioritized by Overlord)
        const site = (this.overlord as any).getBestConstructionSite();
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                this.travelTo(site);
            }
            return;
        }

        // 4. Repair Critical Structures (Roads < 75%, Containers < 100%)
        const structure = this.pos!.findClosestByRange(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.75) ||
                (s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax)
        });
        if (structure) {
            if (creep.repair(structure) === ERR_NOT_IN_RANGE) {
                this.travelTo(structure);
            }
            return;
        }

        // 5. Upgrade Controller (Default)
        if (room.controller) {
            if (creep.upgradeController(room.controller) === ERR_NOT_IN_RANGE) {
                this.travelTo(room.controller, 3);
            }
        }
    }
}
