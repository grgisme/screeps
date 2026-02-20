// ============================================================================
// BunkerLayout — Static definition of a 13x13 Bunker with Fast Filler Core
// ============================================================================
//
// The layout is centered on the Terminal at (0,0). Coordinates are offsets
// from the anchor position found via Distance Transform.
//
// FAST FILLER DESIGN:
//   Four "standing tiles" at (-1,-1), (1,-1), (-1,1), (1,1) where filler
//   creeps park permanently. Each tile is adjacent to Storage/Container (0,-1)
//   and surrounded by extensions within transfer range (1 tile).
//   Filler never moves after reaching its tile — pure withdraw/transfer loop.
//
// EXTENSION ORDERING:
//   Array order = build priority. Inner extensions (around filler tiles) are
//   first, ensuring early RCL levels have extensions reachable by stationary fillers.
// ============================================================================

export interface BuildingCoord {
    x: number;
    y: number;
}

export class BunkerLayout {
    // Relative to Anchor (0,0).
    // range: -6 to +6 for the 13x13 footprint.

    static getPos(anchor: RoomPosition, coord: BuildingCoord): RoomPosition {
        return new RoomPosition(anchor.x + coord.x, anchor.y + coord.y, anchor.roomName);
    }

    // ── Fast Filler Standing Tiles ──
    // Fillers park here permanently. Adjacent to hub (0,-1) and inner extensions.
    static fillerTiles: BuildingCoord[] = [
        { x: -1, y: -1 },  // Primary filler (RCL 2+)
        { x: 1, y: -1 },   // Secondary filler (RCL 6+ or high throughput)
        { x: -1, y: 1 },   // Tertiary (RCL 7+)
        { x: 1, y: 1 },    // Quaternary (RCL 8)
    ];

    static structures: { [key in StructureConstant]?: BuildingCoord[] } = {
        // ── Core ──
        [STRUCTURE_SPAWN]: [
            { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -2 }
        ],
        [STRUCTURE_STORAGE]: [
            { x: 0, y: -1 }
        ],
        [STRUCTURE_TERMINAL]: [
            { x: 0, y: 0 }  // Center
        ],
        [STRUCTURE_LINK]: [
            { x: 0, y: 1 }  // Center link
        ],

        // ── Towers (moved outward from filler tiles) ──
        [STRUCTURE_TOWER]: [
            { x: -2, y: -2 }, { x: 2, y: -2 },
            { x: -2, y: 2 }, { x: 2, y: 2 },
            { x: 0, y: -3 }, { x: 0, y: 3 }
        ],

        // ── Extensions (ordered by proximity to filler tiles) ──
        [STRUCTURE_EXTENSION]: [
            // Ring 1: Adjacent to filler tiles (range 1 from standing tiles)
            // Filler at (-1,-1) can reach: (-2,-1), (-2,0), (-1,-2), (0,-2)
            // Filler at (1,-1) can reach:  (2,-1), (2,0), (1,-2), (0,-2)
            { x: -2, y: -1 }, { x: 2, y: -1 },   // Left/right of upper fillers
            { x: -2, y: 0 }, { x: 2, y: 0 },    // Beside spawns
            { x: -1, y: -2 }, { x: 1, y: -2 },    // Above fillers (flanking Spawn3)

            // Ring 2: Adjacent to lower filler tiles (-1,1) and (1,1)
            // Filler at (-1,1) can reach: (-2,1), (-2,0), (-1,2), (0,2)
            // Filler at (1,1) can reach:  (2,1), (2,0), (1,2), (0,2)
            { x: -2, y: 1 }, { x: 2, y: 1 },    // Left/right of lower fillers
            { x: -1, y: 2 }, { x: 1, y: 2 },    // Below fillers
            { x: 0, y: 2 },                        // Below link

            // Ring 3: Diagonal arms (RCL 4-5)
            { x: -3, y: -1 }, { x: 3, y: -1 },
            { x: -3, y: 0 }, { x: 3, y: 0 },
            { x: -3, y: 1 }, { x: 3, y: 1 },
            { x: -1, y: -3 }, { x: 1, y: -3 },
            { x: -1, y: 3 }, { x: 1, y: 3 },
            { x: 0, y: -4 }, { x: 0, y: 4 },

            // Ring 4: X-shape arms (RCL 5-6)
            { x: -3, y: -3 }, { x: -2, y: -3 }, { x: -3, y: -2 },
            { x: 3, y: -3 }, { x: 2, y: -3 }, { x: 3, y: -2 },
            { x: -3, y: 3 }, { x: -2, y: 3 }, { x: -3, y: 2 },
            { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 2 },

            // Ring 5: Outer diamond (RCL 7-8)
            { x: -4, y: 0 }, { x: 4, y: 0 },
            { x: -4, y: -1 }, { x: -4, y: 1 },
            { x: 4, y: -1 }, { x: 4, y: 1 },
            { x: -1, y: -4 }, { x: 1, y: -4 },
            { x: -1, y: 4 }, { x: 1, y: 4 },

            // Ring 6: Far outer (RCL 8)
            { x: -5, y: -2 }, { x: -5, y: 2 },
            { x: 5, y: -2 }, { x: 5, y: 2 },
            { x: -2, y: -5 }, { x: 2, y: -5 },
            { x: -2, y: 5 }, { x: 2, y: 5 },
            { x: -4, y: -3 }, { x: 4, y: -3 },
            { x: -4, y: 3 }, { x: 4, y: 3 },
            { x: -3, y: -4 }, { x: 3, y: -4 },
            { x: -3, y: 4 }, { x: 3, y: 4 }
        ],

        // ── Roads ──
        [STRUCTURE_ROAD]: [
            // Cross roads
            { x: 0, y: -5 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { x: 5, y: 0 },
            // Diagonal ring roads
            { x: -2, y: -2 }, { x: 2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: 2 },
            { x: -3, y: -3 }, { x: 3, y: -3 }, { x: -3, y: 3 }, { x: 3, y: 3 },
            { x: -4, y: -4 }, { x: 4, y: -4 }, { x: -4, y: 4 }, { x: 4, y: 4 },
            // Mid-ring roads
            { x: -3, y: -1 }, { x: -3, y: 0 }, { x: -3, y: 1 },
            { x: 3, y: -1 }, { x: 3, y: 0 }, { x: 3, y: 1 },
            { x: -1, y: -3 }, { x: 0, y: -3 }, { x: 1, y: -3 },
            { x: -1, y: 3 }, { x: 0, y: 3 }, { x: 1, y: 3 }
        ],

        // ── Ramparts (perimeter shell — will be replaced by Min-Cut later) ──
        [STRUCTURE_RAMPART]: (() => {
            const ramparts: BuildingCoord[] = [
                // Core protection
                { x: 0, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }
            ];
            // 13×13 Outer Shell (Radius 6)
            for (let i = -6; i <= 6; i++) {
                ramparts.push({ x: i, y: -6 }, { x: i, y: 6 });
                if (i > -6 && i < 6) {
                    ramparts.push({ x: -6, y: i }, { x: 6, y: i });
                }
            }
            return ramparts;
        })()
    };
}
