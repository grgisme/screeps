
import { Colony } from "./Colony";
import { Logger } from "../../utils/Logger";

export class LinkNetwork {
    colony: Colony;
    sourceLinks: StructureLink[] = [];
    hubLink: StructureLink | null = null;
    controllerLink: StructureLink | null = null;
    receiverLinks: StructureLink[] = []; // Extensions, Towers, etc.

    private log: Logger;

    constructor(colony: Colony) {
        this.colony = colony;
        this.log = new Logger("LinkNetwork");
    }

    refresh(): void {
        this.sourceLinks = [];
        this.hubLink = null;
        this.controllerLink = null;
        this.receiverLinks = [];

        if (!this.colony.room) return;

        const links = this.colony.room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK
        }) as StructureLink[];

        if (links.length === 0) return;

        const storage = this.colony.room.storage;
        const controller = this.colony.room.controller;
        const sources = this.colony.room.find(FIND_SOURCES);

        for (const link of links) {
            let assigned = false;

            // 1. Hub Link (Range <= 2 to Storage)
            if (storage && link.pos.getRangeTo(storage) <= 2) {
                this.hubLink = link;
                assigned = true;
            }

            // 2. Source Links (Range <= 2 to Source)
            if (!assigned) {
                for (const source of sources) {
                    if (link.pos.getRangeTo(source) <= 2) {
                        this.sourceLinks.push(link);
                        assigned = true;
                        break;
                    }
                }
            }

            // 3. Controller Link (Range <= 3 to Controller)
            if (!assigned && controller && link.pos.getRangeTo(controller) <= 3) {
                this.controllerLink = link;
                assigned = true;
            }

            // 4. Receiver Links (Everything else - usually near extensions/towers)
            if (!assigned) {
                this.receiverLinks.push(link);
            }
        }
    }

    init(): void {
        if (Game.time % 100 === 0 && this.sourceLinks.length > 0) {
            this.log.info(`[${this.colony.name}] Network: ${this.sourceLinks.length} Src, ${this.hubLink ? 1 : 0} Hub, ${this.controllerLink ? 1 : 0} Ctrl, ${this.receiverLinks.length} Recv`);
        }
    }

    run(): void {
        if (!this.colony.room) return;

        // 1. Collection Phase: Source -> Hub
        for (const sourceLink of this.sourceLinks) {
            if (sourceLink.cooldown > 0) continue;
            if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 750) {
                // If Hub exists and has space, send to Hub
                if (this.hubLink && this.hubLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 750) {
                    sourceLink.transferEnergy(this.hubLink);
                    continue;
                }

                // Fallback: Send to Controller if empty-ish
                if (this.controllerLink && this.controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400) {
                    sourceLink.transferEnergy(this.controllerLink);
                    continue;
                }
            }
        }

        // 2. Distribution Phase: Hub -> Receivers/Controller
        if (this.hubLink && this.hubLink.cooldown === 0 && this.hubLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            // Priority 1: Receivers (Towers/Extensions)
            // Ideally we'd distinguish Tower links from Extension links, but simple proximity/memory checks usually suffice
            // For now, treat all 'receiverLinks' as high priority if empty
            for (const receiver of this.receiverLinks) {
                if (receiver.store.getUsedCapacity(RESOURCE_ENERGY) < 400) {
                    this.hubLink.transferEnergy(receiver);
                    return; // Only one transfer per tick
                }
            }

            // Priority 2: Controller Link
            if (this.controllerLink && this.controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400) { // Keep it topped up but not necessarily FULL full
                this.hubLink.transferEnergy(this.controllerLink);
                return;
            }
        }
    }
}
