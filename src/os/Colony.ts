import { Overlord } from "./processes/Overlord";
import { Zerg } from "./infrastructure/Zerg";
import { MiningOverlord } from "./processes/economy/MiningOverlord";
import { ConstructionOverlord } from "../processes/overlords/ConstructionOverlord";
import { BunkerLayout } from "./infrastructure/BunkerLayout";
import { LogisticsNetwork } from "./logistics/LogisticsNetwork";
import { Hatchery } from "./colony/Hatchery";

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
    overlords: Overlord[] = [];
    zergs: Map<string, Zerg> = new Map();
    logistics: LogisticsNetwork;
    hatchery: Hatchery;

    constructor(roomName: string) {
        this.name = roomName;
        this.room = Game.rooms[roomName];

        // Init memory (this should be backed by Room.memory or a separate segment)
        // For now, let's just alias Room.memory.colony if it exists, or create it.
        if (!(Memory as any).colonies) (Memory as any).colonies = {};
        if (!(Memory as any).colonies[this.name]) (Memory as any).colonies[this.name] = {};
        this.memory = (Memory as any).colonies[this.name];

        this.state = { rclChanged: true }; // Force check on init

        if (this.room) {
            this.scan();
            this.logistics = new LogisticsNetwork(this);
            this.hatchery = new Hatchery(this);
            this.initOverlords();
        } else {
            this.logistics = new LogisticsNetwork(this);
            this.hatchery = new Hatchery(this);
        }
    }

    private initOverlords(): void {
        this.registerOverlord(new ConstructionOverlord(this));
        this.registerOverlord(new MiningOverlord(this));
    }

    scan(): void {
        // MiningOverlord now manages sites internally
    }

    /** Refresh room object and zergs at start of tick */
    refresh(): void {
        this.room = Game.rooms[this.name];
        this.logistics.refresh();
        this.hatchery.refresh();

        // Detect RCL change
        if (this.room && this.room.controller) {
            // We can check previous RCL if we stored it in memory or state
            // For simplicity, ConstructionOverlord runs every 100 ticks OR on rclChanged.
            // We can rely on 100 ticks mostly.
        }

        if (!this.room) return;

        for (const zerg of this.zergs.values()) {
            zerg.refresh();
        }
    }

    /** Register an overlord */
    registerOverlord(overlord: Overlord): void {
        this.overlords.push(overlord);
    }

    /** Register a Zerg to the colony */
    registerZerg(creep: Creep): Zerg {
        let zerg = this.zergs.get(creep.name);
        if (!zerg) {
            zerg = new Zerg(creep);
            this.zergs.set(creep.name, zerg);
        }
        return zerg;
    }

    getZerg(name: string): Zerg | undefined {
        return this.zergs.get(name);
    }

    /** Run all overlords */
    run(): void {
        if (!this.room) return; // No visibility

        for (const overlord of this.overlords) {
            overlord.init();
        }
        this.logistics.init();

        for (const overlord of this.overlords) {
            overlord.run();
        }

        this.hatchery.run();

        for (const zerg of this.zergs.values()) {
            zerg.run();
        }
    }

    /** Visualizes the bunker layout */
    showPlan(): string {
        if (!this.memory.anchor) return "No anchor set.";
        const anchor = new RoomPosition(this.memory.anchor.x, this.memory.anchor.y, this.name);

        const visual = new RoomVisual(this.name);
        for (const type of Object.keys(BunkerLayout.structures) as StructureConstant[]) {
            const coords = BunkerLayout.structures[type] || [];
            for (const rel of coords) {
                const pos = BunkerLayout.getPos(anchor, rel);
                // visual.structure(pos.x, pos.y, type); // not standard
                visual.text(type[0].toUpperCase(), pos.x, pos.y, { font: 0.5, color: '#ffffff' });
            }
        }
        return `Visualizing plan for ${this.name}`;
    }
}
