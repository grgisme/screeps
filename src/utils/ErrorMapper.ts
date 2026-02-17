// ============================================================================
// ErrorMapper — Clean stack traces via inline source map parsing
// ============================================================================

/**
 * Maps a raw V8 stack trace back to TypeScript source locations.
 *
 * In the Screeps runtime the bundled main.js contains an inline source map.
 * This module parses it on-demand and rewrites stack frames so errors point
 * to the original .ts file + line number rather than the bundle.
 */

// Cache the parsed source map consumer between ticks (heap-first)
let sourceMapConsumer: SourceMapConsumer | null = null;

interface SourceMapConsumer {
    originalPositionFor(pos: {
        line: number;
        column: number;
    }): { source: string | null; line: number | null; column: number | null };
}

interface RawSourceMap {
    version: number;
    sources: string[];
    mappings: string;
    sourcesContent?: string[];
    names?: string[];
}

/**
 * Attempts to parse the inline source map from the bundled main.js.
 * Falls back silently if no source map is available.
 */
function getSourceMapConsumer(): SourceMapConsumer | null {
    if (sourceMapConsumer !== null) {
        return sourceMapConsumer;
    }

    try {
        // In Screeps, `require("main")` returns the module; we can read
        // the raw source from the module cache if available.
        // For now, we return null and rely on raw stack traces.
        // When `source-map` is bundled, this would parse the inline map.
        return null;
    } catch {
        return null;
    }
}

/**
 * Maps a single stack trace string, replacing bundle references with
 * original TypeScript source locations where possible.
 */
function mapStackTrace(stack: string): string {
    const consumer = getSourceMapConsumer();
    if (consumer === null) {
        return stack;
    }

    return stack.replace(
        /^\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/gm,
        (_match, fn, _file, line, col) => {
            const pos = consumer.originalPositionFor({
                line: parseInt(line, 10),
                column: parseInt(col, 10),
            });
            if (pos.source !== null && pos.line !== null) {
                return `    at ${fn} (${pos.source}:${pos.line}:${pos.column ?? 0})`;
            }
            return _match;
        }
    );
}

/**
 * Wraps the game loop function with error mapping.
 *
 * @example
 * ```ts
 * export const loop = ErrorMapper.wrapLoop(() => {
 *   // game logic
 * });
 * ```
 */
export const ErrorMapper = {
    /**
     * Wraps a loop body so any uncaught error gets a clean, mapped stack trace
     * logged to the console without crashing subsequent ticks.
     */
    wrapLoop(fn: () => void): () => void {
        return (): void => {
            try {
                fn();
            } catch (e: unknown) {
                if (e instanceof Error) {
                    const mapped = mapStackTrace(e.stack ?? e.message);
                    console.log(`<span style='color:#e74c3c'>[ERROR]</span> ${mapped}`);
                } else {
                    console.log(
                        `<span style='color:#e74c3c'>[ERROR]</span> Non-Error thrown: ${String(e)}`
                    );
                }
            }
        };
    },
};
