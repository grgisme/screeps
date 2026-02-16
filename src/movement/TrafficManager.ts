/**
 * TrafficManager — Advanced Navigation & Traffic Control
 *
 * Provides high-performance pathfinding with:
 *   1. Path Caching:     Compressed direction strings in volatile Heap
 *   2. Stuck Detection:  Recalculates after >3 ticks at same position
 *   3. Shove Algorithm:  Priority-based tile swapping for congestion
 *   4. Bunker CostMatrix: Roads=1, Plains=2, Swamps=10, Stationary=255
 *   5. Visual Debugging:  Toggleable RoomVisual poly-line overlays
 *
 * Usage:
 *   trafficManager.travelTo(creep, target, opts)
 *   trafficManager.registerStationary(creepName, pos)
 *   trafficManager.setVisuals(true)
 */

// ─── TYPES ─────────────────────────────────────────────────────────

export interface TravelToOpts {
    range?: number;
    /** Lower = higher priority for shoving (default: 5) */
    priority?: number;
    /** Skip shove logic */
    ignoreShove?: boolean;
    /** Force path recalculation */
    repath?: boolean;
    /** Max PathFinder ops (auto-scales with bucket) */
    maxOps?: number;
    /** Custom CostMatrix callback (overrides default) */
    roomCallback?: (roomName: string) => CostMatrix | false;
}

/** Per-creep movement state (volatile, heap-cached) */
interface MoveState {
    /** Compressed direction string ("12345678") */
    path: string;
    /** Destination position hash */
    dest: string;
    /** Last known position hash */
    lastPos: string;
    /** Consecutive ticks stuck at same position */
    stuckCount: number;
    /** Tick when path was calculated */
    pathTick: number;
    /** Full path positions for visual debugging */
    pathPositions?: { x: number, y: number, roomName: string }[];
    /** Priority for shove system */
    priority: number;
}

// ─── DIRECTION CONSTANTS ───────────────────────────────────────────

const DIRECTION_DELTA: { [dir: number]: { dx: number, dy: number } } = {
    [TOP]: { dx: 0, dy: -1 },
    [TOP_RIGHT]: { dx: 1, dy: -1 },
    [RIGHT]: { dx: 1, dy: 0 },
    [BOTTOM_RIGHT]: { dx: 1, dy: 1 },
    [BOTTOM]: { dx: 0, dy: 1 },
    [BOTTOM_LEFT]: { dx: -1, dy: 1 },
    [LEFT]: { dx: -1, dy: 0 },
    [TOP_LEFT]: { dx: -1, dy: -1 },
};

const OPPOSITE_DIR: { [dir: number]: DirectionConstant } = {
    [TOP]: BOTTOM,
    [TOP_RIGHT]: BOTTOM_LEFT,
    [RIGHT]: LEFT,
    [BOTTOM_RIGHT]: TOP_LEFT,
    [BOTTOM]: TOP,
    [BOTTOM_LEFT]: TOP_RIGHT,
    [LEFT]: RIGHT,
    [TOP_LEFT]: BOTTOM_RIGHT,
};

// ─── TRAFFIC MANAGER ───────────────────────────────────────────────

class TrafficManagerImpl {
    /** Per-creep movement state (volatile, never serialized) */
    private moveStates: Map<string, MoveState> = new Map();

    /** Stationary creep positions (cost=255 in CostMatrix) */
    private stationaryCreeps: Map<string, RoomPosition> = new Map();

    /** CostMatrix cache per room (TTL-based) */
    private costMatrixCache: Map<string, { cm: CostMatrix, tick: number }> = new Map();

    /** Whether visual debugging is enabled */
    private _showVisuals: boolean = false;

    /** Per-tick intended moves for conflict resolution */
    private _intendedMoves: Map<string, { creep: Creep, priority: number, dir: DirectionConstant }> = new Map();

    /** Per-tick occupied tiles for shove detection */
    private _occupiedTiles: Map<string, Creep> = new Map();
    private _occupiedTick: number = -1;

    // ─── PUBLIC API ────────────────────────────────────────────────

