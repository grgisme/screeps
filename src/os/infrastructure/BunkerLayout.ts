// ============================================================================
// BunkerLayout — Static definition of a 13x13 Bunker
// ============================================================================

export interface BuildingCoord {
    x: number;
    y: number;
}

export class BunkerLayout {
    // Relative to Anchor (0,0). Anchor is usually the center of the bunker.
    // However, for easier mapping to array indices or visualizers, we might keep it 0-12?
    // Let's use relative offsets from center (0,0).
    // range: -6 to +6.

    static getPos(anchor: RoomPosition, coord: BuildingCoord): RoomPosition {
        return new RoomPosition(anchor.x + coord.x, anchor.y + coord.y, anchor.roomName);
    }

    // Standard 13x13 layout (approximated for this implementation)
    // Core (Center): Terminal (0,0), Storage (0,-1), Link (0,1), Spawn (-1,0)

    // We will define structure counts per RCL via the filter in ConstructionOverlord.
    // Here we list ALL potential positions.

    static structures: { [key in StructureConstant]?: BuildingCoord[] } = {
        [STRUCTURE_SPAWN]: [
            { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -2 }
        ],
        [STRUCTURE_STORAGE]: [
            { x: 0, y: -1 }
        ],
        [STRUCTURE_TERMINAL]: [
            { x: 0, y: 0 } // Center
        ],
        [STRUCTURE_LINK]: [
            { x: 0, y: 1 } // Center link
            // Source links are handled separately by MiningOverlord usually, but Bunker might have one?
        ],
        [STRUCTURE_TOWER]: [
            { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
            { x: 0, y: -3 }, { x: 0, y: 3 }
        ],
        [STRUCTURE_EXTENSION]: [
            // Inner ring
            { x: -2, y: -1 }, { x: -2, y: 0 }, { x: -2, y: 1 },
            { x: 2, y: -1 }, { x: 2, y: 0 }, { x: 2, y: 1 },
            { x: -1, y: -2 }, { x: 0, y: -2 }, { x: 1, y: -2 },
            { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 },

            // X-shape arms (approximate classic bunker)
            { x: -3, y: -3 }, { x: -2, y: -3 }, { x: -3, y: -2 },
            { x: 3, y: -3 }, { x: 2, y: -3 }, { x: 3, y: -2 },
            { x: -3, y: 3 }, { x: -2, y: 3 }, { x: -3, y: 2 },
            { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 2 },

            // Filling out the 13x13 diamond/square
            { x: -4, y: 0 }, { x: 4, y: 0 }, { x: 0, y: -4 }, { x: 0, y: 4 },
            { x: -4, y: -1 }, { x: -4, y: 1 }, { x: 4, y: -1 }, { x: 4, y: 1 },
            { x: -1, y: -4 }, { x: 1, y: -4 }, { x: -1, y: 4 }, { x: 1, y: 4 },

            // More fillers to reach 60 extensions
            { x: -5, y: -2 }, { x: -5, y: 2 }, { x: 5, y: -2 }, { x: 5, y: 2 },
            { x: -2, y: -5 }, { x: 2, y: -5 }, { x: -2, y: 5 }, { x: 2, y: 5 }
        ],
        [STRUCTURE_ROAD]: [
            // Cross
            { x: 0, y: -5 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { x: 5, y: 0 },
            // ── FIX: Removed the {x: -1, y: -1} inner ring that overlapped with Towers ──
            { x: -2, y: -2 }, { x: 2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: 2 },
            { x: -3, y: -3 }, { x: 3, y: -3 }, { x: -3, y: 3 }, { x: 3, y: 3 },
            { x: -4, y: -4 }, { x: 4, y: -4 }, { x: -4, y: 4 }, { x: 4, y: 4 },
            // Ring roads (checkerboard style implication)
            { x: -3, y: -1 }, { x: -3, y: 0 }, { x: -3, y: 1 },
            { x: 3, y: -1 }, { x: 3, y: 0 }, { x: 3, y: 1 },
            { x: -1, y: -3 }, { x: 0, y: -3 }, { x: 1, y: -3 },
            { x: -1, y: 3 }, { x: 0, y: 3 }, { x: 1, y: 3 }
        ],
        [STRUCTURE_RAMPART]: (() => {
            const ramparts: BuildingCoord[] = [
                // Core protection
                { x: 0, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }
            ];
            // 13×13 Outer Shell (Radius 6) to prevent MassAttack piercing
            for (let i = -6; i <= 6; i++) {
                ramparts.push({ x: i, y: -6 }, { x: i, y: 6 }); // Top & Bottom edges
                if (i > -6 && i < 6) {
                    ramparts.push({ x: -6, y: i }, { x: 6, y: i }); // Left & Right edges
                }
            }
            return ramparts;
        })()
    };
}
