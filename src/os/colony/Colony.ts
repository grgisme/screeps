// import type { Overlord } from "../overlords/Overlord";
import { Zerg } from "../zerg/Zerg";
import { MiningOverlord } from "../overlords/MiningOverlord";
import { ConstructionOverlord } from "../overlords/ConstructionOverlord";
import { WorkerOverlord } from "../overlords/core/WorkerOverlord";
import { UpgradingOverlord } from "../overlords/core/UpgradingOverlord";
import { TerminalOverlord } from "../overlords/economy/TerminalOverlord";
import { DefenseOverlord } from "../overlords/core/defense/DefenseOverlord";
import { BunkerLayout } from "../infrastructure/BunkerLayout";
import { LinkNetwork } from "./LinkNetwork";
import { LogisticsNetwork } from "./LogisticsNetwork";
import { Hatchery } from "./Hatchery";
import { Directive } from "../directives/Directive";
import { HarvestDirective } from "../directives/resource/HarvestDirective";

export interface ColonyMemory {
    anchor?: { x: number, y: number };
}

export interface ColonyState {
    rclChanged: boolean;
}

export class Colony {
    name: string;
    room: Room;
    memory: ColonyMemory;
    state: ColonyState;
    overlords: any[] = [];
    creeps: Creep[] = [];
    directives: Directive[] = [];
    zergs: Map<string, Zerg> = new Map();
    logistics: LogisticsNetwork;
    linkNetwork: LinkNetwork;
    hatchery: Hatchery;

    constructor(roomName: string) {
        this.name = roomName;
        this.room = Game.rooms[roomName];

        // Init memory
        if (!(Memory as any).colonies) (Memory as any).colonies = {};
        if (!(Memory as any).colonies[this.name]) (Memory as any).colonies[this.name] = {};
        this.memory = (Memory as any).colonies[this.name];

        this.state = { rclChanged: true };

        if (this.room) {
            this.scan();
            this.logistics = new LogisticsNetwork(this);
            this.linkNetwork = new LinkNetwork(this);
            this.hatchery = new Hatchery(this);
            this.initOverlords();
            this.initDirectives();
        } else {
            this.logistics = new LogisticsNetwork(this);
            this.linkNetwork = new LinkNetwork(this);
            this.hatchery = new Hatchery(this);
        }
    }

    private initOverlords(): void {
        this.registerOverlord(new ConstructionOverlord(this));
        this.registerOverlord(new MiningOverlord(this));

        this.registerOverlord(new WorkerOverlord(this));
        this.registerOverlord(new UpgradingOverlord(this));
        this.registerOverlord(new TerminalOverlord(this));
        this.registerOverlord(new DefenseOverlord(this));
    }

    scan(): void {
        this.creeps = this.room ? this.room.find(FIND_MY_CREEPS) : [];
        if (this.linkNetwork) this.linkNetwork.refresh();
    }

    refresh(): void {
        this.room = Game.rooms[this.name];
        this.logistics.refresh();
        this.hatchery.refresh();
        this.scan();

        if (this.room && this.room.controller) {
            // Check RCL logic here
        }

        if (!this.room) return;

        for (const [name, zerg] of this.zergs.entries()) {
            if (!zerg.isAlive()) {
                this.zergs.delete(name);
            }
        }
    }

    registerOverlord(overlord: any): void {
        this.overlords.push(overlord);
    }

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
