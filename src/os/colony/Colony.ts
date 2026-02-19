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
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { LinkNetwork } from "./LinkNetwork";
import { LogisticsNetwork } from "./LogisticsNetwork";
import { Hatchery } from "./Hatchery";
import { Directive } from "../directives/Directive";
import { HarvestDirective } from "../directives/HarvestDirective";

export interface ColonyMemory {
    anchor?: { x: number, y: number };
    lastRcl?: number;
}

export interface ColonyState {
    rclChanged: boolean;
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

    constructor(roomName: string) {
        this.name = roomName;

        // Init memory
        if (!(Memory as any).colonies) (Memory as any).colonies = {};
        if (!(Memory as any).colonies[this.name]) (Memory as any).colonies[this.name] = {};
        this.memory = (Memory as any).colonies[this.name];

        this.state = { rclChanged: true };

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

    /** Resolve the live Room from Game.rooms. Returns undefined if not visible. */
    get room(): Room | undefined {
        return Game.rooms[this.name];
    }

    /** Find all owned creeps in this colony's room. */
    get creeps(): Creep[] {
        return this.room?.find(FIND_MY_CREEPS) ?? [];
    }

    // -----------------------------------------------------------------------
    // Overlord Management
    // -----------------------------------------------------------------------

    private initOverlords(): void {
        this.registerOverlord(new ConstructionOverlord(this));
        this.registerOverlord(new MiningOverlord(this));
        this.registerOverlord(new TransporterOverlord(this));

        this.registerOverlord(new WorkerOverlord(this));
        this.registerOverlord(new UpgradingOverlord(this));
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
        for (const name in Game.flags) {
            if (name.startsWith("inc:")) {
                const existing = this.directives.find(d => d.flag.name === name);
                if (!existing) {
                    const flag = Game.flags[name];
                    const directive = new HarvestDirective(flag, this);
                    this.directives.push(directive);
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
