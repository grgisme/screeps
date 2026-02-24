# create_github_issues.ps1
# Creates GitHub issues for all Screeps backlog items.
# Reference material stays in docs/screeps_backlog.md and docs/implementation_priority.md.
# Numbering scheme: §N = backlog section, TN.M = priority tier item.
#
# Usage:
#   pwsh ./scripts/create_github_issues.ps1 [-Token <your-github-pat>]
#
# If -Token is not provided, uses the currently active `gh` auth account.
# Get a PAT at: https://github.com/settings/tokens (needs 'repo' scope)

param(
  [string]$Token = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Set token in environment if provided
if ($Token -ne "") {
  $env:GH_TOKEN = $Token
  Write-Host "Using provided token for GitHub auth."
}

# ── Helper ────────────────────────────────────────────────────────────────────
function New-Issue {
  param(
    [string]$Title,
    [string]$Body,
    [string[]]$Labels
  )
  $labelStr = $Labels -join ","
  Write-Host "  Creating: $Title"
  gh issue create --title $Title --body $Body --label $labelStr
  Start-Sleep -Milliseconds 400   # avoid rate-limit
}

# ── Ensure labels exist ───────────────────────────────────────────────────────
Write-Host "Creating labels..."
$labelsToCreate = @(
  @{ name = "tier-0"; color = "d73a4a"; description = "Tier 0 — Live bugs, fix immediately" },
  @{ name = "tier-1"; color = "e4e669"; description = "Tier 1 — RCL 1-3 Critical, this week" },
  @{ name = "tier-2"; color = "0075ca"; description = "Tier 2 — RCL 3-4 Infrastructure, this month" },
  @{ name = "tier-3"; color = "a2eeef"; description = "Tier 3 — RCL 4-6 Expansion & Economy" },
  @{ name = "tier-4"; color = "5319e7"; description = "Tier 4 — RCL 6-8 Endgame Systems" },
  @{ name = "tier-5"; color = "f9d0c4"; description = "Tier 5 — Future / When Relevant" },
  @{ name = "completed"; color = "0e8a16"; description = "Already implemented and deployed" },
  @{ name = "season-8"; color = "fbca04"; description = "Must-do before Season 8 (March 1)" },
  @{ name = "defense"; color = "b60205"; description = "Defense / Military systems" },
  @{ name = "economy"; color = "006b75"; description = "Economy / Market / Resources" },
  @{ name = "logistics"; color = "1d76db"; description = "Logistics network" },
  @{ name = "expansion"; color = "0052cc"; description = "Room expansion / colonization" },
  @{ name = "performance"; color = "e99695"; description = "CPU / memory performance" },
  @{ name = "labs"; color = "bfd4f2"; description = "Labs / Boosts / Chemistry" },
  @{ name = "military"; color = "b60205"; description = "Offensive military operations" },
  @{ name = "remote"; color = "c5def5"; description = "Remote mining operations" }
)

foreach ($lbl in $labelsToCreate) {
  $existing = gh label list --json name --jq ".[].name" 2>$null
  if ($existing -notcontains $lbl.name) {
    gh label create $lbl.name --color $lbl.color --description $lbl.description 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  Label '$($lbl.name)' already exists or error — skipping"
    }
  }
}
Write-Host "Labels ready.`n"


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 0 — Fix Now (Live Bugs)
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "=== TIER 0 (all completed) — skipping open issues ==="
# All T0 items are ✅ done. We still track them as closed issues for history.
# Skipping creation since they're already resolved.

# ═══════════════════════════════════════════════════════════════════════════════
# TIER 1 — RCL 1-3 Critical
# (All T1 items are ✅ done as of v5.19; creating as closed for traceability)
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "=== TIER 1 (all completed) ==="


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 2 — RCL 3-4 Infrastructure  (open items only — T2.1-T2.3 done)
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "`n=== TIER 2 — RCL 3-4 Infrastructure ==="

New-Issue `
  -Title "T2.4 🏁 Verify Season 8 spawn-per-room cap" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Season 8 critical 🏁 — must check before March 1, 2026**
**Ref:** §91 / implementation_priority.md T2.4

Season 7 had a hard cap of 1 spawn per room. Season 8 rules are not yet confirmed.

**Action required:**
- Read the official Season 8 announcement before March 1.
- Verify whether the 1-spawn/room cap still applies.
- If changed, update Hatchery spawn selection logic accordingly.

*Full research context: docs/screeps_backlog.md §91*
"@ `
  -Labels @("tier-2", "season-8", "performance")

New-Issue `
  -Title "T2.5 Colony.refresh() — cache all FIND_* results once per tick" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 2 / implementation_priority.md T2.5

Currently every overlord calls `room.find()` independently. `Colony.refresh()` is called once per tick and should expose cached FIND results as properties.

**Impact:** O(overlordCount) redundant identical `room.find()` calls → highest single CPU bang-for-buck fix available.

**Implementation:**
- In `Colony.refresh()`, call each `room.find(FIND_*)` once and store results as `colony.hostileCreeps`, `colony.myCreeps`, `colony.structures`, etc.
- Update all overlords to read from colony cache instead of calling `room.find()` directly.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.6 LogisticsNetwork.requestTask — fix O(N²) scoring loop" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 2 / implementation_priority.md T2.6

`LogisticsNetwork.requestTask` iterates all offers for every requesting creep. With 20 creeps × 50 offers = 1000 comparisons per tick.

**Fix:**
- Pre-sort offers by priority once per tick at the start of the logistics phase.
- Share the sorted result across all creep matching calls that tick.
- Gate the sort behind a dirty flag so it only runs when offers change.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance", "logistics")

New-Issue `
  -Title "T2.7 GlobalCache — add max-entries cap with LRU eviction" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 1 / implementation_priority.md T2.7

