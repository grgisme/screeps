// ============================================================================
// ProcessStatus — Runtime constants for process state
// ============================================================================

/**
 * These are plain constants instead of a `const enum` so they work
 * both in the Rollup bundle and under ts-node (mocha tests).
 */
export const ProcessStatus = {
    ALIVE: 0,
    SLEEP: 1,
    DEAD: 2,
} as const;

export type ProcessStatusType =
    (typeof ProcessStatus)[keyof typeof ProcessStatus];
