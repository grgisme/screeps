# Screeps Implementation Priority List
> Generated: 2026-02-23. Current state: RCL 3. Last updated: 2026-02-24.
> **Season 8 starts March 1** — items marked 🏁 are pre-season-critical.
> ✅ = implemented and deployed

---

## How to Read This

- **Tier** = urgency band. Work top-to-bottom within each tier.
- **§** = backlog section with full implementation details.
- **RCL** = when this feature becomes active/relevant.
- Items within a tier are ordered: implement top item first.

---

## Tier 0 — Fix Now (Live Bugs, Breaking Issues)

> These are confirmed bugs in the current running code. Fix before any feature work.

| # | Item | §Ref | RCL | Why Now |
|---|---|---|---|---|
| ~~T0.1~~ ✅ | ~~**`console.log` HTML output broken**~~ — `logHTML()` + `console.logUnsafe` path added; all `log.*()` methods now colored | §91 | All | Done v5.17 |
| ~~T0.2~~ ✅ | ~~**`ErrorMapper._traceCache` unbounded**~~ — already had 200-key clear guard; confirmed adequate | §92/Bug F | All | Already fixed |
| ~~T0.3~~ ✅ | ~~**`Transporter.ts` never instantiated**~~ — deleted `Transporter.ts` and test file | §92/Bug G | All | Done v5.17 |
| ~~T0.4~~ ✅ | ~~**BunkerLayout road/tower overlap**~~ — `addRoad()` checks `OCCUPIED` set; overlap prevented by design | §92/Concern 2 | RCL 4+ | Non-issue confirmed |
| **T0.5** 🚨 | **Queue Spam Memory Leak** — `BootstrappingOverlord` enqueues a new Pioneer every tick when spawn is pending in `Hatchery.queue`; Memory bloats until CPU crash | §94.1 | All | **Confirmed fatal** on wipe — causes total OOM/CPU crash |
| **T0.6** 🚨 | **Split-Morphology De-Sync** — Drop-Miner enqueued at 150e; Highlander check blocks Relay Hauler forever; miner mines into ground, blackout never resolves | §94.2 | All | **Confirmed fatal** — delete Protocol Layer 2 entirely |
| **T0.7** 🚨 | **Zero-Capacity State Machine Freeze** — Drop-miners have 0 CARRY; FSM flips to Working Phase instantly, `transfer(0e)` softlocks forever | §94.3 | All | **Confirmed fatal** — guard state transitions on store capacity |
| **T0.8** 🚨 | **Task Priority Erasure** — `setTask(HarvestTask)` overwrites `MovePriority.EMERGENCY` with LOW; bootstrappers blocked by idle creeps | §94.4 | All | Architectural — bypasses emergency traffic priority entirely |
| **T0.9** 🚨 | **Forever RCL 1 Stall** — Working Phase idles when spawn full; never builds extensions or upgrades controller; room stalls at RCL 1 | §94.5 | All | **Confirmed fatal** — implement Waterfall cascade |
| **T0.10** 🚨 | **One-Energy Buffer Trap** — `_findBufferEnergy` triggers Hauler spawn from 1e tombstone; creep idles permanently (no WORK parts) | §94.6 | All | Raises `MIN_BUFFER_ENERGY = 50`; prefer Omni-Pioneer |
| **T0.11** 🚨 | **Hostile Blindness** — `FIND_SOURCES_ACTIVE` ignores camped sources; bootstrappers walk into Invaders, die, waste last 200e | §94.7 | All | **Confirmed fatal** — add 5-tile hostile exclusion zone |

---

## Tier 1 — RCL 1–3 Critical (Do This Week)

> Direct impact on your *current* RCL 3 game state. These prevent death spirals, improve income, and stabilize the colony you're running right now.

