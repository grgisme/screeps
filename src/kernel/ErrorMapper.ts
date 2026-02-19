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
     * and logged to the console without crashing subsequent ticks.
     */
    wrapLoop(fn: () => void): () => void {
        return (): void => {
            try {
                fn();
            } catch (e: unknown) {
                if (e instanceof Error) {
                    if ("sim" in Game.rooms) {
                        log.error(`Source maps unavailable in sim\n${sanitize(e.stack || e.message)}`);
                    } else {
                        log.error(sanitize(sourceMappedStackTrace(e)));
                    }
                } else {
                    log.error(`Non-Error thrown: ${sanitize(String(e))}`);
                }
            }
        };
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
