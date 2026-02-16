/**
 * MiningOverlord — Manages static mining for a Colony.
 *
 * Responsibilities:
 *   1. Identify all Sources in the room
 *   2. Calculate ideal miner body (enough WORK parts for max throughput)
 *   3. Assign one Zerg per Source to a specific mining position
 *   4. Request replacements when miners are about to die
 *
 * Mining Sites are stored in the Heap to avoid conflicts:
 *   Each Source maps to a specific container position where the miner sits.
 *   No two Zergs will ever be assigned to the same spot.
 */
import { Overlord, SpawnRequest } from "./Overlord";
import { Zerg } from "../wrappers/Zerg";
import { Task } from "../tasks/Task";
import { heap } from "../os/Heap";

/** Heap-cached mining site data */
interface MiningSite {
    sourceId: Id<Source>;
    sourcePos: { x: number, y: number, roomName: string };
    containerId?: Id<StructureContainer>;
    containerPos?: { x: number, y: number, roomName: string };
    assignedZerg: string | null;   // Zerg name
    distanceToSpawn: number;
}

export class MiningOverlord extends Overlord {
    /** Mining sites (one per Source) */
    private sites: MiningSite[] = [];

    /** Desired WORK parts per source (5 for 3000e/300t throughput) */
    private readonly WORK_PER_SOURCE = 5;

    constructor(roomName: string) {
        super(`mining-${roomName}`, roomName, 1); // HIGH priority
    }

    // ─── SENSE ─────────────────────────────────────────────────────

    sense(): void {
        const room = this.room;
        if (!room) return;

        // Load or build mining sites
        const cacheKey = `mining-sites-${this.roomName}`;
        const cached = heap.getPersistent('mining', cacheKey) as MiningSite[] | undefined;

        if (cached && cached.length > 0) {
            this.sites = cached;
            // Refresh container IDs (they might have been built/destroyed)
            this.refreshContainers(room);
        } else {
            this.buildSites(room);
            heap.setPersistent('mining', cacheKey, this.sites);
        }

        // Validate assignments — clear dead zergs
        for (const site of this.sites) {
            if (site.assignedZerg && !Game.creeps[site.assignedZerg]) {
                site.assignedZerg = null;
                heap.markDirty();
            }
        }
    }

