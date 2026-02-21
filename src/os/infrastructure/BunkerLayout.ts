// ============================================================================
// BunkerLayout — Static 13×13 Bunker with Fast Filler ("Dissi Flower") Core
// ============================================================================
//
// The layout is centered on the primary filler standing tile at (0,0).
// Coordinates are offsets from the anchor found via Distance Transform.
//
// FAST FILLER DESIGN:
//   Center tile (0,0) = dedicated filler creep standing position.
//   Radius 1 ring = 7 Extensions + 1 Hub (Container RCL 2-4, Link RCL 5+).
//   Filler never moves — pure withdraw/transfer loop reaching all 8 tiles.
//
// EXTENSION ORDERING:
//   Inner 7 extensions (filler ring) are first. Outer extensions are ordered
//   by Chebyshev distance from Storage for floodfill-like radial expansion.
//
// LAB DIAMOND:
//   10 labs in upper-right quadrant. First 2 = inputs, next 8 = outputs.
//   Both inputs are within Chebyshev range 2 of all 8 outputs.
//   Ordered: 3 at RCL 6, 6 at RCL 7, 10 at RCL 8.
// ============================================================================

export interface BuildingCoord {
    x: number;
    y: number;
}

// Set of all named (non-extension, non-road) structure positions
const OCCUPIED = new Set<string>();
function occ(x: number, y: number): void { OCCUPIED.add(`${x},${y}`); }

// ── Core positions ──
occ(0, 0);   // standing tile
occ(0, 1);   // hub link
occ(0, 2);   // storage
occ(1, 2);   // terminal

// ── Spawns ──
occ(-1, 2); occ(2, 2); occ(0, -2);

// ── Towers ──
occ(-2, -1); occ(2, -1); occ(-2, 1); occ(2, 1); occ(0, -3); occ(0, 3);

// ── Labs ──
occ(4, -2); occ(4, -3);  // inputs
occ(3, -2); occ(5, -2); occ(3, -3); occ(5, -3);
occ(3, -4); occ(4, -4); occ(5, -4); occ(4, -1);  // outputs

// ── Filler ring extensions (radius 1) ──
const FILLER_EXTENSIONS: BuildingCoord[] = [
    { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
    { x: -1, y: 0 }, { x: 1, y: 0 },
    { x: -1, y: 1 }, { x: 1, y: 1 },
];
for (const c of FILLER_EXTENSIONS) occ(c.x, c.y);

// ── Road positions (diagonal grid + arterials) ──
const ROAD_COORDS: BuildingCoord[] = (() => {
    const roads: BuildingCoord[] = [];
    const roadSet = new Set<string>();
    function addRoad(x: number, y: number): void {
        const key = `${x},${y}`;
        if (OCCUPIED.has(key) || roadSet.has(key)) return;
        if (Math.abs(x) > 5 || Math.abs(y) > 5) return; // stay within radius 5
        roads.push({ x, y });
        roadSet.add(key);
    }

    // Cardinal arterials from core to edge
    for (let i = 3; i <= 5; i++) {
        addRoad(0, -i);  // already tower at (0,-3), will skip
        addRoad(0, i);   // already tower at (0,3), will skip
        addRoad(-i, 0);
        addRoad(i, 0);
    }

    // Ring road at radius 3
    for (const s of [-1, 1]) {
        addRoad(s, -3); addRoad(s, 3);
        addRoad(-3, s); addRoad(3, s);
    }

    // Diagonal corner roads
    for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        for (let r = 2; r <= 5; r++) {
            addRoad(s[0] * r, s[1] * r);
        }
    }

    // Inner access roads at radius 2 (odd parity tiles)
    addRoad(-1, -2); addRoad(1, -2);
    addRoad(-2, 0);  // occupied by nothing now? Let me check — no spawn here anymore
    addRoad(2, 0);
    addRoad(-1, 3); addRoad(1, 3);

    // Lab access roads
    addRoad(3, -1); addRoad(5, -1);
    addRoad(3, -5); addRoad(5, -5);

    return roads;
})();

// Mark roads as occupied for extension generation
for (const c of ROAD_COORDS) OCCUPIED.add(`${c.x},${c.y}`);