`GlobalCache` has no entry limit. After enough global resets it grows unboundedly, eventually causing out-of-memory issues.

**Fix:**
- Cap at 500 entries.
- Implement LRU eviction: track last-access timestamp per entry; evict oldest when limit is hit.
- Add a unit test that fills the cache beyond 500 entries and confirms eviction.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.8 PathFinder.CostMatrix rebuild guard — dirty flag, 100-tick interval only" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 3 / implementation_priority.md T2.8

Full CostMatrix rebuild costs ~0.5 CPU. Road-health flag check currently risks triggering a rebuild more frequently than needed.

**Fix:**
- Set a `dirty` boolean flag when road HP changes are detected.
- Rebuild only on 100-tick interval OR when `dirty = true`, then clear the flag.
- Never rebuild in the same tick as the flag check.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.9 Memory.creep dead-key purge — single-pass, not back-to-back O(N) loops" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 1 / implementation_priority.md T2.9

At 50+ creeps, a purge pass followed by a GC pass in the same tick is measurable CPU overhead.

**Fix:**
- Combine dead-key purge and GC into a single O(N) pass per tick (not two separate back-to-back loops).
- Verify the combined pass doesn't run in the same tick as the full memory serialization.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.10 Hatchery.generateBody — memoize on (role, energy) pairs" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 4 / implementation_priority.md T2.10

The same body is requested by O(overlords) times per tick with identical (role, availableEnergy) arguments.

**Fix:**
- Use ``GlobalCache`` with key ``body:`$`{role`}:`$`{energy`}`` to cache generated bodies.
- Cache is valid for the current tick (clear at tick start).

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.11 MiningSite.ts — cache source object reference on heap" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 2 / implementation_priority.md T2.11

`Game.getObjectById(sourceId)` is called every tick; sources never move or change ID.

**Fix:**
- Cache the result of `Game.getObjectById(this.sourceId)` in a heap variable on first successful lookup.
- Use the cached reference on subsequent ticks (still null-check safely).

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.12 SegmentManager.ts — skip setActiveSegments when request unchanged" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §89 Sys 1 / implementation_priority.md T2.12

`RawMemory.setActiveSegments()` costs 0.1 CPU as an intent even when the desired segments haven't changed.

**Fix:**
- Track last-set segment IDs in a heap variable.
- Only call `setActiveSegments` when the requested set differs from the previously set value.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.13 RawMemory Segments — move large data out of main Memory" `
  -Body @"
**Tier:** T2 — RCL 3-4 Infrastructure
**Ref:** §3, §67 / implementation_priority.md T2.13

Main `Memory` has a 2MB cap. Room scouting data, cost matrices, and error logs are causing it to balloon.

**Implementation (§3):**
- Extend `SegmentManager.ts` to expose an async `read(segId)` API using Kernel sleep/wake pattern.
- Move the following to segments:
  - Room scout reports (currently in `Memory.rooms`)
  - Cost matrices for remote rooms
  - Error log circular buffer (§67)
- Each segment is 100KB; max 10 active per tick = 1MB total.

*Full research context: docs/screeps_backlog.md §3, §67*
"@ `
  -Labels @("tier-2", "performance")

New-Issue `
  -Title "T2.14 DCC-themed public controller signs and say() messages" `
  -Body @"
**Tier:** T2 — Cosmetic / fun
**Ref:** §90/A / implementation_priority.md T2.14

**Cosmetic polish — low priority, do after all functional items.**

- Sign room controllers with themed messages via `controller.sign()`.
- Add themed `creep.say()` calls per role (miner, hauler, upgrader, etc.).

*Full research context: docs/screeps_backlog.md §90*
"@ `
  -Labels @("tier-2")

New-Issue `
  -Title "T2.15 Creep name prefixes for decoration/filtering" `
  -Body @"
**Tier:** T2 — Cosmetic / fun
**Ref:** §90/B / implementation_priority.md T2.15

**Zero logic change — pure naming cosmetics.**

Add themed name prefixes in `Hatchery` name generation: `Carl_`, `Donut_`, `EmperorBob_`, etc.
Enables UI skin filtering by role prefix in Screeps dashboard.

*Full research context: docs/screeps_backlog.md §90*
"@ `
  -Labels @("tier-2")


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 3 — RCL 4-6 Expansion & Economy
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "`n=== TIER 3 — RCL 4-6 Expansion & Economy ==="

New-Issue `
  -Title "T3.1 Terminal / Market Automation — energy surplus selling + mineral trading" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §2, §15-§22 / implementation_priority.md T3.1
**Unlocks:** Passive credit income, required for boosts (T4.1)
**RCL:** 6+

Major feature spanning several sub-systems. Implement in this order:

**§2a — Energy Surplus Selling:**
- When `storage.energy > 600k` AND `terminal.energy > 50k`, post sell order at 14-day EMA price.
- Cancel stale orders older than 3000 ticks.

**§16 — Terminal Minimum Energy Reserve (50k lock):**
- Guard all transfers: `terminal.store.energy - cost < 50_000 → return`.
- Push-only energy balancing to prevent circular deadlock.

**§17 — Distance-Optimized Terminal Routing:**
- Sort deficit rooms by `calcTransactionCost` ascending before sending.
- Skip if transfer cost > 50% of amount.

**§18 — Market Price History (EMA-14) + Outlier Detection:**
- Compute 14-day EMA; detect manipulation via Z-score + RelVol.
- Cache result in GlobalCache with 100-tick TTL.

**§19 — Order Management (create / extend / adjust):**
- Post persistent sell orders for minerals > 5000 units.
- Adjust prices every 500 ticks toward current EMA.

**§20 — Empire Ping-Pong Prevention (EmpireLogisticsProcess):**
- Centralize balancing; staggered heartbeat model.
- Batch minimum 5k per send, ideal 25k.

*Full research context: docs/screeps_backlog.md §2, §15-§22*
"@ `
  -Labels @("tier-3", "economy")