    /**
     * Move a creep toward a target using cached paths and traffic control.
     *
     * @returns OK if moving, ERR_NO_PATH if stuck, ERR_TIRED if fatigued
     */
    travelTo(creep: Creep, target: RoomPosition | { pos: RoomPosition }, opts: TravelToOpts = {}): ScreepsReturnCode {
        const dest = target instanceof RoomPosition ? target : target.pos;
        const range = opts.range ?? 1;
        const priority = opts.priority ?? 5;

        // Already there
        if (creep.pos.inRangeTo(dest, range)) {
            this.clearMoveState(creep.name);
            return OK;
        }

        // Fatigued
        if (creep.fatigue > 0) return ERR_TIRED;

        // Get or create move state
        let state = this.moveStates.get(creep.name);
        const destHash = this.posHash(dest);
        const currentHash = this.posHash(creep.pos);

        // Check if we need a new path
        const needsRepath = !state
            || state.dest !== destHash
            || opts.repath
            || state.stuckCount > 3
            || state.path.length === 0
            || (Game.time - state.pathTick > 50); // TTL: recalc every 50 ticks

        if (needsRepath) {
            state = this.calculatePath(creep, dest, range, priority, opts);
            if (!state || state.path.length === 0) {
                return ERR_NO_PATH;
            }
            this.moveStates.set(creep.name, state);
        } else {
            state = state!;
        }

        // Stuck detection
        if (state.lastPos === currentHash) {
            state.stuckCount++;
        } else {
            state.stuckCount = 0;
            state.lastPos = currentHash;
        }

        // If stuck > 3 ticks, force recalculate next tick
        if (state.stuckCount > 3) {
            // Try random direction as emergency escape
            if (state.stuckCount > 5) {
                const dir = (Math.floor(Math.random() * 8) + 1) as DirectionConstant;
                creep.move(dir);
                return OK;
            }
            return ERR_NO_PATH;
        }

        // Execute next step
        const dir = parseInt(state.path[0], 10) as DirectionConstant;

        // Shove check: is the target tile occupied?
        if (!opts.ignoreShove) {
            this.handleShove(creep, dir, priority);
        }

        const result = creep.move(dir);
        if (result === OK) {
            state.path = state.path.substring(1);
            // Shift path positions for visuals
            if (state.pathPositions && state.pathPositions.length > 0) {
                state.pathPositions.shift();
            }
        }

        return result;
    }

    /**
     * Register a creep as stationary (e.g., static miner on a container).
     * Stationary creeps get cost=255 in the CostMatrix to route around them.
     */
    registerStationary(creepName: string, pos: RoomPosition): void {
        this.stationaryCreeps.set(creepName, pos);
    }

    /** Unregister a stationary creep */
    unregisterStationary(creepName: string): void {
        this.stationaryCreeps.delete(creepName);
    }

    /** Toggle visual debugging */
    setVisuals(enabled: boolean): void {
        this._showVisuals = enabled;
    }

    /** Get visual state */
    get showVisuals(): boolean {
        return this._showVisuals;
    }

    // ─── PATH CALCULATION ──────────────────────────────────────────

    private calculatePath(
        creep: Creep,
        dest: RoomPosition,
        range: number,
        priority: number,
        opts: TravelToOpts,
    ): MoveState | undefined {
        const maxOps = opts.maxOps ?? (Game.cpu.bucket < 2000 ? 500 : 2000);

        const result = PathFinder.search(
            creep.pos,
            { pos: dest, range },
            {
                plainCost: 2,
                swampCost: 10,
                maxOps,
                roomCallback: opts.roomCallback || ((roomName) => this.getBunkerCostMatrix(roomName)),
            }
        );

        if (result.incomplete && result.path.length === 0) {
            return undefined;
        }

        // Serialize path to direction string
        let pathStr = '';
        let curr = creep.pos;
        const positions: { x: number, y: number, roomName: string }[] = [];

        for (const step of result.path) {
            pathStr += curr.getDirectionTo(step);
            positions.push({ x: step.x, y: step.y, roomName: step.roomName });
            curr = step;
        }

        return {
            path: pathStr,
            dest: this.posHash(dest),
            lastPos: this.posHash(creep.pos),
            stuckCount: 0,
            pathTick: Game.time,
            pathPositions: this._showVisuals ? positions : undefined,
            priority,
        };
    }

    // ─── BUNKER-AWARE COST MATRIX ──────────────────────────────────