| # | Item | §Ref | RCL | Why High |
|---|---|---|---|---|
| ~~T1.1~~ ✅ | ~~**Safe Mode: include NPC Invaders in breach check**~~ — playerThreat + npcThreat split in `DefenseOverlord` | §93/Feature 2 | 1+ | Done v5.18 |
| ~~T1.2~~ ✅ | ~~**Safe Mode: critical structure HP% trigger**~~ — 30% HP gate on spawn/storage/terminal/tower | §93/Feature 1 | 3+ | Done v5.18 |
| ~~T1.3~~ ✅ | ~~**Safe Mode: last-charge conservation**~~ — `shouldUseSafeMode()` guard at both fire sites | §93/Feature 3 | 1+ | Done v5.18 |
| ~~T1.4~~ ✅ | ~~**Blind Reservation Fallback**~~ — persists `reservationTicksToEnd` to Memory; decrements blind | §12 | 2+ | Done v5.19 |
| ~~T1.5~~ ✅ | ~~**EPT Tracking & Economic Horizon**~~ — suspension gate at distance>150 & eptNet<3; 5000-tick cooldown | §10 | 2+ | Done v5.19 |
| ~~T1.6~~ ✅ | ~~**InvaderCore Detection & Cleanup**~~ — WORK×5 Cleaner spawned at priority 150; `dismantle()` micro | §9, §79 | 2+ | Done v5.19 |
| ~~T1.7~~ ✅ | ~~**Dynamic Invader Counter-Body**~~ — body analysis: melee+heal→ranged, ranged-only→melee, pure melee→kiter | §8 | 2+ | Done v5.19 |
| ~~T1.8~~ ✅ | ~~**Remote mining energy gate**~~ — already implemented: <50k skip all, 50-75k miner only, ≥75k full ops | §83/§85 | 3 | Already in code |
| ~~T1.9~~ ✅ | ~~**Upgrader storage floor**~~ — `UPGRADER_STORAGE_FLOOR = 100_000` already in `UpgradingOverlord` | §85 | 3 | Already in code |
| ~~T1.10~~ ✅ | ~~**WithdrawTask: validate target ID**~~ — `isValid()` checks `store.getUsedCapacity > 0` on every tick | §89 Sys 5 | All | Already in code |
| **T1.11** | **Ghost Overlord State Leak** — bootstrapper creeps remain attached to `BootstrappingOverlord` after blackout resolves; memory rewrite handoff needed | §94.8 | All | Memory never cleaned up; WorkerOverlord can't claim the creeps |
| **T1.12** | **Parallelized Recovery** — single-creep limit (`if bootstrappers.length > 0 return`) dramatically extends blackout; swap to dynamic cap of 3–4 pioneers | §94.9 | All | Top bots parallelize 3–4 pioneers; reduces recovery time by ~50% |
| **T1.13** | **Omni-Pioneer Body Generator** — replace all bootstrap creep spawning with `[WORK,CARRY,MOVE]×N` triads scaled to `energyAvailable`; delete Protocol Layer 2 | §94.10 | All | Foundational fix — required by T0.6 (split morphology removal) |
| **T1.14** | **Emergency Task Bypass** — remove `setTask()` from `BootstrappingOverlord`; use raw `creep.harvest/build/transfer/upgradeController` to preserve `MovePriority.EMERGENCY` | §94.12 | All | Foundational fix — resolves T0.8 permanently; prevents Task system from clobbering priority |

---

## Tier 2 — RCL 3–4 Infrastructure (This Month)

> Foundation work that unlocks efficient RCL 4 and protects the transition. Also includes Season 8 prep.

