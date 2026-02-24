// ============================================================================
// Global constants — no imports allowed here.
// This file sits at the top of the dependency graph so anything can import
// from it without creating circular references.
// ============================================================================

/** Flip to true before a Screeps season launch to disable market calls. */
export const SEASON_MODE = false;

/** CPU cap in season mode (conservative to avoid bucket drain). */
export const SEASON_CPU_CAP = 15;

/** Effective CPU cap used by the scheduler. */
export const EFFECTIVE_CPU_CAP = SEASON_MODE ? SEASON_CPU_CAP : (typeof Game !== "undefined" ? Game.cpu.limit : 20);