    /**
     * Build a room CostMatrix with:
     *   - Roads: 1
     *   - Plains: 2 (PathFinder plainCost)
     *   - Swamps: 10 (PathFinder swampCost)
     *   - Stationary Zergs: 255
     *   - Hostile creeps: 255
     *   - Friendly moving creeps: 10 (soft avoid)
     *   - Structures: 255 (except roads/containers/ramparts)
     */
    getBunkerCostMatrix(roomName: string): CostMatrix | false {
        const room = Game.rooms[roomName];
        if (!room) return false;

        // Check cache (TTL: 5 ticks for structure layer, creeps refreshed every tick)
        const cached = this.costMatrixCache.get(roomName);
        if (cached && Game.time - cached.tick < 1) {
            return cached.cm;
        }

        const costs = new PathFinder.CostMatrix();

        // Layer 1: Structures (semi-static, changes rarely)
        const structures = room.find(FIND_STRUCTURES);
        for (const struct of structures) {
            if (struct.structureType === STRUCTURE_ROAD) {
                costs.set(struct.pos.x, struct.pos.y, 1);
            } else if (struct.structureType === STRUCTURE_CONTAINER) {
                costs.set(struct.pos.x, struct.pos.y, 1); // Walkable
            } else if (struct.structureType === STRUCTURE_RAMPART) {
                if (!(struct as StructureRampart).my) {
                    costs.set(struct.pos.x, struct.pos.y, 255);
                }
                // Friendly ramparts: don't override road cost
            } else {
                // All other structures are impassable
                costs.set(struct.pos.x, struct.pos.y, 255);
            }
        }

        // Layer 2: Construction sites
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        for (const site of sites) {
            if (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER) {
                costs.set(site.pos.x, site.pos.y, 1);
            } else if (site.structureType !== STRUCTURE_RAMPART) {
                costs.set(site.pos.x, site.pos.y, 255);
            }
        }

        // Layer 3: Stationary Zergs (miners on containers → impassable)
        for (const [_name, pos] of this.stationaryCreeps) {
            if (pos.roomName === roomName) {
                costs.set(pos.x, pos.y, 255);
            }
        }

        // Layer 4: Creeps
        const creeps = room.find(FIND_CREEPS);
        for (const creep of creeps) {
            if (!creep.my) {
                costs.set(creep.pos.x, creep.pos.y, 255); // Hostile = wall
            } else {
                // Friendly creeps: soft avoid (but shoveable)
                const current = costs.get(creep.pos.x, creep.pos.y);
                if (current < 255) { // Don't override stationary or structure
                    costs.set(creep.pos.x, creep.pos.y, 10);
                }
            }
        }

        this.costMatrixCache.set(roomName, { cm: costs, tick: Game.time });
        return costs;
    }

    // ─── SHOVE ALGORITHM ───────────────────────────────────────────

    /**
     * Priority-based shoving:
     *   If Zerg A (priority P1) wants a tile occupied by Zerg B (idle/P3),
     *   Zerg B is commanded to swap or move to an adjacent free tile.
     */
    private handleShove(creep: Creep, dir: DirectionConstant, priority: number): void {
        this.refreshOccupiedTiles();

        const delta = DIRECTION_DELTA[dir];
        if (!delta) return;

        const targetX = creep.pos.x + delta.dx;
        const targetY = creep.pos.y + delta.dy;

        // Boundary check
        if (targetX < 0 || targetX > 49 || targetY < 0 || targetY > 49) return;

        const targetHash = `${creep.pos.roomName}:${targetX}:${targetY}`;
        const blocker = this._occupiedTiles.get(targetHash);

        if (!blocker || !blocker.my || blocker.name === creep.name) return;

        // Don't shove stationary creeps
        if (this.stationaryCreeps.has(blocker.name)) return;

        // Compare priorities
        const blockerState = this.moveStates.get(blocker.name);
        const blockerPriority = blockerState?.priority ?? 5;

        if (priority < blockerPriority) {
            // We have higher priority — shove the blocker

            // Option 1: Swap (blocker moves to our tile)
            const swapDir = OPPOSITE_DIR[dir];
            const swapX = blocker.pos.x + DIRECTION_DELTA[swapDir].dx;
            const swapY = blocker.pos.y + DIRECTION_DELTA[swapDir].dy;
            const swapHash = `${blocker.pos.roomName}:${swapX}:${swapY}`;

            if (swapX >= 0 && swapX <= 49 && swapY >= 0 && swapY <= 49
                && !this._occupiedTiles.has(swapHash)
                && this.isTileWalkable(blocker.pos.roomName, swapX, swapY)) {
                blocker.move(swapDir);
                return;
            }

            // Option 2: Move blocker to any free adjacent tile
            for (let d = 1; d <= 8; d++) {
                if (d === OPPOSITE_DIR[dir]) continue; // Already tried
                const dd = DIRECTION_DELTA[d as DirectionConstant];
                if (!dd) continue;
                const adjX = blocker.pos.x + dd.dx;
                const adjY = blocker.pos.y + dd.dy;
                if (adjX < 0 || adjX > 49 || adjY < 0 || adjY > 49) continue;

                const adjHash = `${blocker.pos.roomName}:${adjX}:${adjY}`;
                if (!this._occupiedTiles.has(adjHash)
                    && this.isTileWalkable(blocker.pos.roomName, adjX, adjY)) {
                    blocker.move(d as DirectionConstant);
                    return;
                }
            }
        }
    }

    /** Check if a tile is walkable (no walls, no structures) */
    private isTileWalkable(roomName: string, x: number, y: number): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false;