New-Issue `
  -Title "T3.2 LinkNetwork — Tower Link role with Critical priority" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §15 / implementation_priority.md T3.2
**RCL:** 5+

Currently non-hub/source/controller links are weighted equally. A Tower Link may lose priority to Extension Links, leaving towers uncharged.

**Fix in LinkNetwork.ts (§15):**
1. Add `towerLinkIds: Id<StructureLink>[]` array.
2. Classify a link as Tower Link if within range 3 of any tower (and not hub/source/controller).
3. Distribution priority:
   - Priority 1 → Tower Links (threshold < 400 energy)
   - Priority 2 → Receiver Links
   - Priority 3 → Controller Link

*Full research context: docs/screeps_backlog.md §15*
"@ `
  -Labels @("tier-3", "economy")

New-Issue `
  -Title "T3.3 Optimal Container Placement — minimize path distance to room exit" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §11 / implementation_priority.md T3.3
**RCL:** 2+ (retroactively improves existing rooms)

`ConstructionOverlord` currently places remote containers at a hardcoded offset. The correct tile is the source-adjacent position that minimizes path distance to the room exit.

**Algorithm (§11):**
\`\`\`ts
function bestContainerTile(source, homeRoomName): RoomPosition {
    const exits = source.room.find(Game.map.findExit(source.pos.roomName, homeRoomName));
    const adj = getAdjacentWalkablePositions(source.pos);
    return adj.sort((a, b) =>
        PathFinder.search(a, exits).cost - PathFinder.search(b, exits).cost
    )[0];
}
\`\`\`
Cache result in `Memory.rooms[roomName].containerPos`. Run once on first visit.

*Full research context: docs/screeps_backlog.md §11*
"@ `
  -Labels @("tier-3", "remote")

New-Issue `
  -Title "T3.4 StructureObserver round-robin scan — eliminate ScoutOverlord spawn cost" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §90/C / implementation_priority.md T3.4
**RCL:** 6 (Observer available)

Observer covers a 10-room radius at 0 spawn cost vs. constant scout creep spawning.

**Implementation:**
- Create `ObserverProcess` in the Kernel.
- Each tick, call `observer.observeRoom(nextRoom)` rotating through a list of target rooms.
- Write result to `Memory.rooms[roomName]` in the same format as ScoutOverlord.
- Deprecate/phase out ScoutOverlord when Observer is active in range.

*Full research context: docs/screeps_backlog.md §90*
"@ `
  -Labels @("tier-3", "expansion")

New-Issue `
  -Title "T3.5 Automated Room Expansion — full decision engine + ColonizeDirective lifecycle" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §6 / implementation_priority.md T3.5
**Prerequisite:** T3.6 (RoomScorer) must be done first
**RCL:** 5+

Currently expansion only happens via manual `claim:` flag. Needs full automation.

**§6a — Net Energy Surplus Gate:**
- Authorize expansion only when `E_net >= E_expansion_cost_per_tick` AND `storage > 100k`.

**§6b — Expansion Decision Engine (5 gates):**
1. All owned rooms at RCL 6+
2. Combined storage > 100k per active mission
3. Positive E_net
4. Scouted room with `scoutScore > EXPANSION_THRESHOLD` exists
5. GCL allows another room

**§6c — ColonizeDirective 4-Phase Lifecycle:**
- SCOUTING → CLAIMING → BOOTSTRAPPING → HANDOVER
- Handover trigger: RCL ≥ 4 AND storage ≥ 10k AND spawn exists

**§6f — CPU Hibernation:** Pause if `bucket < 500`.
**§6g — Failover / Cool-down:** 500-tick claim timeout → 10k-tick quarantine.

*Full research context: docs/screeps_backlog.md §6*
"@ `
  -Labels @("tier-3", "expansion")

New-Issue `
  -Title "T3.6 Room Scouting and Scoring — RoomScorer.ts + ScoutOverlord integration" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §85, §6 / implementation_priority.md T3.6
**Must precede T3.5 (Automated Expansion)**
**RCL:** 2+

Without scored candidate rooms, automated expansion has nothing to pick from.

**Implementation:**
- `RoomScorer.ts`: score rooms on source count, plains area, missing mineral synergy, proximity to empire.
- `ScoutOverlord`: dispatch [MOVE] scout → gain vision → run Distance Transform + Flood Fill → write score to `Memory.rooms[room].scoutScore`.
- `Colony.ts` / expansion engine reads `scoutScore` to pick expansion targets.

*Full research context: docs/screeps_backlog.md §6c, §85*
"@ `
  -Labels @("tier-3", "expansion")

New-Issue `
  -Title "T3.7 Directive.ts — build Game.flags index once per tick (not O(directives × flags))" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §89 Sys 8 / implementation_priority.md T3.7

Currently each directive does its own flag lookup, resulting in O(directives × flags) lookups per tick.

**Fix:**
- In `main.ts` pre-loop, build `Map<string, Flag>` from `Game.flags`.
- Pass this map to all directives — O(1) lookup per directive.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-3", "performance")

New-Issue `
  -Title "T3.8 ColonizeDirective.ts — cache colonization phase in Memory" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §89 Sys 8 / implementation_priority.md T3.8
**RCL:** 3+

`FIND_MY_SPAWNS` full scan runs every tick to determine phase. Phase should only change on known events.

