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
    // Fast-fill walkable space to 255 if no custom matrix provided.
    if (!initialMatrix) {
        bits.fill(255);
    }

    // Always enforce terrain walls — even on custom matrices.
    // Without this, passing an initialMatrix skips wall mapping and
    // the algorithm calculates distances through solid rock.
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) {
                bits[x * 50 + y] = 0;
            }
        }
    }

    // Unconditionally mask room exits to 0 — prevents the planner
    // from stamping structures on exits. (idx = x * 50 + y)
    for (let i = 0; i < 50; i++) {
        bits[i * 50] = 0; // Top row    (y=0, varying x)
        bits[i * 50 + 49] = 0; // Bottom row (y=49, varying x)
        bits[i] = 0; // Left col   (x=0, varying y)
        bits[49 * 50 + i] = 0; // Right col  (x=49, varying y)
    }

    // --- 2. Forward Pass (Top-Left → Bottom-Right) ---
    // Loops 1-48: the 0-border acts as a safe zero-buffer, eliminating
    // all bounds checks (~20,000 branches removed per call).
    for (let y = 1; y < 49; y++) {
        for (let x = 1; x < 49; x++) {
            const idx = x * 50 + y;
            const val = bits[idx];
            if (val === 0) continue;

            const min = Math.min(
                bits[idx - 1],   // Top      (x, y-1)
                bits[idx - 50],  // Left     (x-1, y)
                bits[idx - 51],  // Top-Left (x-1, y-1)
                bits[idx + 49]   // Top-Right(x+1, y-1)
            );

            if (min < 255) {
                bits[idx] = Math.min(val, min + 1);
            }
        }
    }

    // --- 3. Backward Pass (Bottom-Right → Top-Left) ---
    for (let y = 48; y >= 1; y--) {
        for (let x = 48; x >= 1; x--) {
            const idx = x * 50 + y;
            const val = bits[idx];
            if (val === 0) continue;

            const min = Math.min(
                bits[idx + 1],       // Bottom      (x, y+1)
                bits[idx + 50],      // Right       (x+1, y)
                bits[idx + 51],      // Bottom-Right(x+1, y+1)
                bits[idx - 49]       // Bottom-Left (x-1, y+1)
            ) + 1;                   // Add once (algebraically identical)

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

    // Initialize walkable tiles to 255 (unreachable) while preserving
    // any existing 255 values from a passed-in CostMatrix (which mark
    // custom obstacles like planned structures). If no costMatrix was
    // passed, this is equivalent to bits.fill(255).
    if (!costMatrix) {
        bits.fill(255);
    } else {
        // Preserve obstacle data: only mark non-obstacle tiles as unreachable
        for (let i = 0; i < 2500; i++) {
            if (bits[i] !== 255) bits[i] = 255;
        }
    }

    // Zero-allocation flat queue — avoids thousands of 3-element Array
    // allocations that cause V8 GC stuttering. Distance is stored in bits[].
    const queue = new Uint16Array(2500);
    let head = 0;
    let tail = 0;

    for (const o of origins) {
        if (o.x < 1 || o.x > 48 || o.y < 1 || o.y > 48) continue;
        if ((terrain.get(o.x, o.y) & TERRAIN_MASK_WALL) !== 0) continue;
        const idx = o.x * 50 + o.y;
        if (bits[idx] === 0) continue; // Prevent duplicate origins
        bits[idx] = 0;
        queue[tail++] = idx;
    }

    // Chebyshev BFS (8-directional)
    const DIRS = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ];

    while (head < tail) {
        const idx = queue[head++];
        const cx = (idx / 50) | 0; // Bitwise truncation (faster than Math.trunc)
        const cy = idx % 50;
        const cd = bits[idx];
        const nd = cd + 1;
        if (nd >= 255) continue;

        for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
            if ((terrain.get(nx, ny) & TERRAIN_MASK_WALL) !== 0) continue;

            const nIdx = nx * 50 + ny;
            // Check passed-in CostMatrix obstacles: if the original value
            // was 255 (before our init), this tile was a custom obstacle.
            // We preserved those 255s during init above, so they're still
            // 255 and the `bits[nIdx] <= nd` check naturally skips them.
            if (bits[nIdx] <= nd) continue;
            bits[nIdx] = nd;
            queue[tail++] = nIdx;
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
                // Fix #2: Clamp buffer to >= 2 to ensure at least a 1-tile
                // gap between protected area and exits. Without this, a protected
                // tile at x=1 adjacent to exit x=0 creates uncuttable INF paths.
                if (nx >= 2 && nx <= 47 && ny >= 2 && ny <= 47) {
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
            if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) continue;

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
                if ((terrain.get(nx, ny) & TERRAIN_MASK_WALL) !== 0) continue;
                addEdge(outNode(x, y), inNode(nx, ny), INF);
            }
        }
    }

    // Fix #5: Pre-allocate BFS arrays outside the function scope to avoid
    // creating millions of array elements in a tight loop (V8 GC pressure).
    const parent = new Int32Array(NODE_COUNT);
    const parentEdge = new Int32Array(NODE_COUNT);

    const bfsQueue = new Int32Array(NODE_COUNT);

    // Edmonds-Karp: BFS augmenting paths
    function bfs(): number[] | null {
        parent.fill(-1);
        parentEdge.fill(-1);
        parent[SOURCE] = SOURCE;
        bfsQueue[0] = SOURCE;
        let head = 0;
        let tail = 1;

        while (head < tail) {
            const u = bfsQueue[head++];
            for (let i = 0; i < graph[u].length; i++) {
                const e = graph[u][i];
                if (parent[e.to] === -1 && e.cap - e.flow > 0) {
                    parent[e.to] = u;
                    parentEdge[e.to] = i;
                    if (e.to === SINK) {
                        const path: number[] = [];
                        let cur = SINK;
                        while (cur !== SOURCE) {
                            path.push(cur, parentEdge[cur]);
                            cur = parent[cur];
                        }
                        return path;
                    }
                    bfsQueue[tail++] = e.to;
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
            if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) continue;
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

    // Track state — scores cached alongside IDs to avoid redundant
    // recalculations when receiver capacity is high (e.g., Storage).
    const proposalIndex = new Map<string, number>();
    const matches = new Map<string, string>();
    const receiverSlots = new Map<string, Array<{ id: string; score: number }>>();

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
        if (!receiver || receiver.capacity <= 0) {
            // Fix #1: Receiver doesn't exist or has no capacity — try next preference.
            // Without this guard, capacity 0 causes slots[0] to be undefined,
            // crashing the score() call with a TypeError.
            free.push(pId);
            continue;
        }

        const slots = receiverSlots.get(rId)!;

        if (slots.length < receiver.capacity) {
            // Receiver has room — accept (cache score alongside ID)
            slots.push({ id: pId, score: receiver.score(pId) });
            matches.set(pId, rId);
        } else {
            // Receiver is full — check if this proposer is preferred over the worst match
            const pScore = receiver.score(pId);
            let worstIdx = 0;
            let worstScore = slots[0].score; // Cached — no recalculation

            for (let i = 1; i < slots.length; i++) {
                if (slots[i].score < worstScore) {
                    worstScore = slots[i].score;
                    worstIdx = i;
                }
            }

            if (pScore > worstScore) {
                // Reject worst, accept new proposer
                const rejected = slots[worstIdx].id;
                slots[worstIdx] = { id: pId, score: pScore };
                matches.set(pId, rId);
                matches.delete(rejected);
                free.push(rejected);
            } else {
                // Rejected — proposer tries next preference
                free.push(pId);
            }
        }
    }

    return matches;
}