        const terrain = room.getTerrain();
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

        const cm = this.costMatrixCache.get(roomName);
        if (cm && cm.cm.get(x, y) >= 255) return false;

        return true;
    }

    /** Build per-tick occupied tile map for shove resolution */
    private refreshOccupiedTiles(): void {
        if (this._occupiedTick === Game.time) return;

        this._occupiedTiles.clear();
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const hash = `${creep.pos.roomName}:${creep.pos.x}:${creep.pos.y}`;
            this._occupiedTiles.set(hash, creep);
        }
        this._occupiedTick = Game.time;
    }

    // ─── VISUAL DEBUGGING ──────────────────────────────────────────

    /**
     * Draw cached paths as poly-lines on RoomVisuals.
     * Call once per tick from the Kernel or a dedicated process.
     */
    drawVisuals(): void {
        if (!this._showVisuals) return;

        for (const [creepName, state] of this.moveStates) {
            if (!state.pathPositions || state.pathPositions.length === 0) continue;

            const creep = Game.creeps[creepName];
            if (!creep) continue;

            // Group positions by room
            const byRoom: { [room: string]: { x: number, y: number }[] } = {};
            // Start from creep's current position
            const startRoom = creep.pos.roomName;
            if (!byRoom[startRoom]) byRoom[startRoom] = [];
            byRoom[startRoom].push({ x: creep.pos.x, y: creep.pos.y });

            for (const p of state.pathPositions) {
                if (!byRoom[p.roomName]) byRoom[p.roomName] = [];
                byRoom[p.roomName].push({ x: p.x, y: p.y });
            }

            // Draw poly-lines per room
            for (const roomName in byRoom) {
                const points = byRoom[roomName];
                if (points.length < 2) continue;

                const visual = new RoomVisual(roomName);

                // Determine color by priority
                const priority = state.priority;
                const color = priority <= 1 ? '#ff4444'  // Critical/High
                    : priority <= 3 ? '#ffaa00'  // Normal
                        : priority <= 5 ? '#44ff44'  // Low
                            : '#888888'; // Deferred

                const tuples: [number, number][] = points.map(p => [p.x, p.y]);

                visual.poly(tuples, {
                    stroke: color,
                    lineStyle: 'dashed',
                    strokeWidth: 0.08,
                    opacity: 0.4,
                });

                // Draw destination marker
                const last = points[points.length - 1];
                visual.circle(last.x, last.y, {
                    radius: 0.2,
                    fill: color,
                    opacity: 0.6,
                });
            }
        }

        // Draw stationary markers
        for (const [name, pos] of this.stationaryCreeps) {
            if (!Game.rooms[pos.roomName]) continue;
            const visual = new RoomVisual(pos.roomName);
            visual.circle(pos.x, pos.y, {
                radius: 0.3,
                fill: '#ff0000',
                opacity: 0.3,
                stroke: '#ff0000',
                strokeWidth: 0.05,
            });
            visual.text('⚓', pos.x, pos.y + 0.1, { font: 0.4, opacity: 0.6 });
        }
    }

    // ─── CLEANUP ───────────────────────────────────────────────────

    /** Remove state for a dead creep */
    clearMoveState(creepName: string): void {
        this.moveStates.delete(creepName);
    }

    /** GC: clean up states for dead creeps */
    gc(): void {
        for (const name of this.moveStates.keys()) {
            if (!Game.creeps[name]) {
                this.moveStates.delete(name);
            }
        }
        for (const name of this.stationaryCreeps.keys()) {
            if (!Game.creeps[name]) {
                this.stationaryCreeps.delete(name);
            }
        }
    }

    // ─── DIAGNOSTICS ───────────────────────────────────────────────

    stats(): string {
        const pathCount = this.moveStates.size;
        const stationaryCount = this.stationaryCreeps.size;
        const cmCount = this.costMatrixCache.size;
        const stuckCreeps = Array.from(this.moveStates.entries())
            .filter(([_, s]) => s.stuckCount > 0)
            .length;

        return [
            `--- 🚦 TRAFFIC STATS (Tick ${Game.time}) ---`,
            `Active paths: ${pathCount}`,
            `Stationary: ${stationaryCount}`,
            `CostMatrices cached: ${cmCount}`,
            `Stuck creeps: ${stuckCreeps}`,
            `Visuals: ${this._showVisuals ? 'ON' : 'OFF'}`,
        ].join('\n');
    }

    // ─── UTILITIES ─────────────────────────────────────────────────

    private posHash(pos: RoomPosition): string {
        return `${pos.roomName}:${pos.x}:${pos.y}`;
    }
}

/** Global singleton */
export const trafficManager = new TrafficManagerImpl();