    /** Build mining sites from room Sources */
    private buildSites(room: Room): void {
        const sources = room.find(FIND_SOURCES);
        const spawns = room.find(FIND_MY_SPAWNS);
        const spawnPos = spawns.length > 0 ? spawns[0].pos : room.controller?.pos;

        this.sites = sources.map(source => {
            // Find container near source
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            }) as StructureContainer[];
            const container = containers[0];

            // Calculate distance to spawn
            const dist = spawnPos
                ? source.pos.getRangeTo(spawnPos)
                : 50;

            return {
                sourceId: source.id,
                sourcePos: { x: source.pos.x, y: source.pos.y, roomName: source.pos.roomName },
                containerId: container?.id,
                containerPos: container ? { x: container.pos.x, y: container.pos.y, roomName: container.pos.roomName } : undefined,
                assignedZerg: null,
                distanceToSpawn: dist,
            } as MiningSite;
        });
    }

    /** Refresh container IDs for existing sites */
    private refreshContainers(room: Room): void {
        for (const site of this.sites) {
            // Verify container still exists
            if (site.containerId) {
                const container = Game.getObjectById(site.containerId);
                if (!container) {
                    site.containerId = undefined;
                    site.containerPos = undefined;
                }
            }

            // Look for new containers if we don't have one
            if (!site.containerId) {
                const sourcePos = new RoomPosition(site.sourcePos.x, site.sourcePos.y, site.sourcePos.roomName);
                const containers = sourcePos.findInRange(FIND_STRUCTURES, 1, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER
                }) as StructureContainer[];

                if (containers.length > 0) {
                    site.containerId = containers[0].id;
                    site.containerPos = { x: containers[0].pos.x, y: containers[0].pos.y, roomName: containers[0].pos.roomName };
                    heap.markDirty();
                }
            }
        }
    }

    // ─── ASSIGN ────────────────────────────────────────────────────

    assign(): void {
        // Assign idle Zergs to unoccupied mining sites
        const idle = this.idleZergs;

        for (const site of this.sites) {
            if (idle.length === 0) break;

            // Skip already assigned sites
            if (site.assignedZerg) {
                const assignedZerg = this.zergs.find(z => z.name === site.assignedZerg);
                if (assignedZerg && assignedZerg.isIdle) {
                    // Reassign the task (it completed)
                    this.pushMiningTask(assignedZerg, site);
                }
                continue;
            }

            // Assign first idle Zerg to this site
            const zerg = idle.shift()!;
            site.assignedZerg = zerg.name;
            heap.markDirty();

            this.pushMiningTask(zerg, site);
        }
    }

    /** Push the appropriate mining task to a Zerg */
    private pushMiningTask(zerg: Zerg, site: MiningSite): void {
        const source = Game.getObjectById(site.sourceId);
        if (!source) return;

        // If container exists, go to container pos and harvest
        if (site.containerPos) {
            const containerPos = new RoomPosition(site.containerPos.x, site.containerPos.y, site.containerPos.roomName);

            // If not on container, move there first
            if (!zerg.pos.isEqualTo(containerPos)) {
                zerg.setTask(Task.moveTo(containerPos, 0));
            } else {
                // Sit and harvest
                zerg.setTask(Task.harvest(source));

                // If full and container exists, transfer
                if (zerg.store.getFreeCapacity() === 0 && site.containerId) {
                    const container = Game.getObjectById(site.containerId);
                    if (container) {
                        zerg.setTask(Task.transfer(container));
                    }
                }
            }
        } else {
            // No container — just go near and harvest (drop mining)
            zerg.setTask(Task.harvest(source));
        }
    }

    // ─── SPAWN REQUESTS ────────────────────────────────────────────

    getSpawnRequests(): SpawnRequest[] {
        const requests: SpawnRequest[] = [];
        const room = this.room;
        if (!room) return requests;

        for (const site of this.sites) {
            const needsReplacement = this.siteNeedsReplacement(site);
            if (!needsReplacement) continue;

            const body = this.buildMinerBody(room.energyCapacityAvailable);

            requests.push({
                overlord: this.pid,
                body,
                priority: 1, // HIGH
                memory: {
                    role: 'miner',
                    overlord: this.pid,
                    room: this.roomName,
                    working: false,
                    state: 0,
                    _miningTarget: site.sourceId,
                },
                label: `Miner→${site.sourceId.substring(0, 6)}`,
            });
        }

        return requests;
    }

    /** Check if a mining site needs a new or replacement Zerg */
    private siteNeedsReplacement(site: MiningSite): boolean {
        if (!site.assignedZerg) return true;

        const creep = Game.creeps[site.assignedZerg];
        if (!creep) return true;

        // Request replacement if miner is about to die
        // (distance * 3 for travel time buffer + 50 tick spawn time)
        const replacementThreshold = site.distanceToSpawn * 3 + 50;
        if (creep.ticksToLive && creep.ticksToLive < replacementThreshold) {
            return true;
        }

        return false;
    }

    /** Build the ideal miner body based on available energy */
    private buildMinerBody(energyCapacity: number): BodyPartConstant[] {
        // Ideal miner: 5W 1C 3M (700 energy) — sits on container
        // Minimum miner: 2W 1C 1M (300 energy) — for early game
        const body: BodyPartConstant[] = [];

        // At least 1 MOVE to get there
        let remaining = energyCapacity;

        // Add WORK parts (up to 5 for max source throughput)
        const workCount = Math.min(this.WORK_PER_SOURCE, Math.floor((remaining - 100) / 100));
        for (let i = 0; i < workCount; i++) {
            body.push(WORK);
            remaining -= 100;
        }

        // 1 CARRY to transfer to container
        if (remaining >= 50) {
            body.push(CARRY);
            remaining -= 50;
        }

        // MOVE parts (1 per 2 heavy parts for road travel)
        const heavyParts = body.filter(p => p !== MOVE).length;
        const moveCount = Math.max(1, Math.ceil(heavyParts / 2));
        for (let i = 0; i < moveCount && remaining >= 50; i++) {
            body.push(MOVE);
            remaining -= 50;
        }

        return body;
    }

    // ─── LIFECYCLE ─────────────────────────────────────────────────

    toString(): string {
        const assigned = this.sites.filter(s => s.assignedZerg).length;
        return `⛏️ Mining<${this.roomName}|${assigned}/${this.sites.length} sites>`;
    }
}