**Fix:**
- Cache `phase` in `Memory.directives[id].phase`.
- Re-evaluate phase only on: room RCL change, spawn built/destroyed, or manual reset.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-3", "expansion", "performance")

New-Issue `
  -Title "T3.9 Reserver body — single-CLAIM body (1 CLAIM + 5 MOVE)" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §85 / implementation_priority.md T3.9
**RCL:** 2+

Current reserver body overspends on CLAIM parts. One CLAIM is all that's needed for reservation.

**Fix:**
- Update `ReserverOverlord` body template to `[CLAIM, MOVE, MOVE, MOVE, MOVE, MOVE]`.
- Lower spawn cost → faster spawn from lower energy cap → works at RCL 3+.

*Full research context: docs/screeps_backlog.md §12*
"@ `
  -Labels @("tier-3", "remote")

New-Issue `
  -Title "T3.10 Controller downgrade timer claim-sniping" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §85 / implementation_priority.md T3.10
**RCL:** 3+

Abandoned player rooms with `ticksToDowngrade < 5000` can be claimed without a fight.

**Implementation:**
- `ScoutOverlord` or `ObserverProcess` checks `controller.ticksToDowngrade` for adjacent rooms.
- If `ticksToDowngrade < 5000` and room is not owned by an active player → dispatch claimer.
- No attack creeps needed — pure opportunistic expansion.

*Full research context: docs/screeps_backlog.md §85*
"@ `
  -Labels @("tier-3", "expansion")

New-Issue `
  -Title "T3.11 Neighbor RCL WorldState profiling — scout adjacent players' RCL/defenses" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §85 / implementation_priority.md T3.11
**RCL:** 3+

Currently the bot has no threat assessment for neighboring players.

**Implementation:**
- When scout visits an adjacent player room, record: owner username, RCL, tower count, wall/rampart HP, storage level.
- Write to `Memory.worldState.players[username]`.
- Use in expansion targeting (avoid high-RCL neighbors) and military threat assessment.

*Full research context: docs/screeps_backlog.md §85*
"@ `
  -Labels @("tier-3", "expansion", "defense")

New-Issue `
  -Title "T3.12 Early PvP harassment — attackController() against RCL 1-2 neighbors" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §85 / implementation_priority.md T3.12
**RCL:** 3+

Small CLAIM-body creeps can delay rival bootstraps at minimal cost.

**Implementation:**
- When WorldState (T3.11) identifies an RCL 1-2 neighbor with no tower:
  - Spawn `[CLAIM, MOVE, MOVE, MOVE]` harasser.
  - Creep calls `attackController(room.controller)` — does 300 downgrade damage per tick.
- Condition: only when home is stable (storage > 50k, not under attack).

*Full research context: docs/screeps_backlog.md §85*
"@ `
  -Labels @("tier-3", "military")

New-Issue `
  -Title "T3.13 flag.memory for directive state — auto-GC, no orphan Memory keys" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §90/C / implementation_priority.md T3.13

Directive phase stored in `Memory.rooms[r]` creates orphan keys when flags are removed.

**Fix:**
- Use `flag.memory` (per-flag Memory slot) for all directive state.
- Auto-GC: when flag is deleted, its memory disappears automatically.
- Refactor `ColonizeDirective`, `ClaimDirective`, and any other flag-backed directives.

*Full research context: docs/screeps_backlog.md §90*
"@ `
  -Labels @("tier-3", "expansion")

New-Issue `
  -Title "T3.14 Power Spawn automation — processPower() for GPL generation" `
  -Body @"
**Tier:** T3 — RCL 4-6 Expansion & Economy
**Ref:** §37-§45 / implementation_priority.md T3.14
**RCL:** 8 (Power Spawn structure)

`powerSpawn.processPower()` converts 50 Power + 1 Ghodium into 1 GPL at RCL 8.

**Implementation:**
- Detect `STRUCTURE_POWER_SPAWN` on colony refresh.
- In `ColonyProcess.run()` or dedicated `PowerSpawnProcess`:
  - If `powerSpawn.power > 0` AND `powerSpawn.ghodium > 0`: call `powerSpawn.processPower()`.
- Enables PowerCreep classes (T4.8, T4.9).

*Full research context: docs/screeps_backlog.md §37-§45, §14*
"@ `
  -Labels @("tier-3", "economy")


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 4 — RCL 6-8 Endgame Systems
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "`n=== TIER 4 — RCL 6-8 Endgame Systems ==="

New-Issue `
  -Title "T4.1 Boosts / Labs — Science Overlord, reaction scheduler, Scientist FSM" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §7, §30-§35, §46-§50 / implementation_priority.md T4.1
**Prerequisite:** T3.1 (Terminal market must supply reagents)
**RCL:** 6+ (3 labs available)
**Unlocks:** T4.3 (Squads), T4.4 (Tower Drain)

No lab code exists. Entire pipeline from scratch.

**§30 — Science Overlord + Reaction Scheduler:**
- RCL-progressive lab scaling (3 → 6 → 10 labs at RCL 6/7/8).
- Classify 2 input labs + N output labs. Run reactions in parallel.
- CPU gate: `Game.time % 10 === 0`, skip if product at quota.

**§31 — Recursive Mineral Dependency Resolver:**
- Walk reaction DAG using built-in `REACTIONS` global.
- `getMissingPrecursors(target, amount, inventory)` returns full shopping list.

**§32 — Scientist Creep FSM (5 states):**
- RENEW → FLUSH → REAGENT_SUPPLY → PRODUCT_COLLECT → IDLE
- FLUSH check on every tick — #1 cause of lab automation failure.
- Body: `[CARRY×8, MOVE×4]`

**§33 — Creep Boosting Request Protocol:**
- `BoostRequest` interface in `Memory.boostQueue`.
- Scientist loads compound into boost lab before creep spawns.
- DEFENSE priority interrupts all ongoing reactions immediately.

**§34 — Empire-Wide Mineral Quota System:**
- Per-room quota definitions; delta routing via `EmpireLogisticsProcess` (§20).

**§35 — Make-vs-Buy Market Decision:**
- Buy missing minerals from market when within 10% of EMA.
- Standing buy order for Catalyst (X) at SMA × 0.95.

*Full research context: docs/screeps_backlog.md §7, §30-§35*
"@ `
  -Labels @("tier-4", "labs", "economy")