// ── Outer extension positions (computed, sorted by distance from Storage) ──
const OUTER_EXTENSIONS: BuildingCoord[] = (() => {
    const candidates: BuildingCoord[] = [];
    const STORAGE_X = 0, STORAGE_Y = 2;

    // Scan radius 2–5, skip occupied tiles and perimeter
    for (let y = -5; y <= 5; y++) {
        for (let x = -5; x <= 5; x++) {
            if (Math.abs(x) <= 1 && Math.abs(y) <= 1) continue; // filler ring handled
            const key = `${x},${y}`;
            if (OCCUPIED.has(key)) continue;

            // Terrain check at runtime — here we just define valid grid positions
            candidates.push({ x, y });
        }
    }

    // Sort by Chebyshev distance from Storage position
    candidates.sort((a, b) => {
        const dA = Math.max(Math.abs(a.x - STORAGE_X), Math.abs(a.y - STORAGE_Y));
        const dB = Math.max(Math.abs(b.x - STORAGE_X), Math.abs(b.y - STORAGE_Y));
        return dA - dB;
    });

    // Cap at 53 (60 total - 7 filler ring)
    return candidates.slice(0, 53);
})();

export class BunkerLayout {
    // Relative to Anchor (0,0).
    // range: -6 to +6 for the 13×13 footprint.

    static getPos(anchor: RoomPosition, coord: BuildingCoord): RoomPosition {
        return new RoomPosition(anchor.x + coord.x, anchor.y + coord.y, anchor.roomName);
    }

    // ── Primary Filler Standing Tile ──
    // The dedicated filler creep parks here permanently at (0,0).
    // Adjacent to all 8 radius-1 structures (7 extensions + 1 hub link/container).
    static centerTile: BuildingCoord = { x: 0, y: 0 };

    // ── Filler Standing Tiles (all fillers, primary first) ──
    static fillerTiles: BuildingCoord[] = [
        { x: 0, y: 0 },    // Primary filler (RCL 2+)
    ];

    // ── Hub position — Container (RCL 2-4) then Link (RCL 5+) ──
    static hubPos: BuildingCoord = { x: 0, y: 1 };

    static structures: { [key in StructureConstant]?: BuildingCoord[] } = {
        // ── Core ──
        [STRUCTURE_SPAWN]: [
            { x: -1, y: 2 },  // Spawn 1: adjacent to Storage
            { x: 2, y: 2 },   // Spawn 2: adjacent to Terminal
            { x: 0, y: -2 },  // Spawn 3: above center
        ],
        [STRUCTURE_STORAGE]: [
            { x: 0, y: 2 }    // Adjacent to Hub Link (0,1)
        ],
        [STRUCTURE_TERMINAL]: [
            { x: 1, y: 2 }    // Adjacent to Storage (0,2) and Hub Link (0,1)
        ],
        [STRUCTURE_LINK]: [
            { x: 0, y: 1 }    // Hub link, adjacent to center standing tile
        ],

        // ── Labs (Diamond Grid — upper-right quadrant) ──
        // Ordered: first 3 at RCL 6, first 6 at RCL 7, all 10 at RCL 8.
        // First 2 = Input labs. Both inputs within range 2 of all 8 outputs.
        [STRUCTURE_LAB]: [
            // RCL 6: 2 inputs + 1 output = functional reaction
            { x: 4, y: -2 },  // Input 1
            { x: 4, y: -3 },  // Input 2
            { x: 3, y: -2 },  // Output 1
            // RCL 7: +3 outputs = 6 total
            { x: 5, y: -2 },  // Output 2
            { x: 3, y: -3 },  // Output 3
            { x: 5, y: -3 },  // Output 4
            // RCL 8: +4 outputs = 10 total
            { x: 3, y: -4 },  // Output 5
            { x: 4, y: -4 },  // Output 6
            { x: 5, y: -4 },  // Output 7
            { x: 4, y: -1 },  // Output 8
        ],

        // ── Towers (central cluster for optimal damage coverage) ──
        [STRUCTURE_TOWER]: [
            { x: -2, y: -1 }, { x: 2, y: -1 },
            { x: -2, y: 1 }, { x: 2, y: 1 },
            { x: 0, y: -3 }, { x: 0, y: 3 },
        ],

        // ── Extensions (ordered: filler ring first, then by distance from Storage) ──
        [STRUCTURE_EXTENSION]: [
            ...FILLER_EXTENSIONS,
            ...OUTER_EXTENSIONS,
        ],

        // ── Roads ──
        [STRUCTURE_ROAD]: ROAD_COORDS,

        // ── Ramparts (static fallback — overridden by Min-Cut at runtime) ──
        [STRUCTURE_RAMPART]: (() => {
            const ramparts: BuildingCoord[] = [
                // Core protection
                { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }
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
