// ============================================================================
// Colony — Room Brain
// ============================================================================

import { Overlord } from "./processes/Overlord";
import { Zerg } from "./infrastructure/Zerg";
import { MiningOverlord } from "../processes/overlords/MiningOverlord";

export class Colony {
    name: string;
    room: Room;
    overlords: Overlord[] = [];
    zergs: Map<string, Zerg> = new Map();

    constructor(roomName: string) {
        this.name = roomName;
        this.room = Game.rooms[roomName];
        if (this.room) {
            this.scan();
        }
    }

    scan(): void {
        // Instantiate MiningOverlords for sources
        const sources = this.room.find(FIND_SOURCES);
        for (const source of sources) {
            // Check if we already have an overlord for this source
            const id = `mining:${this.name}:${source.id}`;
            if (!this.overlords.find(o => o.processId === id)) {
                this.registerOverlord(new MiningOverlord(this, source));
            }
        }
    }

    /** Refresh room object and zergs at start of tick */
    refresh(): void {
        this.room = Game.rooms[this.name];
        if (!this.room) return;

        // Refresh existing zergs
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
        const zerg = new Zerg(creep);
        this.zergs.set(creep.name, zerg);
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

        for (const overlord of this.overlords) {
            overlord.run();
        }

        for (const zerg of this.zergs.values()) {
            zerg.run();
        }
    }
}