| # | Item | §Ref | RCL | Why |
|---|---|---|---|---|
| ~~T2.1~~ ✅ 🏁 | ~~**Season Mode Flag**~~ — `SEASON_MODE=false`, `SEASON_CPU_CAP=100`, `EFFECTIVE_CPU_CAP` in `main.ts`; console `season.enable()` | §88/Feature 1+2 | Season | Done — flip `SEASON_MODE=true` before March 1 |
| ~~T2.2~~ ✅ 🏁 | ~~**TerminalOverlord market gate**~~ — all `Game.market.*` + `calcTransactionCost` gated behind `!SEASON_MODE`; `terminal.send()` always on | §88/Feature 4 | Season | Done v5.20 |
| ~~T2.3~~ ✅ 🏁 | ~~**RoomScorer apex-rush mode**~~ — `seasonMode` param on `scoreRoom()` / `rankRooms()`; Level²×20 formula; neutral ctrl = Level 5 potential | §88/Feature 3 | Season | Done v5.20 |
| T2.4 🏁 | **Verify Season 8 spawn-per-room cap** — Season 7 had 1 spawn/room hard cap; Season 8 unclear | §91 | Season | **Manual check required before March 1** — read official S8 announcement |
| T2.5 | **`Colony.refresh()`: cache all FIND_* results** — called once; expose as properties used by all overlords | §89 Sys 2 | All | Without this every overlord does its own `room.find()` — O(overlordCount) identical calls per tick. Highest CPU bang-for-buck fix available. |
| T2.6 | **`LogisticsNetwork.requestTask` O(N²) fix** — scoring loop iterates all offers per requesting creep | §89 Sys 2 | All | Scales badly. Pre-sort offers by priority once per tick; share result across all creep matching calls. |
| T2.7 | **`GlobalCache` max-entries guard + LRU eviction** — unbounded growth after global resets | §89 Sys 1 | All | Cache grows every reset until out-of-memory. Cap at 500 entries with LRU eviction. |
| T2.8 | **`PathFinder.CostMatrix` rebuild guard** — road-health flag check must not rebuild full matrix every tick | §89 Sys 3 | All | Full CostMatrix rebuild costs ~0.5 CPU. Gate: set dirty flag per tick, rebuild only on 100-tick interval. |
| T2.9 | **Memory.creep dead-key purge interval** — ensure not running purge + GC O(N) in same tick | §89 Sys 1 | All | At 50+ creeps this is measurable. One pass, one tick — not two separate O(N) loops back-to-back. |
| T2.10 | **Hatchery: `generateBody` memoize on `(role, energy)` pairs** | §89 Sys 4 | All | Same body requested O(overlords) times per tick. `GlobalCache` key = `body:${role}:${energy}`. |
| T2.11 | **`MiningSite.ts`: cache `source` on heap** — `Game.getObjectById(sourceId)` called every tick; sources never move | §89 Sys 2 | All | Per-tick ID lookup where a one-time heap cache suffices. |
| T2.12 | **`SegmentManager.ts`: skip `setActiveSegments` when unchanged** | §89 Sys 1 | All | 0.1 CPU intent saved every tick the desired segments don't change. |
| T2.13 | **RawMemory Segments for large data** — Memory approaching 2MB ceiling with scouting data | §3, §67 | 3+ | Room scouting data, cost matrices, error logs should move to segments before Memory cap hit. |
| T2.14 | **DCC-themed public controller signs and `say` messages** | §90/A | All | Cosmetic — do after functional items, but fun boost: sign rooms + public role says. |
| T2.15 | **Creep name prefixes for decoration filtering** — `Carl_`, `Donut_`, `EmperorBob_` in Hatchery | §90/B | All | Zero logic change; just name generation. Enables UI decoration skin-per-role filtering. |

---

## Tier 3 — RCL 4–6 Expansion & Economy (Next 2-3 Months)

> Enables the mid-game economic engine and first expansion.