New-Issue `
  -Title "T4.2 Source Keeper Suppression — SK rooms at 13.3 e/tick with permanent guard" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §13, §80 / implementation_priority.md T4.2
**Gate:** RCL 7+, storage > 300k
**Roles:** SK Miner, SK Hauler, SK Guard

SK rooms yield 4,000 energy per source per 300 ticks (13.3 e/tick) but require permanent combat presence.

**SK Guard Loop:**
\`\`\`ts
const lairs = skRoom.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_KEEPER_LAIR });
const nextLair = lairs.sort((a, b) => a.ticksToSpawn - b.ticksToSpawn)[0];
guard.travelTo(nextLair, 1);
// attack keeper when visible near lair
\`\`\`

**CostMatrix:** Set all lair 3×3 zones to cost 255 for non-guard creeps.

**Bodies:**
- SK Miner: `[WORK×7, CARRY, MOVE×4]`
- SK Hauler: `[CARRY×20, MOVE×10]`
- SK Guard: `[ATTACK×10, HEAL×5, MOVE×15]`

*Full research context: docs/screeps_backlog.md §13*
"@ `
  -Labels @("tier-4", "remote", "defense")

New-Issue `
  -Title "T4.3 Squad / Quad Combat Formation — 2×2, pull chain, predictive triage" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems  
**Ref:** §4, §51-§54 / implementation_priority.md T4.3
**Prerequisite:** T4.1 (Boosts required for viable quads)
**RCL:** 7+

**§4 / §51-§54 cover full implementation. Key design:**

**Squad object:** 4 members, shared dilated CostMatrix path (computed once), `quad | snake` formation.

**Movement (§52):** Leader pulls chain via `creep.pull()`. Lockstep — if any member has fatigue > 0, entire squad idles.

**Formation integrity:** Before moving, verify all 4 within range 1. If gap: HOLD, others travelTo leader.

**Healing (§53):** Predictive triage — sort by deficit, assign healers before damage resolves. In snake: use `rangedHeal()`.

**Snake ↔ Quad transitions (§54):** 1×4 for chokepoints, 2×2 for open areas.

**Standard quad body:**
- Engine (2×): `[TOUGH×4, MOVE×6, HEAL×8]`
- Heavy (2×): `[TOUGH×4, MOVE×2, WORK×12]`

*Full research context: docs/screeps_backlog.md §4, §51-§54*
"@ `
  -Labels @("tier-4", "military")

New-Issue `
  -Title "T4.4 DestroyerOverlord — TOWER_DRAIN mode with boosted TOUGH oscillation" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §25, §87 / implementation_priority.md T4.4
**Prerequisite:** T4.1 (Boosts), T4.3 (Squad basics)
**RCL:** 7+

**Drainer FSM (§25):** `APPROACH → STEP_IN → SOAK → STEP_OUT → RECOVER → (loop)`

Sweet spot: range 15-20 from towers. With XGHO2: `1,800 → 540 effective DPT` — healable with 2 boosted HEAL parts.

**Body:** `[TOUGH×18, MOVE×18]` + boosted XGHO2 (70% damage reduction).

**Economic goal:** Force defender to spend 60 energy/tick (6 towers) while attacker's cost is only creep amortization.

**§29 — Per-Tick Combat Simulation:** Run 10-tick survival projection before committing the drainer to a tile.

*Full research context: docs/screeps_backlog.md §25, §29*
"@ `
  -Labels @("tier-4", "military")

New-Issue `
  -Title "T4.5 DestroyerOverlord — CONTROLLER_ATTACK mode (attackController 100 dmg/tick/WORK)" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §87 / implementation_priority.md T4.5
**RCL:** 6+

Send WORK-body creep to `attackController()` to accelerate downgrade of a hostile room.
100 damage per WORK part per tick toward downgrade timer.

**Safe Mode Block (§26d):** CLAIM-part creep attacking the controller prevents the defender from activating Safe Mode.

*Full research context: docs/screeps_backlog.md §26d, §87*
"@ `
  -Labels @("tier-4", "military")

New-Issue `
  -Title "T4.6 DestroyerOverlord — WAVES and TRICKLE modes based on tower count" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §87 / implementation_priority.md T4.6
**RCL:** 6+

- **WAVES:** Send squads in timed bursts — attack while tower energy is low, retreat while it recharges (10 energy/tick per tower).
- **TRICKLE:** Continuous low-cost harassment with sacrificial creeps to drain tower energy before the main assault.

Requires tower count detection from scout/observer data.

*Full research context: docs/screeps_backlog.md §87*
"@ `
  -Labels @("tier-4", "military")

New-Issue `
  -Title "T4.7 Market Commodities — Factory production pipeline (T1-T5)" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §21 / implementation_priority.md T4.7
**Prerequisite:** Factory (RCL 7), Terminal market (T3.1)
**RCL:** 7+

No factory logic exists. Factories unlock highest-credit NPC commodity revenue.

**5-room production line:** L1→L2→L3→L4→L5 factory chain producing MACHINE / DEVICE / ORGANISM / ESSENCE.

**§21 — FactoryOverlord with JIT delivery:**
- Gate: `Game.time % 20 === 0`
- JIT: only request ingredients when `cooldown < 10` AND store below threshold.
- Transfer finished goods to terminal when `> batchSize`.

**NPC Market Strategy:** Filter `getAllOrders` for orders with no `roomName` (NPC orders). Track EMA per commodity.

*Full research context: docs/screeps_backlog.md §21*
"@ `
  -Labels @("tier-4", "economy")

