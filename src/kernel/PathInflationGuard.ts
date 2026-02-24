// ============================================================================
// PathInflationGuard — Staggered path re-inflation after global resets
// ============================================================================
//
// PROBLEM
// -------
// After a V8 global reset, every creep's `_path` is null simultaneously.
// With 50+ creeps, all calling `PathFinder.search` in tick 0 post-reset can
// consume 50 × ~10 CPU = ~500 CPU, easily triggering emergency mode.
//
// SOLUTION
// --------
// Gate `PathFinder.search` calls so that at most K paths are re-inflated
// per tick. K scales with `Game.cpu.bucket` so the guard is lenient when
// the bucket is full and protective when it's low.
//
// During the RAMP_TICKS window after a reset:
//   K = max(MIN_BUDGET, floor(bucket / BUCKET_DIVISOR))
//   e.g. bucket=1000 → K=5, bucket=10000 → K=50
//
// After RAMP_TICKS ticks the guard disengages automatically; PathFinder.search
// calls are unrestricted again (the spike has already been absorbed).
//
// PRIORITY
// --------
// The OS scheduler already runs higher-priority processes first (miners >
// transporters > workers). Creeps that run earlier in the tick naturally
// consume budget before lower-priority ones, so no explicit per-role sorting
// is needed inside the guard itself.
//
// INTEGRATION
// -----------
// 1. Call `PathInflationGuard.tick(isReset)` once per tick in main.ts,
//    BEFORE kernel.run().
// 2. In Zerg.travelTo(), call `PathInflationGuard.canInflate()` immediately
//    before the PathFinder.search block. If false, return early (creep idles
//    one tick and retries next tick with a refreshed budget).
//
// NOTE: `seedPath()` paths (from MiningSite POI cache) set `_path` directly
// without going through PathFinder.search, so they are completely unaffected
// by this guard and always execute immediately.
// ============================================================================

/** Number of ticks after a reset during which the guard is active. */
const RAMP_TICKS = 5;

/** Minimum per-tick path-inflation budget, regardless of bucket level. */
const MIN_BUDGET = 5;

/**
 * Divide the bucket by this value to get the per-tick budget.
 * bucket=1000 → 5, bucket=5000 → 25, bucket=10000 → 50.
 */
const BUCKET_DIVISOR = 200;

// ---------------------------------------------------------------------------
// Heap state — survives between ticks but is wiped on global reset
// ---------------------------------------------------------------------------

/** Game.time of the last detected global reset. -1 = no reset seen yet. */
let _resetTick = -1;

/** Number of paths already inflated this tick. */
let _inflatedThisTick = 0;

/** Cached budget for the current tick (computed once in tick()). */
let _budgetThisTick = MIN_BUDGET;

/** Game.time when the budget was last computed. */
let _budgetTick = -1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const PathInflationGuard = {
    /**
     * Called once per tick in main.ts BEFORE kernel.run().
     * Records reset events and resets the per-tick counter.
     *
     * @param isReset Whether this tick is the first tick after a V8 reset.
     */
    tick(isReset: boolean): void {
        if (isReset) {
            _resetTick = Game.time;
        }

        // Reset per-tick counter on a new tick
        if (_budgetTick !== Game.time) {
            _budgetTick = Game.time;
            _inflatedThisTick = 0;
            _budgetThisTick = Math.max(MIN_BUDGET, Math.floor(Game.cpu.bucket / BUCKET_DIVISOR));
        }
    },

    /**
     * Returns true if a creep is allowed to call PathFinder.search this tick.
     *
     * Outside the RAMP_TICKS window (normal operation) always returns true.
     * During the window, returns true if the per-tick budget hasn't been
     * exhausted; consumes one unit of budget if so.
     */
    canInflate(): boolean {
        // Guard is inactive: no reset seen, or we're past the ramp window
        if (_resetTick < 0 || Game.time - _resetTick >= RAMP_TICKS) {
            return true;
        }

        // Within the ramp window — check budget
        if (_inflatedThisTick < _budgetThisTick) {
            _inflatedThisTick++;
            return true;
        }

        // Budget exhausted — creep idles this tick
        return false;
    },

    /**
     * How many ticks remain in the current ramp window.
     * 0 = guard is inactive (safe to always call PathFinder.search).
     * Exposed for the profiler and console diagnostics.
     */
    get rampTicksRemaining(): number {
        if (_resetTick < 0) return 0;
        return Math.max(0, RAMP_TICKS - (Game.time - _resetTick));
    },
} as const;
