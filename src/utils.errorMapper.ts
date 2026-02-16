/**
 * ErrorMapper - Wraps the game loop to catch and display errors cleanly.
 *
 * In Screeps, stack traces reference the bundled main.js line numbers.
 * This wrapper catches errors and provides clean formatted output.
 * When source maps are available via screeps-source-map (future),
 * it can be extended to map back to original TypeScript sources.
 */

/**
 * Wraps the game loop in a try/catch with formatted error output.
 *
 * Usage in main.ts:
 *   export const loop = ErrorMapper.wrapLoop(() => { ... });
 */
export const ErrorMapper = {
    wrapLoop(loopFn: () => void): () => void {
        return () => {
            try {
                loopFn();
            } catch (e: any) {
                if (e instanceof Error) {
                    const msg = e.stack || e.message;
                    console.log(`<span style='color:red'>[ErrorMapper] ${msg}</span>`);
                    // Log to Memory for post-mortem analysis
                    if (Memory && typeof Game !== 'undefined') {
                        (Memory as any)._lastError = {
                            tick: Game.time,
                            message: e.message,
                            stack: e.stack,
                        };
                    }
                } else {
                    console.log(`<span style='color:red'>[ErrorMapper] Non-Error thrown:</span>`, e);
                }
            }
        };
    },

    /**
     * Standalone helper to wrap any function call with error catching.
     * Returns undefined if the function throws.
     */
    wrap<T>(fn: () => T): T | undefined {
        try {
            return fn();
        } catch (e: any) {
            if (e instanceof Error) {
                console.log(`<span style='color:red'>[ErrorMapper] ${e.stack || e.message}</span>`);
            } else {
                console.log(`<span style='color:red'>[ErrorMapper]</span>`, e);
            }
            return undefined;
        }
    }
};
