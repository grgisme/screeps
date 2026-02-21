// ============================================================================
// Algorithms — Pathfinding and Spatial Analysis Utilities
// ============================================================================

/**
 * Calculates the Chebyshev Distance Transform for a given room.
 * The Distance Transform assigns each cell in the CostMatrix the distance
 * to the nearest wall (value 0). This is used by the room planner to find
 * optimal anchor positions for base stamps.
 *
 * Implementation notes (V8 / Screeps optimizations):
 *
 * 1. **Loop order:** Outer = y (rows), Inner = x (columns). This is
 *    critical for Chebyshev correctness. In the forward pass we check
 *    the Top-Right neighbor (x+1, y-1). Because y is the outer loop,
 *    row y-1 has already been fully processed, so column x+1 at row y-1
 *    is valid. With x-outer / y-inner loops, column x+1 at row y-1
 *    would NOT yet be processed, breaking diagonal wall propagation.
 *
 * 2. **Exit masking:** Room exits (x=0, x=49, y=0, y=49) are forced to 0
 *    regardless of terrain. Without this, the base planner can stamp
 *    structures directly on exits, trapping creeps.
 *
 * 3. **Direct _bits access:** CostMatrix.get()/set() perform bounds
 *    checking on every call. Over 2,500+ iterations per pass, this is
 *    measurable CPU waste. We bypass it by accessing the internal
 *    Uint8Array `_bits` directly. Index = x * 50 + y.
 *
 * @param roomName     The name of the room to analyze.
 * @param initialMatrix Optional CostMatrix to start with. If not provided,
 *                      one is created from Terrain (0 = Wall, 255 = Open).
 * @returns A CostMatrix where each tile's value is its Chebyshev distance
 *          to the nearest wall.
 */
export function distanceTransform(roomName: string, initialMatrix?: CostMatrix): CostMatrix {
    const terrain = Game.map.getRoomTerrain(roomName);
    const cm = initialMatrix || new PathFinder.CostMatrix();

    // Direct access to the internal Uint8Array — bypasses bounds checking.
    // In Screeps, CostMatrix stores values in a 2500-element Uint8Array
    // indexed by (x * 50 + y).
    const bits = (cm as any)._bits as Uint8Array;

    // --- 1. Initialization ---
    // Walls → 0, walkable → 255.
    // Room exits (border tiles) are forced to 0 to prevent structural
    // placement on exits.
    if (!initialMatrix) {
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                const idx = x * 50 + y;
                if (x === 0 || x === 49 || y === 0 || y === 49 ||
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    bits[idx] = 0;
                } else {
                    bits[idx] = 255;
                }
            }
        }
    }

    // --- 2. Forward Pass (Top-Left → Bottom-Right) ---
    // Outer = y, Inner = x. Checks 4 previously-visited Chebyshev neighbors:
    //   TL  T  TR     (row y-1, fully processed)
    //   L   C         (row y, columns < x already processed)
    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const idx = x * 50 + y;
            const val = bits[idx];
            if (val === 0) continue; // Wall — distance is already 0

            let min = 255;

            // Top (x, y-1)
            if (y > 0) min = Math.min(min, bits[idx - 1]);
            // Left (x-1, y)
            if (x > 0) min = Math.min(min, bits[idx - 50]);
            // Top-Left (x-1, y-1)
            if (x > 0 && y > 0) min = Math.min(min, bits[idx - 51]);
            // Top-Right (x+1, y-1) — safe because row y-1 is fully processed
            if (x < 49 && y > 0) min = Math.min(min, bits[idx + 49]);

            if (min < 255) {
                bits[idx] = min + 1;
            }
        }
    }

    // --- 3. Backward Pass (Bottom-Right → Top-Left) ---
    // Checks 4 previously-visited neighbors in the reverse direction:
    //         C  R     (row y, columns > x already processed)
    //   BL  B  BR     (row y+1, fully processed)
    for (let y = 49; y >= 0; y--) {
        for (let x = 49; x >= 0; x--) {
            const idx = x * 50 + y;
            let val = bits[idx];
            if (val === 0) continue;

            let min = val;

            // Bottom (x, y+1)
            if (y < 49) min = Math.min(min, bits[idx + 1] + 1);
            // Right (x+1, y)
            if (x < 49) min = Math.min(min, bits[idx + 50] + 1);
            // Bottom-Right (x+1, y+1)
            if (x < 49 && y < 49) min = Math.min(min, bits[idx + 51] + 1);
            // Bottom-Left (x-1, y+1)
            if (x > 0 && y < 49) min = Math.min(min, bits[idx - 49] + 1);

            if (min < val) {
                bits[idx] = min;
            }
        }
    }

    return cm;
}

