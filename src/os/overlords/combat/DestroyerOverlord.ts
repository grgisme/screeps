
import { Overlord } from "../Overlord";
import type { Colony } from "../../colony/Colony";
import { CombatZerg } from "../../zerg/CombatZerg";
import { Logger } from "../../../utils/Logger";

const log = new Logger("DestroyerOverlord");

export class DestroyerOverlord extends Overlord {
    destroyers: CombatZerg[] = [];
    targetRoom: string;

    constructor(colony: Colony, targetRoom: string) {
        super(colony, `destroyer_${targetRoom}`);
        this.targetRoom = targetRoom;
    }

    init(): void {
        this.destroyers = this.zergs.map(z => new CombatZerg(z.creepName));

        // Spawn 1 Destroyer
        if (this.destroyers.length < 1) {
            this.colony.hatchery.enqueue({
                priority: 80,
                // Tougher body for remote ops
                bodyTemplate: [
                    TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE,
                    ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE,
                    HEAL, MOVE
                ],
                overlord: this,
                name: `destroyer_${this.targetRoom}_${Game.time}`,
                memory: { role: "destroyer" }
            });
        }
    }

    run(): void {
        for (const destroyer of this.destroyers) {
            this.handleDestroyer(destroyer);
        }
    }

    private handleDestroyer(zerg: CombatZerg): void {
        if (!zerg.isAlive()) return;
        const creep = zerg.creep!;

        // 1. Retreat Logic
        if (creep.hits < creep.hitsMax * 0.5) {
            // Retreat to home room
            const home = Game.rooms[this.colony.name];
            if (home && home.storage) {
                zerg.travelTo(home.storage, 5); // Go heal at home
                // Self healing happens in autoEngage or implicit tick? 
                // CombatZerg needs a manual heal call if not calling autoEngage.
                if (creep.getActiveBodyparts(HEAL) > 0) creep.heal(creep);
                return;
            }
        }

        // 2. Travel to Target Room
        if (creep.room.name !== this.targetRoom) {
            zerg.travelTo(new RoomPosition(25, 25, this.targetRoom), 20); // Go to center
            if (creep.getActiveBodyparts(HEAL) > 0 && creep.hits < creep.hitsMax) creep.heal(creep);
            return;
        }

        // 3. Engage Hostiles
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
        const structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_INVADER_CORE || s.structureType === STRUCTURE_TOWER
        });

        const targets = [...hostiles, ...structures];

        if (targets.length > 0) {
            zerg.autoEngage(targets as any[]);
        } else {
            // Idle or patrol?
            log.info("Target room clear.");
        }
    }
}
