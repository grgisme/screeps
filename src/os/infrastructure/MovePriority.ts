// ============================================================================
// MovePriority — Named constants for TrafficManager move priorities
// ============================================================================
//
// These constants are used as the `priority` parameter to `Zerg.travelTo()`
// and `TrafficManager.register()`. The Gale-Shapley bipartite solver uses
// them as tile-score values — higher values win contested tiles.
//
// ┌─────────────────┬───────┬──────────────────────────────────────────────┐
// │  Tier           │ Value │ Who uses it                                  │
// ├─────────────────┼───────┼──────────────────────────────────────────────┤
// │ EMERGENCY       │  100  │ Boundary-bounce recovery, bootstrappers      │
// │                 │       │ forcing through a fully-blocked room exit    │
// ├─────────────────┼───────┼──────────────────────────────────────────────┤
// │ COMBAT          │   25  │ Defenders, destroyers — right-of-way over    │
// │                 │       │ logistics creeps; yields to emergency        │
// ├─────────────────┼───────┼──────────────────────────────────────────────┤
// │ HIGH            │   10  │ Transporters in transit (deliver/withdraw)   │
// │                 │       │ They carry the economy; yield to fighters    │
// ├─────────────────┼───────┼──────────────────────────────────────────────┤
// │ LOW             │    1  │ Default: workers, upgraders, scouts,         │
// │                 │       │ pioneers, fillers travelling to standby      │
// └─────────────────┴───────┴──────────────────────────────────────────────┘
//
// NOTE: Parked filler score (10000) and parked miner score (50) live in
// TrafficManager.ts as tile-occupancy scores — they are NOT move priorities.
// They represent "how hard it is to evict this creep from its tile" rather
// than "how urgently this creep needs to move."
//
// The boundary-bounce boost in Zerg.travelTo() adds EMERGENCY_BOOST to
// the caller's priority (priority + EMERGENCY_BOOST) so the entering creep
// clears the room edge immediately without completely overriding truly
// emergency traffic.
// ============================================================================

export const MovePriority = {
    /** Boundary-bounce recovery and bootstrapper force-through. */
    EMERGENCY: 100,

    /**
     * Amount added to a creep's current priority when it just entered a room
     * and needs to step off the border tile immediately.
     * e.g. a NORMAL transporter becomes 10 + 15 = 25 (COMBAT tier) while
     * clearing the exit — still yields to true EMERGENCY traffic.
     */
    EMERGENCY_BOOST: 15,

    /** Defenders, destroyers — right-of-way over logistics creeps. */
    COMBAT: 25,

    /** Transporters / remote haulers in transit. */
    HIGH: 10,

    /**
     * Default for workers, upgraders, scouts, pioneers, remote miners
     * while travelling and fillers entering their standby position.
     */
    LOW: 1,
} as const;

/** Convenience type alias for the values. */
export type MovePriorityValue = typeof MovePriority[keyof typeof MovePriority];
