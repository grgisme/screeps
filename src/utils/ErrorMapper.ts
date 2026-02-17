// ============================================================================
// ErrorMapper — Clean stack traces via source-map parsing
// ============================================================================

/**
 * Maps V8 stack traces from the bundled main.js back to original TypeScript
 * source locations using the inline source map embedded by Rollup.
 *
 * Uses `source-map` v0.6.x (synchronous API, lightweight).
 */

import { SourceMapConsumer } from "source-map";

// Heap-cached consumer — survives between ticks until global reset
let consumer: SourceMapConsumer | null = null;

/**
 * Lazily initialise the SourceMapConsumer from the inline source map.
 * In Screeps, `require("main")` returns the module and we can read
 * the raw source from the module wrapper to extract the base-64 map.
 */
function getConsumer(): SourceMapConsumer | null {
    if (consumer) {
        return consumer;
    }

    try {
        // The Screeps runtime exposes module source via the require cache.
        // With inline source maps, the data URL is appended at the end:
        //   //# sourceMappingURL=data:application/json;charset=utf-8;base64,...
        const mainModule = require.main;
        if (!mainModule || !mainModule.filename) {
            return null;
        }

        // Try to find inline source map in the module source
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require("fs");
        let source: string;
        try {
            source = fs.readFileSync(mainModule.filename, "utf8");
        } catch {
            // In Screeps runtime, fs won't exist — try alternative approaches
            return null;
        }

        const match = source.match(
            /\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,(.+)$/m
        );
        if (!match) {
            return null;
        }

        const rawMap = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
        consumer = new SourceMapConsumer(rawMap);
        return consumer;
    } catch {
        return null;
    }
}

/**
 * Map a single stack trace line to original source if possible.
 */
function mapStack(stack: string): string {
    const smc = getConsumer();
    if (!smc) {
        return stack;
    }

    return stack.replace(
        /^\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/gm,
        (_match, fn, _file, line, col) => {
            const pos = smc.originalPositionFor({
                line: parseInt(line, 10),
                column: parseInt(col, 10),
            });
            if (pos.source && pos.line !== null) {
                const srcFile = pos.source.replace("../", "");
                return `    at ${fn} (${srcFile}:${pos.line}:${pos.column ?? 0})`;
            }
            return _match;
        }
    );
}

// ============================================================================
// Public API
// ============================================================================

export const ErrorMapper = {
    /**
     * Wraps the game loop so uncaught errors are caught, mapped to
     * TypeScript source locations, and logged without crashing ticks.
     */
    wrapLoop(fn: () => void): () => void {
        return (): void => {
            try {
                fn();
            } catch (e: unknown) {
                if (e instanceof Error) {
                    const mapped = mapStack(e.stack ?? e.message);
                    console.log(
                        `<span style='color:#e74c3c'>[ERROR]</span> ${mapped}`
                    );
                } else {
                    console.log(
                        `<span style='color:#e74c3c'>[ERROR]</span> Non-Error thrown: ${String(e)}`
                    );
                }
            }
        };
    },

    /**
     * Map a stack trace string on demand (useful for per-process errors).
     */
    mapTrace(stack: string): string {
        return mapStack(stack);
    },
};