New-Issue `
  -Title "T4.8 PowerCreep — OPERATE_SPAWN (2× speed) + OPERATE_EXTENSION" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §90/C, §14 / implementation_priority.md T4.8
**Prerequisite:** T3.14 (GPL from Power Spawn)
**RCL:** 8

OPERATE_SPAWN doubles spawn speed — halves creep replacement latency. Priority power after Power Spawn is running.

**Implementation:**
- `PowerCreepProcess`: route PC to spawn, use power before spawning critical creeps.
- Track `powerCreep.powers[PWR_OPERATE_SPAWN].cooldown`.

*Full research context: docs/screeps_backlog.md §14*
"@ `
  -Labels @("tier-4", "economy")

New-Issue `
  -Title "T4.9 PowerCreep — OPERATE_TOWER (double damage) + OPERATE_STORAGE (2× capacity)" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §90/C / implementation_priority.md T4.9
**Prerequisite:** T4.8 (OPERATE_SPAWN first)
**RCL:** 8

- `OPERATE_TOWER`: doubles tower damage → 1,200 DPT max range.
- `OPERATE_STORAGE`: doubles storage capacity to 2M energy.

Use in `PowerCreepProcess` with per-power cooldown tracking.

*Full research context: docs/screeps_backlog.md §14*
"@ `
  -Labels @("tier-4", "defense", "economy")

New-Issue `
  -Title "T4.10 TerminalOverlord.ts — cache getAllOrders() with 100-tick TTL" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §89 Sys 10 / implementation_priority.md T4.10
**RCL:** 6+

`Game.market.getAllOrders()` returns ~1000 entries and is expensive. Never call in main loop without cache.

**Fix:**
- Cache result in `GlobalCache` with key `market:allOrders` and 100-tick TTL.
- All market calls read from cache; refresh only when TTL expires.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-4", "economy", "performance")

New-Issue `
  -Title "T4.11 Pixel farming automation — generatePixel() when bucket >= 10k" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §87, §88 / implementation_priority.md T4.11

**Disabled in Season 8 — only enable for persistent world.**

Call `Game.cpu.generatePixel()` at start of tick when `bucket >= 10,000`.
Generates 1 Pixel per call (spent from bucket). Can sell Pixels on market.

*Full research context: docs/screeps_backlog.md §87*
"@ `
  -Labels @("tier-4", "economy")

New-Issue `
  -Title "T4.12 Memory queue admin commands — global.q.attack, global.q.reserve, etc." `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §87 / implementation_priority.md T4.12

QoL for manual intervention without touching code.

**Desired admin interface:**
\`\`\`js
global.q.attack('W1N1')      // Queue attack directive
global.q.reserve('W2N2')     // Queue reservation directive
global.q.claim('W3N3')       // Queue claim directive
global.q.status()            // Print current directive queue
\`\`\`

*Full research context: docs/screeps_backlog.md §87*
"@ `
  -Labels @("tier-4")

New-Issue `
  -Title "T4.13 ScoutOverlord — write Memory.worldState only on change, not every tick" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §89 Sys 9 / implementation_priority.md T4.13

ScoutOverlord currently writes the same worldState data every tick even when nothing changed.

**Fix:**
- Gate write: `Game.time - lastSeen > 50` OR data diff vs cached value.
- Saves the Memory serialization cost of the write on most ticks.

*Full research context: docs/screeps_backlog.md §89*
"@ `
  -Labels @("tier-4", "performance")

New-Issue `
  -Title "T4.14 GCL-adaptive CPU bucket thresholds — not hardcoded values" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §87 / implementation_priority.md T4.14

Hardcoded `bucket > 500` / `bucket > 2000` thresholds don't scale with GCL.

**Fix:**
- Express thresholds as: `CPU_CAP * 5` (low threshold) and `CPU_CAP * 10` (high threshold).
- `CPU_CAP` = `Game.cpu.limit` (scales with GCL).
- After Season Mode (T2.1), also respect `EFFECTIVE_CPU_CAP`.

*Full research context: docs/screeps_backlog.md §87*
"@ `
  -Labels @("tier-4", "performance")

New-Issue `
  -Title "T4.15 RawMemory circular log buffer — replace unbounded Memory.errorLog" `
  -Body @"
**Tier:** T4 — RCL 6-8 Endgame Systems
**Ref:** §67 / implementation_priority.md T4.15

`Memory.errorLog` grows unboundedly under heavy logging. Must be replaced before enabling production-level logging.

**Fix:**
- Implement a fixed-size circular buffer (e.g., 200 entries) in a RawMemory segment (§3/§13).
- Oldest entries are overwritten when buffer is full.
- Expose `global.log.dump()` to print all buffered entries to console.

*Full research context: docs/screeps_backlog.md §67, §3*
"@ `
  -Labels @("tier-4", "performance")


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 5 — Future / When Relevant
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "`n=== TIER 5 — Future / When Relevant ==="

New-Issue `
  -Title "T5.1 Inter-Shard Memory (ISM) — when empire spans > 1 shard" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §5 / implementation_priority.md T5.1
**Condition:** When empire spans > 1 shard

**Design (§5):**
- `InterShardMemory.getLocal()` / `setLocal()` — 10KB per shard, not immediate (next tick).
- `PortalManagerProcess` checks `getRemote()` for incoming creep manifests, spawns GhostProcess at portal tile.
- `CrossShardManifest` schema: creepName, role, task, colonyTarget, arrivalShard.

*Full research context: docs/screeps_backlog.md §5*
"@ `
  -Labels @("tier-5")

