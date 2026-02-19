// ============================================================================
// LinkNetwork — Manages inter-link energy transfers
// ============================================================================
//
// ⚠️ GETTER PATTERN (V8 MEMORY LEAK PREVENTION)
// ══════════════════════════════════════════════
// LinkNetwork persists in the Global Heap (owned by Colony).
// NEVER cache live StructureLink objects. Store IDs only.
// ============================================================================

import type { Colony } from "./Colony";
import { Logger } from "../../utils/Logger";

export class LinkNetwork {
    colony: Colony;

    // ── Stored IDs only — never live Game objects ──────────────────────
    sourceLinkIds: Id<StructureLink>[] = [];
    hubLinkId?: Id<StructureLink>;
    controllerLinkId?: Id<StructureLink>;
    receiverLinkIds: Id<StructureLink>[] = [];

    private log: Logger;

    constructor(colony: Colony) {
        this.colony = colony;
        this.log = new Logger("LinkNetwork");
    }

    // -----------------------------------------------------------------------
    // Getters — resolve live Game objects each tick (no heap leak)
    // -----------------------------------------------------------------------

    get sourceLinks(): StructureLink[] {
        return this.sourceLinkIds
            .map(id => Game.getObjectById(id))
            .filter((l): l is StructureLink => l !== null);
    }

    get hubLink(): StructureLink | null {
        return this.hubLinkId ? Game.getObjectById(this.hubLinkId) : null;
    }

    get controllerLink(): StructureLink | null {
        return this.controllerLinkId ? Game.getObjectById(this.controllerLinkId) : null;
    }

    get receiverLinks(): StructureLink[] {
        return this.receiverLinkIds
            .map(id => Game.getObjectById(id))
            .filter((l): l is StructureLink => l !== null);
    }

    // -----------------------------------------------------------------------
    // Refresh — throttled layout discovery (every 50 ticks)
    // -----------------------------------------------------------------------

    refresh(): void {
        if (Game.time % 50 !== 0) return;

        this.sourceLinkIds = [];
        this.hubLinkId = undefined;
        this.controllerLinkId = undefined;
        this.receiverLinkIds = [];

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
                this.hubLinkId = link.id;
                assigned = true;
            }

            // 2. Source Links (Range <= 2 to Source)
            if (!assigned) {
                for (const source of sources) {
                    if (link.pos.getRangeTo(source) <= 2) {
                        this.sourceLinkIds.push(link.id);
                        assigned = true;
                        break;
                    }
                }
            }

            // 3. Controller Link (Range <= 3 to Controller)
            if (!assigned && controller && link.pos.getRangeTo(controller) <= 3) {
                this.controllerLinkId = link.id;
                assigned = true;
            }

            // 4. Receiver Links (Everything else)
            if (!assigned) {
                this.receiverLinkIds.push(link.id);
            }
        }
    }

    init(): void {
        const sourceLinks = this.sourceLinks;
        if (Game.time % 100 === 0 && sourceLinks.length > 0) {
            this.log.info(`[${this.colony.name}] Network: ${sourceLinks.length} Src, ${this.hubLink ? 1 : 0} Hub, ${this.controllerLink ? 1 : 0} Ctrl, ${this.receiverLinks.length} Recv`);
        }
    }

    run(): void {
        if (!this.colony.room) return;

        const hubLink = this.hubLink;
        const controllerLink = this.controllerLink;

        // 1. Collection Phase: Source -> Hub
        for (const sourceLink of this.sourceLinks) {
            if (sourceLink.cooldown > 0) continue;
            if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 750) {
                // If Hub exists and has space, send to Hub
                if (hubLink && hubLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 750) {
                    sourceLink.transferEnergy(hubLink);
                    continue;
                }

                // Fallback: Send to Controller if empty-ish
                if (controllerLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400) {
                    sourceLink.transferEnergy(controllerLink);
                    continue;
                }
            }
        }

        // 2. Distribution Phase: Hub -> Receivers/Controller
        if (hubLink && hubLink.cooldown === 0 && hubLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            // Priority 1: Receivers (Towers/Extensions)
            for (const receiver of this.receiverLinks) {
                if (receiver.store.getUsedCapacity(RESOURCE_ENERGY) < 400) {
                    hubLink.transferEnergy(receiver);
                    return; // Only one transfer per tick
                }
            }

            // Priority 2: Controller Link
            if (controllerLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < 400) {
                hubLink.transferEnergy(controllerLink);
                return;
            }
        }
    }
}
