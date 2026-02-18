import { Overlord } from "../../Overlord";
import type { Colony } from "../../../colony/Colony";
import { CombatZerg } from "../../../zerg/CombatZerg";
import { Logger } from "../../../../utils/Logger";

const log = new Logger("DefenseOverlord");

export class DefenseOverlord extends Overlord {
    towers: StructureTower[] = [];
    defenders: CombatZerg[] = [];

    constructor(colony: Colony) {
        super(colony, "defense");
    }

    init(): void {
        this.defenders = this.zergs.map(z => new CombatZerg(z.creep));

        const room = this.colony.room;
        if (!room) return;

        this.towers = room.find(FIND_MY_STRUCTURES, {
            filter: (s: AnyOwnedStructure) => s.structureType === STRUCTURE_TOWER
        }) as StructureTower[];

        // Ensure Memory.rooms structure exists
        if (!Memory.rooms) Memory.rooms = {};
        if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;

        // 1. Detect Hostiles
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            if (!Memory.rooms[room.name].isDangerous) {
                log.alert(`defense-${room.name}`, `Hostiles detected in ${room.name}! Activating Defense Protocols.`);
                Memory.rooms[room.name].isDangerous = true;
            }
            Memory.rooms[room.name].dangerUntil = Game.time + 100;

            // 2. Spawn Logic
            // If dangerous, ensure we have defenders.
            // Cap at 2 defenders for now.
            if (this.defenders.length < 2) {
                this.colony.hatchery.enqueue({
                    priority: 100, // High priority
                    // Defender Body: Ranged + Healer + Move
                    // Cost: 200 (Move/Ranged) + 300 (Move/Heal)
                    // RCL 5 Energy: ~1800-2300 available usually
                    // Template: [TOUGH, MOVE, RANGED_ATTACK, MOVE, HEAL, MOVE]
                    bodyTemplate: [
                        TOUGH, TOUGH, MOVE, MOVE,
                        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE,
                        HEAL, MOVE
                    ],
                    overlord: this,
                    name: `defender_${Game.time}`,
                    memory: { role: "defender" }
                });
            }

        } else {
            if (Memory.rooms[room.name].isDangerous && Game.time > (Memory.rooms[room.name].dangerUntil || 0)) {
                delete Memory.rooms[room.name].isDangerous;
                delete Memory.rooms[room.name].dangerUntil;
                log.info(`Room ${room.name} is safe.`);
            }
        }
    }

    run(): void {
        const room = this.colony.room;
        if (!room) return;

        const hostiles = room.find(FIND_HOSTILE_CREEPS);

        // 1. Tower Logic (Quantitative)
        // const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }) as StructureTower[];

        if (this.towers.length > 0 && hostiles.length > 0) {
            // Find best target: closest, or lowest health?
            // "Anti-Drainer": Check active healing vs tower damage

            for (const tower of this.towers) {
                const target = tower.pos.findClosestByRange(hostiles);
                if (target && "getActiveBodyparts" in target) {
                    // Calc Heal Power
                    const healParts = target.getActiveBodyparts(HEAL);
                    // Boosts not calc'd yet (assume raw)
                    const potentialHeal = healParts * 12;

                    // Calc Tower Damage
                    // Falloff: 600 at range <= 5, down to 150 at range >= 20
                    const range = tower.pos.getRangeTo(target);
                    let damage = 600;
                    if (range > 20) damage = 150;
                    else if (range > 5) {
                        damage = 600 - (range - 5) * (450 / 15);
                    }

                    // Firing Condition
                    if (damage > potentialHeal && target.hits < target.hitsMax) {
                        // Kill shot or effective damage
                        // Actually, if damage > heal, we technically slowly win. 
                        // But drainers rely on damage < heal.
                        tower.attack(target);
                    } else if (target.hits < target.hitsMax) {
                        // If they are damaged, keep pressure? 
                        // Or hold fire to save energy?
                        // If damage <= potentialHeal, they will just heal it back.
                        // UNLESS we check aggregate tower damage (all towers focused).

                        // For Phase 1, simpler: Fire if damage > potentialHeal.
                        // Or fire if we have excess energy.
                        if (tower.store.getUsedCapacity(RESOURCE_ENERGY) > 500) {
                            tower.attack(target);
                        }
                    } else if (damage > potentialHeal) {
                        tower.attack(target);
                    }
                }
            }
        } else {
            // Repair duty if no hostiles (low priority)
            // ... implemented elsewhere or passive?
        }

        // 2. Defender Logic
        for (const defender of this.defenders) {
            if (hostiles.length > 0) {
                defender.autoEngage(hostiles);
            } else {
                if (room.storage) defender.travelTo(room.storage.pos, 3);
            }
        }
    }
}