New-Issue `
  -Title "T5.2 Power Creep classes — Commander & Executor (when officially released)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §91 / implementation_priority.md T5.2
**Condition:** When officially released (announced for 2026)

Placeholder — implement when Screeps releases Commander and Executor PC classes.

*Full research context: docs/screeps_backlog.md §91*
"@ `
  -Labels @("tier-5")

New-Issue `
  -Title "T5.3 Warp Containers (when officially released)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §91 / implementation_priority.md T5.3
**Condition:** When officially released

Placeholder — implement when Screeps releases Warp Container mechanic.

*Full research context: docs/screeps_backlog.md §91*
"@ `
  -Labels @("tier-5")

New-Issue `
  -Title "T5.4 ES Module restructure (when Premium Shard launches)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §91 / implementation_priority.md T5.4
**Condition:** When Premium Shard launches with ES Module support

Restructure the codebase to use native ES Modules instead of CommonJS/rollup bundle.

*Full research context: docs/screeps_backlog.md §91*
"@ `
  -Labels @("tier-5")

New-Issue `
  -Title "T5.5 Score-Resource Delivery Overlord (Season mechanic — monitor each season)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §91 / implementation_priority.md T5.5
**Condition:** If a future season uses the score-resource delivery mechanic

Check each season announcement. Implement only if Season N uses this mechanic.

*Full research context: docs/screeps_backlog.md §91*
"@ `
  -Labels @("tier-5", "season-8")

New-Issue `
  -Title "T5.6 Arena port (if targeting Arena Season 2+ matches)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §88/Feature 6 / implementation_priority.md T5.6
**Condition:** If targeting Screeps Arena Season 2+

Port bot logic to Arena format. Requires separate entry point and significantly different architecture.

*Full research context: docs/screeps_backlog.md §88*
"@ `
  -Labels @("tier-5")

New-Issue `
  -Title "T5.7 InterShardMemory cross-shard market arbitrage (GCL 10+ multi-shard)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §90/C / implementation_priority.md T5.7
**Condition:** GCL 10+ multi-shard empire

Cross-shard price comparison + arbitrage routing via `InterShardMemory`.
Requires T5.1 (ISM) as prerequisite.

*Full research context: docs/screeps_backlog.md §90*
"@ `
  -Labels @("tier-5", "economy")

New-Issue `
  -Title "T5.8 Power Bank raiding (RCL 8, GPL infrastructure ready)" `
  -Body @"
**Tier:** T5 — Future / When Relevant
**Ref:** §37-§45 / implementation_priority.md T5.8
**Condition:** RCL 8, GPL infrastructure from T3.14 operational

Power Banks appear in highway rooms with 2M HP. Raiding yields Power for GPL.
Requires high-DPS boosted squad (T4.3) and fast logistics.

*Full research context: docs/screeps_backlog.md §37-§45*
"@ `
  -Labels @("tier-5", "military")


# ═══════════════════════════════════════════════════════════════════════════════
# ADDITIONAL BACKLOG ITEMS not in priority list but in research doc
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "`n=== Additional backlog research items ==="

New-Issue `
  -Title "§22 Predictive Supply Chain — miner rate forecasting in LogisticsNetwork" `
  -Body @"
**Backlog ref:** §22 — Global Logistics Broker Paper
**Priority:** Untiered (enhancement to existing logistics)

`getEffectiveAmount()` has a comment: `// simplified (no predictive CPU bomb)` — production prediction was deferred.

**What it does:** When dispatching a hauler to a container 20 ticks away, predict the miner will add 200 energy by arrival. Dispatch earlier; arrive to a fuller load.

\`\`\`ts
const productionPreview = Math.min(containerFreeCapacity, miningRate * distanceToHauler);
return amount + productionPreview + incoming - outgoing;
\`\`\`

Gate: only apply when target is a source container with an active miner. Cache `isSourceContainer` from `MiningOverlord.init()`.

*Full research context: docs/screeps_backlog.md §22*
"@ `
  -Labels @("logistics")

New-Issue `
  -Title "§23 War-Time Hauler Surge Spawning — +25% hauler count during active attack" `
  -Body @"
**Backlog ref:** §23 — Global Logistics Broker Paper
**Priority:** Untiered (defense enhancement)

`TransporterOverlord` doesn't increase hauler count when the room is under attack. Towers can go dark if haulers are killed faster than they spawn.

**Fix in TransporterOverlord.init():**
\`\`\`ts
const isUnderAttack = this.colony.room?.find(FIND_HOSTILE_CREEPS)?.length > 0;
const surgeMultiplier = isUnderAttack ? 1.25 : 1.0;
const targetCount = Math.ceil(baseHaulerCount * surgeMultiplier);
\`\`\`

Also: during attack, spawn fast-deploy `[CARRY×5, MOVE×5]` hauler at elevated priority (100 vs 40) instead of waiting for a full multi-part body.

*Full research context: docs/screeps_backlog.md §23*
"@ `
  -Labels @("defense", "logistics")

New-Issue `
  -Title "§24 Squad Supply Lines — energy haulers routing to front-line offensive squad" `
  -Body @"
**Backlog ref:** §24 — Global Logistics Broker Paper
**Prerequisite:** T4.3 (Squad Combat) must be built first

When a squad operates in a remote room, it has no energy supply line and runs dry.

**Design:**
- `SquadOverlord` registers as a mobile requester at current position.
- `SupplyLineProcess` in Kernel dispatches hauler from home when squad `energy < 50%`.
- Hauler CostMatrix: set enemy tower range zones to cost 255.

