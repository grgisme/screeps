// ============================================================================
// Colony — Central coordinator for a single owned room
// ============================================================================
//
// ⚠️ GETTER PATTERN (V8 MEMORY LEAK PREVENTION)
// ══════════════════════════════════════════════
// Colony persists in the Global Heap. NEVER cache live `Room` or `Creep[]`.
// Use getters that resolve from `Game.rooms` / `Room.find()` each tick.
// ============================================================================

import type { Overlord } from "../overlords/Overlord";
import { Zerg } from "../zerg/Zerg";
import { MiningOverlord } from "../overlords/MiningOverlord";
import { TransporterOverlord } from "../overlords/TransporterOverlord";
import { ConstructionOverlord } from "../overlords/ConstructionOverlord";
import { WorkerOverlord } from "../overlords/WorkerOverlord";
import { UpgradingOverlord } from "../overlords/UpgradingOverlord";
import { TerminalOverlord } from "../overlords/TerminalOverlord";
import { DefenseOverlord } from "../overlords/DefenseOverlord";
import { FillerOverlord } from "../overlords/FillerOverlord";
import { BootstrappingOverlord } from "../overlords/BootstrappingOverlord";
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { LinkNetwork } from "./LinkNetwork";
import { LogisticsNetwork } from "./LogisticsNetwork";
import { Hatchery } from "./Hatchery";
import { Directive } from "../directives/Directive";
import { HarvestDirective } from "../directives/HarvestDirective";
import { GuardDirective } from "../directives/GuardDirective";
import { AttackDirective } from "../directives/AttackDirective";
import { ColonizeDirective } from "../directives/ColonizeDirective";

export interface ColonyMemory {
    anchor?: { x: number, y: number };
    lastRcl?: number;
}

export interface ColonyState {
    rclChanged: boolean;
    /**
     * True when the colony is critically destabilized:
     * fewer than 2 energy-extracting creeps (miners + workers) AND
     * room energy < 25% capacity, OR zero extractors entirely.
     * Used to trigger preemptive safe mode and BootstrappingOverlord.
     */
    isCriticalBlackout: boolean;
}

export class Colony {
    name: string;
    memory: ColonyMemory;
    state: ColonyState;
    overlords: Overlord[] = [];
    directives: Directive[] = [];
    zergs: Map<string, Zerg> = new Map();
    logistics: LogisticsNetwork;
    linkNetwork: LinkNetwork;
    hatchery: Hatchery;

    /**
     * Deterministic refill order: spawn at [0], then extensions sorted by
     * ascending range to spawn. Cached and invalidated on structure count change.
     */
    refillOrder: Id<StructureSpawn | StructureExtension>[] = [];
    private _refillStructCount = -1;

    constructor(roomName: string) {
        this.name = roomName;

        // Init memory
        if (!(Memory as any).colonies) (Memory as any).colonies = {};
        if (!(Memory as any).colonies[this.name]) (Memory as any).colonies[this.name] = {};
        this.memory = (Memory as any).colonies[this.name];

        this.state = { rclChanged: true, isCriticalBlackout: false };

        this.logistics = new LogisticsNetwork(this);
        this.linkNetwork = new LinkNetwork(this);
        this.hatchery = new Hatchery(this);

        if (this.room) {
            this.initOverlords();
            this.initDirectives();
        }
    }

    // -----------------------------------------------------------------------
    // Getters — resolve live Game objects each tick (no V8 leaks)
    // -----------------------------------------------------------------------

    private _creeps?: Creep[];
    private _creepsTick?: number;

    /** Resolve the live Room from Game.rooms. Returns undefined if not visible. */
    get room(): Room | undefined {
        return Game.rooms[this.name];
    }

    /** Find all owned creeps in this colony (Memoized per-tick to save CPU) */
    get creeps(): Creep[] {
        if (this._creepsTick !== Game.time) {
            // ── FIX: Global scan filtered by memory prevents remote creeps from vanishing ──
            this._creeps = Object.values(Game.creeps).filter(c => c.memory?.colony === this.name);
            this._creepsTick = Game.time;
        }
        return this._creeps!;
    }

    // -----------------------------------------------------------------------
    // Overlord Management
    // -----------------------------------------------------------------------

    private initOverlords(): void {
        // BootstrappingOverlord registered first — runs before all others
        // so recovery requests are enqueued at priority 999 before anything else.
        this.registerOverlord(new BootstrappingOverlord(this));
        this.registerOverlord(new ConstructionOverlord(this));
        this.registerOverlord(new MiningOverlord(this));
        this.registerOverlord(new TransporterOverlord(this));

        this.registerOverlord(new WorkerOverlord(this));
        this.registerOverlord(new UpgradingOverlord(this));
        this.registerOverlord(new FillerOverlord(this));
        this.registerOverlord(new TerminalOverlord(this));
        this.registerOverlord(new DefenseOverlord(this));
    }

    registerOverlord(overlord: Overlord): void {
        this.overlords.push(overlord);
    }

    // -----------------------------------------------------------------------
    // Zerg Management
    // -----------------------------------------------------------------------