| # | Item | §Ref | RCL | Why |
|---|---|---|---|---|
| T3.1 | **Terminal / Market Automation** — sell energy surplus, buy shortage minerals | §2, §15-§22 | 6 | Unlocks passive credit income. Required for boosts. |
| T3.2 | **LinkNetwork: Tower Link role** — towers currently not connected to link network | §15-§22 | 5 | Tower link feeds tower energy passively; no haulers needed for tower reloading. |
| T3.3 | **Optimal Container Placement** — container placed at closest-to-exit source tile | §11 | 2+ | Reduces hauler round-trip distance. Retroactively improves existing rooms. |
| T3.4 | **`StructureObserver` round-robin scan** — eliminate ScoutOverlord spawn cost | §90/C | 6 | Observer covers 10-room radius at 0 spawn cost vs. constant scout creep spawning. |
| T3.5 | **Automated Room Expansion** — full decision engine + ColonizeDirective lifecycle | §6 | 5+ | Currently manual flag only. Automate when storage > 100k + GCL allows. |
| T3.6 | **Room Scouting and Scoring** — `RoomScorer.ts` + `ScoutOverlord` integration | §85, §6 | 2+ | Without this automated expansion has no candidate rooms to pick from. |
| T3.7 | **`Directive.ts`: build `Game.flags` index once per tick** — currently O(directives × flags) | §89 Sys 8 | All | Flag map built as `Map<string, Flag>` in `main.ts` pre-loop; passed to all directives. |
| T3.8 | **`ColonizeDirective.ts`: cache phase in Memory** — `FIND_MY_SPAWNS` full scan every tick | §89 Sys 8 | 3+ | Phase re-evaluated only on known events, not every tick. |
| T3.9 | **`single-CLAIM reserver body`** — 1 CLAIM + 5 MOVE; current body overspends on CLAIM count | §85 | 2+ | Cheaper reserver = faster spawn from lower energy cap. Works at RCL 3+. |
| T3.10 | **Controller downgrade timer claim-sniping** — detect `ticksToDowngrade < 5000`, send claimer | §85 | 3+ | Steals rooms abandoned by players without spending attack creeps. |
| T3.11 | **Neighbor RCL WorldState profiling** — scout adjacent players' RCL/defenses, tag in WorldState | §85 | 3+ | Informs expansion targeting and military threat assessment. |
| T3.12 | **Early PvP harassment protocol** — `attackController()` against RCL 1-2 neighbors | §85 | 3+ | Delays rivals at critical bootstrap window with small CLAIM-body creeps. |
| T3.13 | **`flag.memory` for directive state** — cleaner than `Memory.rooms[r]`; auto-GC with flag removal | §90/C | All | Refactor directive phase storage; prevents orphan Memory keys when flags are deleted. |
| T3.14 | **Power Spawn automation** — process Power via `powerSpawn.processPower()` for GPL | §37-§45 | 8 | Generates GPL, enables PowerCreep classes. |

---

## Tier 4 — RCL 6–8 Endgame Systems

> High-complexity features that require mature infrastructure from Tier 1-3 first.