*Full research context: docs/screeps_backlog.md §24*
"@ `
  -Labels @("military", "logistics")

New-Issue `
  -Title "§27 Nuke Detection and Emergency Rampart Response" `
  -Body @"
**Backlog ref:** §27 — Military Paper
**Priority:** Untiered (must implement before RCL 8 becomes relevant)

No code detects incoming nukes. A nuke landing without response destroys everything in radius regardless of rampart HP < 10M (outer) / 20M (center).

**Detection:** `room.find(FIND_NUKES)` — each Nuke has `pos` and `timeToLand`.

**Response when `timeToLand < 5000`:**
1. Flag radius tiles in `Memory.rooms[room].nukeZones`.
2. `WorkerOverlord` prioritizes rampart repair in nukeZones above all construction.
3. `TowerOverlord` switches to max-rate rampart repair.
4. If storage or spawn in blast radius: terminal energy dump to safe room, consider Safe Mode.

*Full research context: docs/screeps_backlog.md §27*
"@ `
  -Labels @("defense")

New-Issue `
  -Title "§28 Hostile Catalog — persistent threat intelligence per player" `
  -Body @"
**Backlog ref:** §28 — Military Paper
**Priority:** Untiered (enhances defense accuracy)

No persistent record of which players have attacked, their boost tier, or room RCL. Each tick's hostiles are a fresh scan with no historical context.

**Implementation (Memory.hostiles catalog):**
\`\`\`ts
interface HostileRecord {
    username: string; lastSeen: number;
    observedBoosts: string[]; attackCount: number; maxThreatScore: number;
}
\`\`\`

Populate in `DefenseOverlord.init()` when hostiles detected. Use `observedBoosts` to pre-select counter-body before next attack.

*Full research context: docs/screeps_backlog.md §28*
"@ `
  -Labels @("defense")

New-Issue `
  -Title "§29 Per-Tick Combat Simulation — 10-tick survival projection before committing" `
  -Body @"
**Backlog ref:** §29 — Military Paper
**Prerequisite:** Required for T4.3 (Quad movement) and T4.4 (Tower Drain)

`DefenseOverlord` is reactive. The paper describes a proactive simulator answering: \*\*"If the quad moves to tile X, will it survive?"\*\*

**Simulation function:**
\`\`\`ts
function simulateSurvival(body, towerCount, towerRange, healerCount, healBoost, ticks): boolean
\`\`\`
Runs N-tick forward projection; returns false if HP drops to 0.

**Use cases:**
- Before DestroyerOverlord enters: simulate 3 ticks at current tower count.
- Before Quad advances: simulate worst-case focus fire.
- In DrainerOverlord: confirm SOAK step survives before stepping in.

*Full research context: docs/screeps_backlog.md §29*
"@ `
  -Labels @("military")

New-Issue `
  -Title "§36 TTL-Based Pre-Spawning — replace replacement before creep dies" `
  -Body @"
**Backlog ref:** §36 — Automated Foundry Paper
**Priority:** High (each miner gap costs ~2,000 energy)

Every Overlord checks `miners.length < targetCount` but doesn't account for a miner with 5 ticks to live.

**Fix (add to MiningOverlord, ReserverOverlord, TransporterOverlord):**
\`\`\`ts
const activeMiners = this.miners.filter(m => {
    const ttl = m.creep?.ticksToLive ?? 0;
    const leadTime = m.creep!.body.length * CREEP_SPAWN_TIME + this.travelDistance;
    return ttl > leadTime;
});
if (activeMiners.length < this.targetCount) this.colony.hatchery.enqueue({ ... });
\`\`\`

Priority order: MiningOverlord → ReserverOverlord → TransporterOverlord.

*Full research context: docs/screeps_backlog.md §36*
"@ `
  -Labels @("logistics", "performance")

New-Issue `
  -Title "§37 Flow-Based Spawn Scheduling — E/t net flow safety valve" `
  -Body @"
**Backlog ref:** §37 — Automated Foundry Paper
**Priority:** Medium (safety valve for count-system blind spots)

Count-based spawning misses cases where a colony is energy-negative but all count targets are met.

**Signal injection (add to ColonyProcess):**
\`\`\`ts
colony.state.netEnergyPerTick = ept_production - ept_consumption;
if (netEnergyPerTick < 0 && storageLevel < 50_000) {
    colony.hatchery.enqueue({ priority: 90, bodyTemplate: [WORK, WORK, MOVE], overlord: this });
}
\`\`\`

Not a replacement for count-based spawning — acts as a safety valve when count system misses a flow problem.

*Full research context: docs/screeps_backlog.md §37*
"@ `
  -Labels @("logistics")

New-Issue `
  -Title "§38 Multi-Room Spawning — GlobalSpawnManager for cross-colony spawn routing" `
  -Body @"
**Backlog ref:** §38 — Automated Foundry Paper
**Prerequisite:** T3.5 (Automated Expansion must be active)

At RCL 1/2, new rooms can only produce 300-energy creeps. No way to request large pioneers from a mature neighbor.

**GlobalSpawnManager design:**
- Runs before colony run loops each tick.
- Finds best candidate colony (closest to target, has free spawn, meets energy requirement).
- Routes spawn request to that colony's Hatchery.
- Used by ColonizeDirective to spawn pioneers cross-colony.

*Full research context: docs/screeps_backlog.md §38*
"@ `
  -Labels @("expansion")

Write-Host "`n✅ All issues created!"
Write-Host "Original reference files preserved:"
Write-Host "  - docs/screeps_backlog.md"
Write-Host "  - docs/implementation_priority.md"