// ============================================================================
// Flood Fill — BFS Distance Map
// ============================================================================
//
// BFS from one or more origin positions. Returns a CostMatrix where each
// tile's value = Chebyshev distance from the nearest origin (capped at 255).
// Walls and border tiles are left at 255 (unreachable).
//
// Used by ConstructionOverlord to order extension placement: lowest distance
// from Storage/Terminal = built first.
// ============================================================================

export function floodFill(
    roomName: string,
    origins: Array<{ x: number; y: number }>,
    costMatrix?: CostMatrix
): CostMatrix {
    const terrain = Game.map.getRoomTerrain(roomName);
    const cm = costMatrix || new PathFinder.CostMatrix();
    const bits = (cm as any)._bits as Uint8Array;

    // Initialize all tiles to 255 (unreachable)
    bits.fill(255);

    // BFS queue: [x, y, distance]
    const queue: Array<[number, number, number]> = [];

    for (const o of origins) {
        if (o.x < 1 || o.x > 48 || o.y < 1 || o.y > 48) continue;
        if (terrain.get(o.x, o.y) === TERRAIN_MASK_WALL) continue;
        const idx = o.x * 50 + o.y;
        bits[idx] = 0;
        queue.push([o.x, o.y, 0]);
    }

    // Chebyshev BFS (8-directional)
    const DIRS = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ];

    let head = 0;
    while (head < queue.length) {
        const [cx, cy, cd] = queue[head++];
        const nd = cd + 1;
        if (nd >= 255) continue;

        for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
            if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;

            const nIdx = nx * 50 + ny;
            if (bits[nIdx] <= nd) continue; // Already visited with shorter distance
            bits[nIdx] = nd;
            queue.push([nx, ny, nd]);
        }
    }

    return cm;
}

// ============================================================================
// Min-Cut Ramparts — Edmonds-Karp Max-Flow / Min-Cut
// ============================================================================
//
// Finds the minimum set of rampart positions needed to isolate the bunker
// from all room exits. Uses BFS-based max-flow (Edmonds-Karp variant).
//
// The graph is built from the room grid:
//   - Source = virtual node connected to all exit tiles
//   - Sink = virtual node connected to all protected interior tiles
//   - Each walkable tile is split into two nodes (in/out) with capacity 1
//     (cutting a tile = placing a rampart there)
//   - Edges between adjacent tiles have infinite capacity
//
// After computing max-flow, the min-cut is extracted by finding tiles whose
// in→out edge is saturated and reachable from source in the residual graph.
//
// Buffer enforcement: protected tiles are expanded by `bufferSize` tiles
// so ramparts are placed at least `bufferSize` away from structures.
// ============================================================================

export interface MinCutResult {
    ramparts: Array<{ x: number; y: number }>;
}