    registerZerg(creep: Creep): Zerg {
        let zerg = this.zergs.get(creep.name);
        if (!zerg) {
            zerg = new Zerg(creep.name);
            this.zergs.set(creep.name, zerg);
        }
        return zerg;
    }

    getZerg(name: string): Zerg | undefined {
        return this.zergs.get(name);
    }

    // -----------------------------------------------------------------------
    // Refresh — called each tick before run()
    // -----------------------------------------------------------------------

    refresh(): void {
        this.logistics.refresh();
        this.hatchery.refresh();
        if (this.linkNetwork) this.linkNetwork.refresh();

        if (!this.room) return;

        // Detect RCL change
        if (this.room.controller) {
            const currentRcl = this.room.controller.level;
            if (this.memory.lastRcl !== currentRcl) {
                this.state.rclChanged = true;
                this.memory.lastRcl = currentRcl;
            }
        }

        // ── Blackout Detection (Protocol Layer 1) ────────────────────────────
        // Fires early — when destabilized — not just at total collapse.
        // Condition: 0 extractors entirely, OR fewer than 2 combined AND low energy.
        const extractors = this.creeps.filter(
            c => (c.memory as any).role === 'miner' || (c.memory as any).role === 'worker'
        );
        const room = this.room;
        const lowEnergy = room.energyAvailable < room.energyCapacityAvailable * 0.25;
        this.state.isCriticalBlackout = extractors.length === 0 ||
            (extractors.length < 2 && lowEnergy);

        // ── Deterministic Refill Order (Protocol Layer 3) ────────────────────
        // Spawn is always index[0]. Extensions sorted ascending by range to spawn.
        // Invalidated when structure count changes (new extension built, etc.).
        const structCount = room.find(FIND_MY_STRUCTURES).length;
        if (this.refillOrder.length === 0 || this._refillStructCount !== structCount) {
            this._refillStructCount = structCount;
            const spawns = room.find(FIND_MY_SPAWNS);
            const extensions = room.find(FIND_MY_STRUCTURES, {
                filter: (s: Structure) => s.structureType === STRUCTURE_EXTENSION
            }) as StructureExtension[];

            const spawnIds = spawns.map(s => s.id) as Id<StructureSpawn | StructureExtension>[];
            const anchor = spawns[0];
            const extIds = anchor
                ? extensions
                    .sort((a, b) => anchor.pos.getRangeTo(a) - anchor.pos.getRangeTo(b))
                    .map(e => e.id as Id<StructureSpawn | StructureExtension>)
                : extensions.map(e => e.id as Id<StructureSpawn | StructureExtension>);

            this.refillOrder = [...spawnIds, ...extIds];
        }

        // Prune dead zergs
        for (const [name, zerg] of this.zergs.entries()) {
            if (!zerg.isAlive()) {
                this.zergs.delete(name);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Directives
    // -----------------------------------------------------------------------

    private initDirectives(): void {
        if (!Game.flags) return;

        // Flag prefix → Directive class mapping
        const DIRECTIVE_MAP: { prefix: string; factory: (flag: Flag, colony: Colony) => Directive }[] = [
            { prefix: "inc:", factory: (f, c) => new HarvestDirective(f, c) },
            { prefix: "guard:", factory: (f, c) => new GuardDirective(f, c) },
            { prefix: "atk:", factory: (f, c) => new AttackDirective(f, c) },
            { prefix: "claim:", factory: (f, c) => new ColonizeDirective(f, c) },
        ];

        for (const name in Game.flags) {
            for (const { prefix, factory } of DIRECTIVE_MAP) {
                if (name.startsWith(prefix)) {
                    const existing = this.directives.find(d => d.flagName === name);
                    if (!existing) {
                        const flag = Game.flags[name];
                        const directive = factory(flag, this);
                        this.directives.push(directive);
                    }
                    break; // Only one prefix can match
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Main Loop
    // -----------------------------------------------------------------------

    run(): void {
        if (!this.room) return;

        for (const directive of this.directives) {
            directive.init();
        }

        for (const overlord of this.overlords) {
            overlord.init();
        }
        this.logistics.init();

        for (const directive of this.directives) {
            directive.run();
        }

        for (const overlord of this.overlords) {
            overlord.run();
        }

        this.hatchery.run();

        for (const zerg of this.zergs.values()) {
            zerg.run();
        }

        if (this.linkNetwork) {
            this.linkNetwork.init();
            this.linkNetwork.run();
        }
    }

    showPlan(): string {
        if (!this.memory.anchor) return "No anchor set.";
        const anchor = new RoomPosition(this.memory.anchor.x, this.memory.anchor.y, this.name);

        const visual = new RoomVisual(this.name);
        for (const type of Object.keys(BunkerLayout.structures) as StructureConstant[]) {
            const coords = BunkerLayout.structures[type] || [];
            for (const rel of coords) {
                const pos = BunkerLayout.getPos(anchor, rel);
                visual.text(type[0].toUpperCase(), pos.x, pos.y, { font: 0.5, color: '#ffffff' });
            }
        }
        return `Visualizing plan for ${this.name}`;
    }
}
