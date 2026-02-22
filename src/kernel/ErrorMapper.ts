// ============================================================================
// ErrorMapper — Screeps-native source-map stack trace resolution
// ============================================================================
//
// Based on the canonical screeps-typescript-starter pattern.
// Uses `require("main.js.map")` to load the external source map that Rollup
// generates, then caches the SourceMapConsumer on the heap for reuse across
// ticks (invalidated on global reset).
//
// source-map v0.6.x is required — later versions are async and incompatible
// with the Screeps VM.
// ============================================================================

import { SourceMapConsumer } from "source-map";
import { Logger } from "../utils/Logger";

const log = new Logger("ErrorMapper");

/** Safely escape untrusted HTML before logging to the Screeps console */
function sanitize(str: string): string {
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Heap-cached consumer — survives between ticks, dies on global reset
// ---------------------------------------------------------------------------

let _consumer: SourceMapConsumer | undefined;

function getConsumer(): SourceMapConsumer {
    if (_consumer == null) {
        // Screeps strips the trailing `.js` when resolving module names.
        // We upload `main.js.map` as a module, Screeps sees it as "main.js.map".
        _consumer = new SourceMapConsumer(require("main.js.map"));
    }
    return _consumer;
}

// ---------------------------------------------------------------------------
// Trace cache — avoids re-mapping the same stack trace every tick
// ---------------------------------------------------------------------------

const _traceCache: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Persistent error log — survives global resets via Memory.errorLog
// ---------------------------------------------------------------------------

const ERROR_LOG_MAX_ENTRIES = 50;

/**
 * Compute a short djb2 hash of the first 500 chars of a stack string.
 * Used as a stable Memory key so identical errors deduplicate across ticks.
 */
function stackFingerprint(stack: string): string {
    let h = 5381;
    const limit = Math.min(stack.length, 500);
    for (let i = 0; i < limit; i++) {
        h = ((h << 5) + h + stack.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

/**
 * Upsert an error into the persistent Memory.errorLog.
 * - If the same stack fingerprint already exists: increment count + update lastTick/bucket.
 * - If new: map the stack trace (expensive once), store the full entry.
 * - Evicts the oldest entry when the log exceeds ERROR_LOG_MAX_ENTRIES.
 */
function upsertErrorLog(rawStack: string, mappedStack: string, message: string): void {
    if (!Memory.errorLog) {
        Memory.errorLog = {};
    }

    const key = stackFingerprint(rawStack);
    const existing = Memory.errorLog[key];

    if (existing) {
        existing.count++;
        existing.lastTick = Game.time;
        existing.bucket = Game.cpu.bucket;
    } else {
        // Evict the oldest entry if at capacity
        const entries = Object.entries(Memory.errorLog);
        if (entries.length >= ERROR_LOG_MAX_ENTRIES) {
            let oldestKey = entries[0][0];
            let oldestTick = entries[0][1].lastTick;
            for (const [k, v] of entries) {
                if (v.lastTick < oldestTick) {
                    oldestTick = v.lastTick;
                    oldestKey = k;
                }
            }
            delete Memory.errorLog[oldestKey];
        }

        Memory.errorLog[key] = {
            message,
            mappedStack,
            firstTick: Game.time,
            lastTick: Game.time,
            count: 1,
            bucket: Game.cpu.bucket,
        };
    }
}

/**
 * Map a raw V8 stack trace back to original TypeScript source locations.
 *
 * WARNING: First call after global reset costs ~30 CPU (source map parsing).
 * Subsequent calls are cached and cost ~0.1 CPU.
 */
function sourceMappedStackTrace(error: Error | string): string {
    const stack: string = error instanceof Error ? (error.stack as string) : error;

    // Return cached result if available
    if (Object.prototype.hasOwnProperty.call(_traceCache, stack)) {
        return _traceCache[stack];
    }

    // Prevent unbounded memory leak in the event of a bug storm
    if (Object.keys(_traceCache).length > 200) {
        for (const key in _traceCache) delete _traceCache[key];
    }

    // Regex matches V8 stack frames:
    //   at FunctionName (main:123:45)
    //   at main:123:45
    // eslint-disable-next-line no-useless-escape
    const re = /^\s+at\s+(.+?\s+)?\(?([0-z._\-\\\/]+):(\d+):(\d+)\)?$/gm;
    let match: RegExpExecArray | null;
    let outStack = error.toString();

    const consumer = getConsumer();

    while ((match = re.exec(stack))) {
        // Only map frames from the "main" module (our bundle)
        if (match[2] === "main") {
            const pos = consumer.originalPositionFor({
                column: parseInt(match[4], 10),
                line: parseInt(match[3], 10),
            });

            if (pos.line != null) {
                if (pos.name) {
                    outStack += `\n    at ${pos.name} (${pos.source}:${pos.line}:${pos.column})`;
                } else if (match[1]) {
                    // Function name from original trace
                    outStack += `\n    at ${match[1]}(${pos.source}:${pos.line}:${pos.column})`;
                } else {
                    outStack += `\n    at ${pos.source}:${pos.line}:${pos.column}`;
                }
            } else {
                // Position not found — stop mapping
                break;
            }
        } else {
            // Non-main frame — stop mapping
            break;
        }
    }

    _traceCache[stack] = outStack;
    return outStack;
}

// ============================================================================
// Public API
// ============================================================================

export const ErrorMapper = {
    /**
     * Returns `true` if the source map module is available.
     * Used by the Foundation Status report.
     */
    isActive(): boolean {
        try {
            require("main.js.map");
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Wraps the game loop so uncaught errors are caught, source-mapped,
     * logged to the console, and persisted to Memory.errorLog.
     */
    wrapLoop(fn: () => void): () => void {
        return (): void => {
            try {
                fn();
            } catch (e: unknown) {
                if (e instanceof Error) {
                    if ("sim" in Game.rooms) {
                        const raw = e.stack || e.message;
                        log.error(`Source maps unavailable in sim\n${sanitize(raw)}`);
                        upsertErrorLog(raw, raw, e.message);
                    } else {
                        const mapped = sourceMappedStackTrace(e);
                        log.error(sanitize(mapped));
                        upsertErrorLog(e.stack ?? e.message, mapped, e.message);
                    }
                } else {
                    const msg = `Non-Error thrown: ${String(e)}`;
                    log.error(sanitize(msg));
                    upsertErrorLog(msg, msg, msg);
                }
            }
        };
    },

    /**
     * Persist an error to Memory.errorLog without re-throwing.
     * Use this for non-fatal errors caught inline (e.g. TrafficManager crashes).
     */
    persistError(e: Error | string): void {
        try {
            const isError = e instanceof Error;
            const message = isError ? e.message : String(e);
            const rawStack = isError ? (e.stack ?? message) : message;
            const mapped = "sim" in Game.rooms ? rawStack : sourceMappedStackTrace(isError ? e : rawStack);
            upsertErrorLog(rawStack, mapped, message);
        } catch {
            // Never let the error logger itself throw
        }
    },

    /**
     * Returns all persisted error log entries sorted by lastTick descending
     * (most recently seen first).
     */
    getErrorLog(): ErrorLogEntry[] {
        if (!Memory.errorLog) return [];
        return Object.values(Memory.errorLog).sort((a, b) => b.lastTick - a.lastTick);
    },

    /**
     * Wipe the persistent error log.
     */
    clearErrorLog(): void {
        Memory.errorLog = {};
    },

    /**
     * Map a stack trace string on demand (for per-process crash traces).
     */
    mapTrace(stack: string): string {
        try {
            return sourceMappedStackTrace(stack);
        } catch {
            return stack;
        }
    },
};