export function minCutRamparts(
    roomName: string,
    protectedPositions: Array<{ x: number; y: number }>,
    bufferSize: number = 3
): MinCutResult {
    const terrain = Game.map.getRoomTerrain(roomName);

    // Node splitting: each tile (x,y) becomes two nodes:
    //   IN  node = tileIndex * 2
    //   OUT node = tileIndex * 2 + 1
    // Plus: SOURCE = 5000, SINK = 5001
    const SOURCE = 5000;
    const SINK = 5001;
    const NODE_COUNT = 5002;
    const INF = 999999;

    function tileIdx(x: number, y: number): number { return x * 50 + y; }
    function inNode(x: number, y: number): number { return tileIdx(x, y) * 2; }
    function outNode(x: number, y: number): number { return tileIdx(x, y) * 2 + 1; }

    // Adjacency list with capacity/flow
    interface Edge { to: number; cap: number; flow: number; rev: number; }
    const graph: Edge[][] = Array.from({ length: NODE_COUNT }, () => []);

    function addEdge(from: number, to: number, cap: number): void {
        graph[from].push({ to, cap, flow: 0, rev: graph[to].length });
        graph[to].push({ to: from, cap: 0, flow: 0, rev: graph[from].length - 1 });
    }

    // Mark protected positions (expanded by buffer)
    const isProtected = new Uint8Array(2500);
    for (const p of protectedPositions) {
        for (let dy = -bufferSize; dy <= bufferSize; dy++) {
            for (let dx = -bufferSize; dx <= bufferSize; dx++) {
                const nx = p.x + dx;
                const ny = p.y + dy;
                if (nx >= 1 && nx <= 48 && ny >= 1 && ny <= 48) {
                    isProtected[tileIdx(nx, ny)] = 1;
                }
            }
        }
    }

    // Build graph
    const DIRS = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ];

    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const tIdx = tileIdx(x, y);
            const isExit = (x === 0 || x === 49 || y === 0 || y === 49);

            if (isExit) {
                // Exit tiles: SOURCE → OUT(tile) with INF capacity
                addEdge(SOURCE, outNode(x, y), INF);
                // IN→OUT capacity for exit tiles is INF (can't place ramparts on exits)
                addEdge(inNode(x, y), outNode(x, y), INF);
            } else if (isProtected[tIdx]) {
                // Protected tiles: IN(tile) → SINK with INF capacity
                addEdge(inNode(x, y), SINK, INF);
                // IN→OUT capacity INF (don't cut protected tiles)
                addEdge(inNode(x, y), outNode(x, y), INF);
            } else {
                // Normal tiles: IN→OUT with capacity 1 (cuttable = rampart placement)
                addEdge(inNode(x, y), outNode(x, y), 1);
            }

            // Edges to neighbors: OUT(this) → IN(neighbor) with INF capacity
            for (const [dx, dy] of DIRS) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
                if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
                addEdge(outNode(x, y), inNode(nx, ny), INF);
            }
        }
    }

    // Edmonds-Karp: BFS augmenting paths
    function bfs(): number[] | null {
        const parent = new Array<number>(NODE_COUNT).fill(-1);
        const parentEdge = new Array<number>(NODE_COUNT).fill(-1);
        parent[SOURCE] = SOURCE;
        const queue = [SOURCE];
        let head = 0;

        while (head < queue.length) {
            const u = queue[head++];
            for (let i = 0; i < graph[u].length; i++) {
                const e = graph[u][i];
                if (parent[e.to] === -1 && e.cap - e.flow > 0) {
                    parent[e.to] = u;
                    parentEdge[e.to] = i;
                    if (e.to === SINK) {
                        // Reconstruct path as [node, edgeIdx, node, edgeIdx, ...]
                        const path: number[] = [];
                        let cur = SINK;
                        while (cur !== SOURCE) {
                            path.push(cur, parentEdge[cur]);
                            cur = parent[cur];
                        }
                        return path;
                    }
                    queue.push(e.to);
                }
            }
        }
        return null;
    }

    // Run max-flow
    let maxIter = 10000; // Safety limit
    while (maxIter-- > 0) {
        const path = bfs();
        if (!path) break;

        // Find bottleneck along augmenting path
        // Path format: [SINK, edgeIdx, prev_node, edgeIdx, ..., first_child, edgeIdx]
        // Each (node, edgeIdx) pair: graph[parent][edgeIdx] is the edge parent→node
        let bn = INF;
        for (let i = 0; i < path.length; i += 2) {
            const eIdx = path[i + 1];
            const p = i + 2 < path.length ? path[i + 2] : SOURCE;
            const e = graph[p][eIdx];
            bn = Math.min(bn, e.cap - e.flow);
        }

        // Augment
        for (let i = 0; i < path.length; i += 2) {
            const node = path[i];
            const eIdx = path[i + 1];
            const p = i + 2 < path.length ? path[i + 2] : SOURCE;
            graph[p][eIdx].flow += bn;
            graph[node][graph[p][eIdx].rev].flow -= bn;
        }
    }

    // Extract min-cut: find nodes reachable from SOURCE in residual graph
    const visited = new Uint8Array(NODE_COUNT);
    const stack = [SOURCE];
    visited[SOURCE] = 1;
    while (stack.length > 0) {
        const u = stack.pop()!;
        for (const e of graph[u]) {
            if (!visited[e.to] && e.cap - e.flow > 0) {
                visited[e.to] = 1;
                stack.push(e.to);
            }
        }
    }

    // Min-cut = tiles where IN is reachable but OUT is not (their in→out edge is saturated)
    const ramparts: Array<{ x: number; y: number }> = [];
    for (let x = 1; x < 49; x++) {
        for (let y = 1; y < 49; y++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            if (isProtected[tileIdx(x, y)]) continue;
            const iN = inNode(x, y);
            const oN = outNode(x, y);
            if (visited[iN] && !visited[oN]) {
                ramparts.push({ x, y });
            }
        }
    }

    return { ramparts };
}

