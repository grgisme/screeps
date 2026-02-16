/**
 * SegmentManager — RawMemory.segments integration process.
 *
 * Handles the asynchronous request/read cycle for segments:
 *   Tick N:   Request segments via RawMemory.setActiveSegments()
 *   Tick N+1: Read the segments from RawMemory.segments
 *
 * Reserved Segments:
 *   0: Global Room Map (compressed room intel)
 *   1: Market History / Long-term Stats
 *   2-9: Available for future use
 *
 * This runs at P5 (LOW) priority since segment I/O is non-critical.
 */
import { Process, ProcessEntry, PRIORITY } from "./Process";

/** Segment IDs */
export const SEGMENT = {
    ROOM_MAP: 0,
    MARKET_STATS: 1,
} as const;

/** Parsed segment data cached on heap */
interface SegmentCache {
    data: any;
    tick: number; // Tick when this segment was last read
}

/** State machine for the request/read cycle */
type SegmentState = 'idle' | 'requesting' | 'reading';

export class SegmentManagerProcess extends Process {
    /** Cached parsed segment data */
    private cache: Map<number, SegmentCache> = new Map();

    /** Which segments to request on the next cycle */
    private pendingRequests: Set<number> = new Set();

    /** Current state of the async cycle */
    private state: SegmentState = 'idle';

    /** Segments that were requested last tick (available this tick) */
    private activeSegments: number[] = [];

    /** Write queue: segment ID -> stringified data */
    private writeQueue: Map<number, string> = new Map();

    constructor() {
        super('segments', 'segments', PRIORITY.LOW);
    }

    run(): void {
        // --- READ PHASE: Read segments that were requested last tick ---
        if (this.state === 'requesting') {
            this.readActiveSegments();
            this.state = 'reading';
        }

        // --- WRITE PHASE: Flush any queued writes ---
        this.flushWrites();

        // --- REQUEST PHASE: Request segments for next tick ---
        if (this.pendingRequests.size > 0 || this.state === 'idle') {
            this.requestSegments();
            this.state = 'requesting';
        } else {
            this.state = 'idle';
        }
    }

    // ─── PUBLIC API ────────────────────────────────────────────────

    /**
     * Request a segment to be available next tick.
     * Returns cached data if available, or undefined if not yet loaded.
     */
    requestSegment(id: number): any | undefined {
        this.pendingRequests.add(id);

        const cached = this.cache.get(id);
        if (cached) return cached.data;
        return undefined;
    }

    /**
     * Get a previously loaded segment's data.
     * Returns undefined if not in cache.
     */
    getSegment(id: number): any | undefined {
        return this.cache.get(id)?.data;
    }

    /**
     * Queue a write to a segment. The data will be JSON.stringified
     * and written on the next run().
     */
    writeSegment(id: number, data: any): void {
        this.writeQueue.set(id, JSON.stringify(data));
    }

    /**
     * Get the age (in ticks) of a cached segment.
     * Returns -1 if not cached.
     */
    getSegmentAge(id: number): number {
        const cached = this.cache.get(id);
        if (!cached) return -1;
        return Game.time - cached.tick;
    }

    // ─── INTERNALS ─────────────────────────────────────────────────

    private readActiveSegments(): void {
        for (const id of this.activeSegments) {
            const raw = (RawMemory as any).segments[id];
            if (raw !== undefined && raw !== '') {
                try {
                    const parsed = JSON.parse(raw);
                    this.cache.set(id, { data: parsed, tick: Game.time });
                } catch {
                    console.log(`⚠️ SEGMENTS: Failed to parse segment ${id}`);
                    this.cache.set(id, { data: raw, tick: Game.time });
                }
            }
        }
    }

    private requestSegments(): void {
        // Always request our reserved segments + any pending
        const toRequest: number[] = [SEGMENT.ROOM_MAP, SEGMENT.MARKET_STATS];

        for (const id of this.pendingRequests) {
            if (!toRequest.includes(id)) toRequest.push(id);
        }

        // Screeps limits to 10 active segments
        const limited = toRequest.slice(0, 10);
        RawMemory.setActiveSegments(limited);
        this.activeSegments = limited;
        this.pendingRequests.clear();
    }

    private flushWrites(): void {
        for (const [id, data] of this.writeQueue) {
            (RawMemory as any).segments[id] = data;
        }
        if (this.writeQueue.size > 0) {
            if (Game.time % 100 === 0) {
                console.log(`📝 SEGMENTS: Wrote ${this.writeQueue.size} segment(s)`);
            }
            this.writeQueue.clear();
        }
    }

    // ─── PROCESS LIFECYCLE ─────────────────────────────────────────

    init(entry?: ProcessEntry): void {
        super.init(entry);
        // Cache is volatile — always starts empty on global reset
        this.cache = new Map();
        this.pendingRequests = new Set();
        this.writeQueue = new Map();
        this.state = 'idle';
    }

    toString(): string { return '📦 Segment Manager'; }
}