| # | Item | §Ref | RCL | Prerequisite |
|---|---|---|---|---|
| T4.1 | **Boosts / Labs (Science Overlord)** — full reaction chain, scientist FSM, boost-before-spawn | §7, §46-§50 | 6 | Terminal market (T3.1) must supply reagents |
| T4.2 | **Source Keeper Suppression** — SK rooms yield 13.3 e/tick; requires permanent guard | §13, §80 | 7 | Storage > 300k, RCL 7, Guard body design |
| T4.3 | **Squad / Quad Combat Formation** — 2×2 formation, pull chain, predictive triage | §4, §51-§54 | 7 | Boosts (T4.1) required for viable quads |
| T4.4 | **DestroyerOverlord: TOWER_DRAIN mode** — 25×TOUGH + Healer pair drains 6 towers | §87 | 7 | Boosts (T4.1) required; unboosted TOUGH is trivial |
| T4.5 | **DestroyerOverlord: CONTROLLER_ATTACK mode** — `attackController()` 100 dmg/tick/WORK | §87 | 6 | Guard directive + military coordination |
| T4.6 | **DestroyerOverlord: WAVES / TRICKLE modes** | §87 | 6 | Tower count detection logic |
| T4.7 | **Market Commodities — Factory production pipeline** | §90/C | 7 | Factory (RCL 7), Terminal market (T3.1) |
| T4.8 | **PowerCreep: OPERATE_SPAWN (2× speed) + OPERATE_EXTENSION** | §90/C, §14 | 8 | GPL from Power Spawn (Tier 3.14) |
| T4.9 | **PowerCreep: OPERATE_TOWER (double damage)** | §90/C | 8 | After OPERATE_SPAWN priority |
| T4.10 | **`TerminalOverlord.ts`: cache `getAllOrders()` with 100-tick TTL** | §89 Sys 10 | 6 | ~1000-entry array; never call in main loop without cache |
| T4.11 | **Pixel farming automation** — `generatePixel()` before Kernel.run() when bucket ≥ 10k | §87, §88 | All | Disabled in Season 8; enable only for persistent world |
| T4.12 | **Memory queue admin commands** (`global.q.attack`, `global.q.reserve`, etc.) | §87 | All | QoL for manual intervention |
| T4.13 | **`ScoutOverlord`: write `Memory.worldState` only on change** — currently writes same data repeatedly | §89 Sys 9 | All | Gate: `Game.time - lastSeen > 50` or data diff |
| T4.14 | **GCL formula for bucket thresholds** — `CPU_CAP * 10` / `* 5` not hardcoded values | §87 | All | After Season Mode (T2.1); persistent world needs GCL-adaptive thresholds |
| T4.15 | **RawMemory circular log buffer** | §67 | All | Replaces unbounded `Memory.errorLog`; needed before heavy prod logging |

---

## Tier 5 — Future / When Relevant

> Skip until specific conditions are met. Don't implement speculatively.

| # | Item | §Ref | Condition to Implement |
|---|---|---|---|
| T5.1 | **Inter-Shard Memory (ISM)** | §5, §90/C | When empire spans > 1 shard |
| T5.2 | **Power Creep classes: Commander & Executor** | §91 | When officially released (announced for 2026 but not yet done) |
| T5.3 | **Warp Containers** | §91 | When officially released |
| T5.4 | **ES Module restructure** | §91 | When Premium Shard launches |
| T5.5 | **Score-Resource Delivery Overlord** (Season 7 mechanic) | §91 | If future season uses this mechanic (monitor each season announcement) |
| T5.6 | **Arena port** | §88/Feature 6 | If targeting Arena Season 2+ matches |
| T5.7 | **`InterShardMemory` cross-shard market arbitrage** | §90/C | GCL 10+ multi-shard |
| T5.8 | **Power Bank raiding** | §37-§45 | RCL 8, GPL infrastructure ready |

---

## Quick Reference: Season 8 Pre-Launch Checklist 🏁
> Must be done before **March 1, 2026** (6 days from now)

- [x] T0.1 — `logHTML()` + `console.logUnsafe` + colored level badges ✅
- [x] T2.1 — `SEASON_MODE=false`, `SEASON_CPU_CAP=100`, console toggle ✅ → flip to `true` before March 1
- [x] T2.2 — `TerminalOverlord` market calls gated; `terminal.send()` always on ✅
- [x] T2.3 — `scoreRoom(seasonMode=true)` uses Level² formula ✅
- [ ] T2.4 — **Read Season 8 announcement before March 1** for spawn-per-room cap ⚠️
- [x] T1.2 — Safe mode 30% HP% trigger implemented ✅

---

## Notes on Ordering Within Tiers

- **Bugs first**: T0 items are never deferred — they affect current running code.
- **Season 8 🏁 items beat everything in Tier 2** if the season starts before Tier 1 is done.
- **T1 and T2 can interleave** — do whichever is easiest first to maintain momentum.
- **T3 items are mostly independent** of each other after T3.1 (Terminal). T3.6 (RoomScorer) must precede T3.5 (expansion) but that's the only hard ordering.
- **T4 items have strict prerequisites**: Labs (T4.1) unlock Boosts which unlock viable Quads (T4.3) and TOWER_DRAIN (T4.4). Don't build T4.3-T4.6 before T4.1.