// ============================================================================
// Gale-Shapley Stable Matching Algorithm
// ============================================================================
//
// Given N proposers and M receivers, each with ranked preference lists,
// produces a stable matching where no two unmatched pairs mutually prefer
// each other over their current assignment.
//
// In the Screeps logistics context:
//   Transfer: proposers = loaded haulers, receivers = requesters
//   Withdraw: proposers = empty haulers, receivers = offers
//
// Receivers can accept multiple proposers up to their capacity.
// Runs in O(N * M) worst case.
// ============================================================================

export interface MatchProposer {
    /** Unique ID of the proposer (e.g., creep name) */
    id: string;
    /** Ordered preference list: receiver IDs from most to least preferred */
    preferences: string[];
}

export interface MatchReceiver {
    /** Unique ID of the receiver (e.g., structure ID) */
    id: string;
    /** How many proposers this receiver can accept (e.g., 1 for most, more for storage) */
    capacity: number;
    /** Scoring function: given a proposer ID, return a preference score (higher = more preferred) */
    score: (proposerId: string) => number;
}

/**
 * Gale-Shapley Stable Matching.
 *
 * @returns Map of proposerId → receiverId (the stable matching)
 */
export function stableMatch(
    proposers: MatchProposer[],
    receivers: MatchReceiver[]
): Map<string, string> {
    // Build receiver lookup
    const receiverMap = new Map<string, MatchReceiver>();
    for (const r of receivers) {
        receiverMap.set(r.id, r);
    }

    // Track state
    const proposalIndex = new Map<string, number>();       // proposer → next preference to try
    const matches = new Map<string, string>();             // proposer → receiver
    const receiverSlots = new Map<string, string[]>();     // receiver → list of matched proposers

    // Initialize
    const free: string[] = [];
    for (const p of proposers) {
        proposalIndex.set(p.id, 0);
        free.push(p.id);
    }
    for (const r of receivers) {
        receiverSlots.set(r.id, []);
    }

    // Build proposer lookup for preferences
    const proposerMap = new Map<string, MatchProposer>();
    for (const p of proposers) {
        proposerMap.set(p.id, p);
    }

    // Main loop: while there are free proposers with preferences remaining
    while (free.length > 0) {
        const pId = free.pop()!;
        const proposer = proposerMap.get(pId)!;
        const idx = proposalIndex.get(pId)!;

        // No more preferences to try — proposer stays unmatched
        if (idx >= proposer.preferences.length) continue;

        const rId = proposer.preferences[idx];
        proposalIndex.set(pId, idx + 1);

        const receiver = receiverMap.get(rId);
        if (!receiver) {
            // Receiver doesn't exist — try next preference
            free.push(pId);
            continue;
        }

        const slots = receiverSlots.get(rId)!;

        if (slots.length < receiver.capacity) {
            // Receiver has room — accept
            slots.push(pId);
            matches.set(pId, rId);
        } else {
            // Receiver is full — check if this proposer is preferred over the worst match
            const pScore = receiver.score(pId);
            let worstIdx = 0;
            let worstScore = receiver.score(slots[0]);

            for (let i = 1; i < slots.length; i++) {
                const s = receiver.score(slots[i]);
                if (s < worstScore) {
                    worstScore = s;
                    worstIdx = i;
                }
            }

            if (pScore > worstScore) {
                // Reject worst, accept new proposer
                const rejected = slots[worstIdx];
                slots[worstIdx] = pId;
                matches.set(pId, rId);
                matches.delete(rejected);
                free.push(rejected); // Rejected proposer becomes free again
            } else {
                // Rejected — proposer tries next preference
                free.push(pId);
            }
        }
    }

    return matches;
}
