// ============================================================================
// SegmentManager — RawMemory Segment Management
// ============================================================================

import { GlobalCache } from "../GlobalCache";
import { Logger } from "../../utils/Logger";

const log = new Logger("SegmentManager");

/**
 * Manages access to RawMemory segments (0-99).
 * Enforces the 10-active-segment limit per tick.
 */
export class SegmentManager {

    // Limits
    private static readonly MAX_ACTIVE_SEGMENTS = 10;

    // Segment Ranges
    static readonly RANGE_BUFFER = { start: 0, end: 9 };
    static readonly RANGE_STATS = { start: 90, end: 99 };

    /**
     * Request a segment be made active for the NEXT tick.
     * @param id Segment ID (0-99)
     */
    static request(id: number): void {
        this.validateId(id);
        const requested = this.getRequestedSegments();
        if (requested.has(id)) {
            return; // Already requested
        }

        if (requested.size >= this.MAX_ACTIVE_SEGMENTS) {
            log.warning(`Cannot request segment ${id}: Max active limit (${this.MAX_ACTIVE_SEGMENTS}) reached.`);
            return;
        }

        requested.add(id);
    }

    /**
     * Read data from an ACTIVE segment.
     * @returns string content if active, undefined if not active.
     */
    static get(id: number): string | undefined {
        this.validateId(id);
        return RawMemory.segments[id];
    }

    /**
     * Write data to a segment immediately.
     * The segment must be currently active (requested in the previous tick).
     * Screeps enforces a hard limit of 100 KB (100,000 characters) per segment.
     */
    static save(id: number, data: string): void {
        this.validateId(id);

        if (data.length > 100000) {
            log.error(`Segment ${id} exceeds 100KB limit! (${data.length} chars). Skipping.`);
            return;
        }

        if (RawMemory.segments[id] === undefined) {
            log.error(`Cannot save to inactive segment ${id}. It must be requested first.`);
            return;
        }

        RawMemory.segments[id] = data;
    }

    /**
     * Ensure requested segments are set in RawMemory.setActiveSegments for the NEXT tick.
     * Must be called at the end of the tick.
     */
    static commit(): void {
        const requested = this.getRequestedSegments();

        // Always set active segments. If empty, passes [] which clears the
        // active list, freeing up the 10-segment limit for the next tick.
        const ids = Array.from(requested).sort((a, b) => a - b);
        RawMemory.setActiveSegments(ids);

        // CRITICAL: Clear the request set so processes must re-request
        // segments each tick they need them.
        requested.clear();
    }

    // --- Private Helpers ---

    private static validateId(id: number): void {
        if (id < 0 || id > 99) {
            throw new Error(`Invalid segment ID: ${id}`);
        }
    }

    private static getRequestedSegments(): Set<number> {
        return GlobalCache.rehydrate("SegmentManager:requested", () => new Set<number>());
    }
}
