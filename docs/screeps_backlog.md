# Screeps Long-Term Implementation Backlog

> Derived from the 2025 Architectural Engineering Report.
> All items the forensic audit confirmed are **not yet implemented**.
> The research paper can be archived — all necessary design details are here.

---

## 1. Safe Mode Automation
**Report §9.3**

Currently the bot does not auto-trigger Safe Mode. If the bot is attacked while the player is offline, critical structures can be destroyed before any response.

**Implementation:**
- In `DefenseOverlord.ts`, monitor `hits` on critical structures each tick: spawn, storage, towers.
- If `hits < threshold` (e.g. spawn below 200k, storage below 500k), call `room.controller.activateSafeMode()`.
- Add a Memory flag `safeModeFired: boolean` to avoid re-triggering on the same attack.
- The threshold must be dynamic — at RCL 5 ramparts absorb hits, so only fire if ALL ramparts covering the structure are also below 20% HP.

```ts
// Rough sketch in DefenseOverlord.run():
if (spawn.hits < 200_000 && !Memory.rooms[roomName].safeModeFired) {
    room.controller.activateSafeMode();
    Memory.rooms[roomName].safeModeFired = true;
}
// Reset flag when no threat present for 50+ ticks
```

---

## 2. Terminal / Market Automation
**Report §10, §3 (TerminalOverlord)**

`TerminalOverlord.ts` exists but is minimal (~3KB). Full market automation requires:

### 2a. Energy Surplus Selling
- When `storage.energy > 600k` AND `terminal.energy > 50k`, post a sell order for energy at `market.getHistory(RESOURCE_ENERGY)` median price.
- Cancel stale orders older than 3000 ticks.

### 2b. Credit-Funded Mineral Trading
- Track which minerals the bot produces (extractor room).
- Post sell orders for excess minerals using `Game.market.createOrder`.
- Buy minerals needed for boosting from cheapest available sell orders within shard.

### 2c. Inter-Room Terminal Balancing
- Transfer energy from high-storage rooms to low-storage rooms via terminal (10k energy cost per transfer; weigh against need).

### 2d. CPU-Friendly Scheduling
- Market operations are expensive. Gate all market API calls behind `Game.time % 100 === 0` OR when storage crosses a threshold. Never call every tick.

```ts
// Pattern:
if (Game.time % 100 === 0 || storage.energy > SURPLUS_THRESHOLD) {
    this.rebalanceOrders();
}
```

---

## 3. RawMemory Segments for Large Data
**Report §5.2**

Current bot stores everything in `Memory` (2MB cap). Large datasets — cost matrices, historical market data, scouting maps — need segments.

**Segment API facts:**
- `RawMemory.setActiveSegments([0, 1, 2])` — request up to 10 segments (100KB each = 1MB total).
- Data is available on the **next tick** after requesting.
- `RawMemory.segments[id]` — string, must be manually `JSON.parse`/`JSON.stringify`.

**Implementation pattern (async fetch via Kernel process):**
1. Create a `SegmentReadProcess` that requests a segment and sleeps 1 tick.
2. On wake, parses the segment and stores the result in `GlobalCache`.
3. The consumer process ('HistoricalMarket') checks `GlobalCache` — if missing, wakes SegmentReadProcess.
4. `SegmentManager.ts` already exists — extend it to expose `read(segId): Promise-like` API using the sleep/wake pattern.

**Use cases to segment-back:**
- Room scout reports (currently in `Memory.rooms` — can balloon with many scouted rooms)
- Cost matrices for remote rooms (currently rebuilt each global reset)
- Market price history (for smarter sell timing)

---

## 4. Squad / Quad Combat Formation
**Report §9.2 — now superseded by detailed Quad Systems Paper (§51-54)**

Currently the bot only uses single-unit military (defenders and destroyers). Attacking defended rooms requires coordinated squads.

> **See §51-54 for full implementation details.** The sections below are the original high-level design; defer to §51-54 for the actual code patterns.

### 4a. Squad Object
```ts
class Squad {
    members: Zerg[];      // exactly 4 for a Quad
    formation: "quad" | "snake";  // §54: 2×2 ↔ 1×4 transition
    target: RoomPosition;
    path: string;         // shared serialized path (computed once via dilated matrix — §51)
}
```

### 4b. Movement
- All 4 creeps share a single dilated `PathFinder.CostMatrix` path (§51) — never individual pathfinding per creep
- Squad leader moves via `creep.pull()` chain (§52) — lockstep movement, shared fatigue pool
- If any member has fatigue > 0: entire squad idles that tick (swamp one member = stop all)
- Snake formation for 1-wide chokepoints — FIFO position buffer (§54)

### 4c. Healing Logic
- Predictive triage (§53): predict tower DPT per member, sort by deficit, assign healers before damage resolves
- In 2×2 formation: `heal()` (melee) for all members within range 1
- In snake formation: switch to `rangedHeal()` — adjacency between head and tail is lost

### 4d. Formation Integrity Check
- Before moving, verify all 4 members are still adjacent (range ≤ 1 to each other)
- If not: HOLD — leader stays, others move toward leader first using standard pathfinding
- Detached member uses `travelTo(leader.pos, 1)` temporarily bypassing the squad pull chain

### 4e. Quad Body (standard meta)
```ts
// Engine (2×): [TOUGH×4, MOVE×6, HEAL×8]   — extra MOVE absorbs followers' fatigue
// Heavy  (2×): [TOUGH×4, MOVE×2, WORK×12]  — MOVE-light; fatigue transferred to Engine
// Boosts: XGHO2 (TOUGH), XZHO2 (MOVE), XLHO2 (HEAL), XUH2O (WORK/dismantle)
```

## 5. Inter-Shard Memory (ISM)
**Report §5.3 — Only relevant at GCL 10+ / multi-shard**

> Skip until the bot spans more than one shard. Document here for future reference.

### Design
- `InterShardMemory.getLocal()` / `setLocal()` — string I/O per shard (10KB limit).
- Communication is **not immediate**: shard A writes, shard B reads on its next tick.

### Portal Manager Process
```ts
class PortalManagerProcess extends Process {
    run(): void {
        // 1. Check InterShardMemory.getRemote() for incoming creep manifests
        const incoming = JSON.parse(InterShardMemory.getRemote() || "{}");
        // 2. For each manifest, spawn a GhostProcess that waits at the portal tile
        // 3. Write outbound creep intents to InterShardMemory.setLocal()
    }
}
```

### Creep Manifest Schema
```ts
interface CrossShardManifest {
    creepName: string;
    role: string;
    task: string;        // serialized task
    colonyTarget: string;
    arrivalShard: string;
}
```

### Ghost Process
- Spawned when a manifest is received.
- Waits at the expected portal tile.
- When `Game.creeps[manifest.creepName]` exists, assigns the task and terminates.

---

## 6. Automated Room Expansion (Full Autonomy)
**Report §10.2, §10.1 / Empire Scale Paper — ColonizeDirective Lifecycle**

Currently expansion is manual via `claim:` flag. The infrastructure to *score* rooms exists (`RoomScorer.ts`, `ScoutOverlord.ts`). What is missing is **automated claim decision-making** and the full lifecycle management of a new colony.

### 6a. Net Energy Surplus Gate (Pre-Expansion Math)
Expansion is only authorized when the parent has surplus beyond its own needs:
```
E_net = E_income - E_creep_upkeep - E_maintenance - E_upgrade_floor

Where:
  E_income          = 10 E/tick per owned source (or 5 for remote)
  E_creep_upkeep    = (minerCost + haulerCost) / 1500 creep lifetime
  E_maintenance     = roads + containers + rampart baseline repair cost
  E_upgrade_floor   = 15 E/tick required to prevent RCL 8 controller downgrade

Expansion authorized when: E_net >= E_expansion_cost_per_tick
```
Also require **storage > 100,000 energy** as a physical safety buffer. If storage drops below this during a colonize attempt, pause all pioneer spawning until recovered.

### 6b. Expansion Decision Engine
Gate on:
1. All owned rooms at RCL 6+ (stable income).
2. Combined storage > 100k+ energy per active expansion mission.
3. `E_net > E_expansion_cost_per_tick` (formula above).
4. A scouted room with `scoutScore > EXPANSION_THRESHOLD` exists adjacent to current empire.
5. GCL allows another room (`Game.gcl.level > Object.keys(Game.rooms).filter(owned).length`).

### 6c. ColonizeDirective 4-Phase Lifecycle
```
PHASE 1 SCOUTING    → Spawn [MOVE] scout → gain vision → run Distance Transform + Flood Fill
                       Score: 2 sources > 1 source; large plains area; missing mineral synergy
PHASE 2 CLAIMING    → Spawn Lawyer/Claimer ([CLAIM, MOVE×N]) → claimController()
                       Claimer must arrive within 1,500 ticks
                       Success: room owner changes → sources scale to 3,000 E/300 ticks
PHASE 3 BOOTSTRAPPING → Parent spawns Pioneer waves while room is RCL 1-2
                       Pioneer queue: replacement dispatched when TTL < spawnTime + travelTime
                       Parent may also send Transporter energy if local mining insufficient
PHASE 4 HANDOVER    → Delete ColonizeDirective; promote room to full Colony process
                       Trigger: RCL ≥ 4 AND storage.energy ≥ 10,000 AND spawn exists
```

### 6d. Pioneer Body Designs (spawned from RCL 8 parent)
Using full 50-part / 12,900 energy capacity:
| Pioneer Type | Body | Cost | Throughput | Use Case |
|---|---|---|---|---|
| **All-Terrain** | `WORK×25, MOVE×25` | 3,750 | 125 build pts/tick @ 1 tile/tick | No roads, swamp-capable |
| **Heavy Builder** | `WORK×30, CARRY×10, MOVE×10` | 4,000 | 150 build pts/tick | Needs roads for 1/tick |
| **Remote Settler** | `WORK×15, CARRY×10, MOVE×25` | 2,750 | 75 build pts/tick | Long-distance, high swamp |

A single All-Terrain pioneer with 25 WORK burns 25 E/tick building or 50 E/tick upgrading. Verify local sources cover this before sending Heavy Builder.

### 6e. Maturation Milestones
**Defensive Autonomy (RCL 3 + Tower):**
- Light NPC invaders (up to RCL 3) defeated by a single tower (150-600 DPT full range)
- Tower can repair containers/roads during peacetime — no dedicated repairman needed
- Parent withdraws military guards at this milestone

**Economic Autonomy (RCL 4 + Storage ≥ 10k):**
- Storage buffer (1M capacity) decouples production from consumption
- Heavy invaders begin at RCL 4 — room must self-spawn defenders using stored energy
- 20 extensions = 1,300 energy capacity → can spawn full 5 WORK harvester (§55)
- Colony promoted to full autonomous status; parent stops pioneer dispatching

### 6f. CPU Hibernation
If `Game.cpu.bucket < 500`, the ColonizeDirective enters HIBERNATION:
- Suspend all non-essential scouting (increase scan tick from 1 to 10)
- Reduce pioneer spawn priority to low
- Skip all pathfinding for pioneer route recalculation
- Resume when `bucket > 2000`

### 6g. Colonization Failover and Cool-down
```ts
// In ColonizeDirective.run():
if (Game.time - this.startTick > 500 && !this.room?.controller?.my) {
    // Controller not claimed after 500 ticks — contested or inaccessible
    Memory.colonizeCooldown[this.targetRoom] = Game.time + 10_000; // 10k tick quarantine
    this.remove(); // Delete directive
}

// In expansion decision engine:
if ((Memory.colonizeCooldown[targetRoom] ?? 0) > Game.time) continue; // Skip quarantined rooms
```
If the controller is **reserved** by another player: escalate (spawn Claimer with CLAIM to override), or concede after 200 ticks and quarantine.

---

## 7. Boosts / Labs (Science Overlord)
**Report §8 / Strategic Directives Paper — Chemical Sovereignty**

No lab logic exists yet. No `LabOverlord`, `ScienceOverlord`, or `Scientist` creep.

### Boost tiers (priority order for implementation)
| Boost | Compound | Effect |
|---|---|---|
| T3 MOVE | `XZHO2` | 4× effective MOVE parts (quad/healer mobility) |
| T3 HEAL | `XLHO2` | 4× heal output — essential for Quad survival |
| T3 TOUGH | `XGHO2` | 70% damage reduction (3.33× effective HP) |
| T3 WORK | `XLH2O` | 4× build/repair/dismantle — bunker construction + siege |
| T3 ATTACK | `XUH2O` | 4× melee damage |
| T3 RANGED | `XKHO2` | 4× ranged damage |

### Lab Network Layout
- Designate **2 input labs** (receive reagents from Terminal) and **N output labs** (boost labs)
- `ScienceOverlord` manages reaction scheduling; `LabOverlord` is its spawning arm
- Boosts applied in `Hatchery.ts` immediately before spawning the creep via `lab.boostCreep()`
- Track boost inventory in `Memory.colonies[name].boosts`

### Recursive REACTIONS DAG (Stoichiometry Engine)
```ts
// REACTIONS global: { [product]: { [reagent1]: reagent2 } }
// Decompose a target compound into all required precursors:
function getReactionChain(target: ResourceConstant, have: Record<ResourceConstant, number>): Recipe[] {
    const result: Recipe[] = [];
    function decompose(product: ResourceConstant, amount: number) {
        const reagents = REACTIONS[product];
        if (!reagents) return; // base mineral, no further decomposition
        const [r1, r2] = Object.entries(reagents)[0] as [ResourceConstant, ResourceConstant];
        const needed = Math.max(0, amount - (have[product] ?? 0));
        if (needed <= 0) return; // Already in stock, skip
        result.push({ product, amount: needed, reagent1: r1, reagent2: r2 });
        decompose(r1, needed); // Recurse into dependencies
        decompose(r2, needed);
    }
    decompose(target, 1000); // Request 1000 units as baseline
    return result.reverse(); // Topological order (base compounds first)
}
```
Cooldowns scale with tier: base minerals 5 ticks, T1 10 ticks, T2 10 ticks, T3 80 ticks. Schedule lowest-cooldown reactions first to back-fill the pipeline.

### Scientist Creep FSM (4 priority states)
```
RENEW_STATE    → Triggered when TTL < (travelTime + 50). Prevents losing minerals in
                  transit. Move to spawn and renew before proceeding.

SUPPLY_STATE   → Withdraw reagents from Terminal; deposit into input labs.
                  Condition: inputLab.store[reagent] < targetAmount

COLLECT_STATE → Return finished product to Terminal when output lab hits threshold.
                  Condition: outputLab.store[product] >= 100 units

FLUSH_STATE    → CRITICAL — purge labs of unauthorized resources.
                  Trigger: reaction order changed OR lab contains wrong mineral
                  ("Lab Jam": labs stuck with incompatible reagents block all reactions)
                  Algorithm: withdraw ALL lab contents to Terminal; reset lab state
```

### Military Reagent Reservation (Combat Spike Protocol)
```ts
// When SiegeDirective or DefenseOverlord spawns a boosted unit:
// 1. The spawning call registers a boost request with ScienceOverlord:
colony.science.requestBoost({
    compound: RESOURCE_CATALYZED_GHODIUM_ACID,
    amount: creepBody.filter(p => p === TOUGH).length,
    priority: BOOST_PRIORITY.COMBAT      // Overrides all routine production
});

// 2. ScienceOverlord:
//    - Pauses routine reactions immediately
//    - Flushes labs if necessary (FLUSH_STATE)
//    - Fills input labs with required reagents from Terminal
//    - Marks lab IDs in memory.boostLabs[compound] = labId

// 3. Hatchery, immediately before spawning:
const boostLab = Game.getObjectById(memory.boostLabs[compound]);
if (boostLab && spawn.spawning?.name === creepName) {
    boostLab.boostCreep(Game.creeps[creepName]); // Applied this tick
}
```

---

## Priority Order

```
1. Safe Mode Auto-Trigger          (§9.3)      — defensive hole, low effort
2. Dynamic Invader Counter-Body    (Remote §4) — close remote defense gap
3. InvaderCore Cleanup             (Remote §4) — prevents sovereignty loss
4. EPT Tracking / Economic Horizon (Remote §5) — stop funding losing rooms
5. Terminal Market Automation      (§10)       — revenue unlock, medium effort
6. RawMemory Segments              (§5.2)      — needed before memory bloat hits
7. Optimal Container Placement     (Remote §6) — pathing quality improvement
8. Blind Reservation Fallback      (Remote §2) — reservation gap fix
9. Source Keeper Suppression       (Remote §4) — high-yield rooms
10. Squad Combat                   (§9.2)      — offensive capability
11. Automated Expansion            (§10)       — empire scaling
12. Boosts / Labs                  (implied)   — performance ceiling lift
13. Power Creeps                   (Remote §5) — ceiling lift, late-game
14. Inter-Shard Memory             (§5.3)      — only when multi-shard
```

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- REMOTE MINING PAPER — Items confirmed NOT implemented via code audit    -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 8. Dynamic Invader Counter-Body Spawning
**Remote Mining Paper §4 — Defensive Protocols**

> ✅ **IMPLEMENTED** v5.19 — `RemoteMiningOverlord.init()` + `run()`. On hostile detection, body is analyzed (ATTACK+HEAL → heavy ranged; ranged-only → melee rusher; pure melee → kiter). Counter spawned at priority 200, one per remote room. `run()` micro prioritizes healers. Idles at home when room clears.

`RemoteMiningOverlord` detects hostiles and sets `isDangerous`, evacuating civilians — but does **not** spawn a counter-creep. Remote rooms have zero active defense.

**Implementation:**
1. In `RemoteMiningOverlord.init()`, when `hostiles.length > 0`, analyze the body:
   ```ts
   const hasHeal   = invader.body.some(p => p.type === HEAL);
   const hasRanged = invader.body.some(p => p.type === RANGED_ATTACK);
   const hasAttack = invader.body.some(p => p.type === ATTACK);
   ```
2. Select counter body:
   - Pure melee → kiter: `[RANGED_ATTACK×4, MOVE×4]`
   - Melee + Healer pair → high-DPS ranged: `[RANGED_ATTACK×6, MOVE×6]`
   - Ranged only → melee rusher: `[ATTACK×4, MOVE×4]`
3. Enqueue at priority 200 with `memory.targetRoom = this.targetRoom`.
4. Counter-creep self-dismisses when `hostiles.length === 0` for 10+ ticks.

> **Extra:** Track `Memory.rooms[room].energyHarvested`. "Light" invaders appear early; "Heavy" appear after ~100k energy extracted. Pre-spawn a defender at 90k harvested.

---

## 9. InvaderCore Detection and Cleanup
**Remote Mining Paper §4**

> ✅ **IMPLEMENTED** v5.19 — `RemoteMiningOverlord.init()` detects cores via `FIND_HOSTILE_STRUCTURES`. Spawns WORK×5 MOVE×5 Cleaner at priority 150. `run()` walks Cleaner to core and calls `dismantle()`. Normal mining suspended while core is alive.

InvaderCores spawn in remote rooms and reserve the controller for the Invaders faction, blocking harvesting. Currently undetected and unhandled.

**Detection:**
```ts
const cores = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: s => (s as any).structureType === STRUCTURE_INVADER_CORE
});
```

**Response — spawn a "Cleaner":**
- Body: `[WORK×5, MOVE×5]` — uses `dismantle()` which is 50× more efficient than `attack()` against structures (50 hits/tick/WORK at 1 energy vs. 30 hits/tick/ATTACK).
- Cleaner dismantles the core, then returns home.
- Suspend `RemoteMiningOverlord` for that room while core is alive (reservation is invalid anyway).

**Where to add:** In `RemoteMiningOverlord.init()`, after the hostile check block:
```ts
const cores = room.find(FIND_HOSTILE_STRUCTURES,
    { filter: (s: Structure) => (s as any).structureType === STRUCTURE_INVADER_CORE });
if (cores.length > 0 && !this.zergs.some(z => (z.memory as any)?.role === 'cleaner')) {
    this.colony.hatchery.enqueue({ role: 'cleaner', priority: 150, ... });
    return; // suspend normal mining ops
}
```

---

## 10. Energy-Per-Tick (EPT) Tracking and Economic Horizon
**Remote Mining Paper §5 — ROI and Scaling**

> ✅ **IMPLEMENTED** v5.19 — `RemoteMiningOverlord.init()` checks EPT profitability every 500 ticks per site. If `distance > 150` and `eptNet < 3`, writes `unprofitableUntil = Game.time + 5000` to Memory and skips `handleSpawning()`. Re-evaluates after cooldown.

No room profitability tracking exists. The bot will fund a 250-tile remote room indefinitely, even if hauler body costs exceed energy produced.

**Metric to track in `Memory.rooms[roomName]`:**
```ts
interface RoomStats {
    eptNet: number;      // net energy/tick after subtracting amortized body cost
    distance: number;    // tiles to home storage
    lastSampled: number; // Game.time of last EPT calculation
}
```

**Formula (sampled every 500 ticks):**
```
hauler_cost_per_tick = haulerBodyCost / 1500   (creep lifetime)
miner_cost_per_tick  = minerBodyCost  / 1500
eptGross = 10 (reserved) or 5 (unreserved)
eptNet   = eptGross - hauler_cost_per_tick - miner_cost_per_tick
```

**Economic Horizon rule:** If `distance > 150` AND `eptNet < 3`, set `Memory.rooms[room].isUnprofitable = true` and suspend the overlord. Re-evaluate every 5000 ticks. At distance > 250 tiles, nearly always below horizon.

**Where to add:** In `RemoteMiningOverlord` or `MiningSite.calculateDistance()`, after distance is computed.

---

## 11. Optimal Container Placement
**Remote Mining Paper §6 — Infrastructure**

`ConstructionOverlord` places remote containers at a hardcoded offset from the source. The correct tile is the one adjacent to the source that minimizes path distance to the room exit (maximizing throughput).

**Algorithm:**
```ts
function bestContainerTile(source: Source, homeRoomName: string): RoomPosition {
    const exitDir = Game.map.findExit(source.pos.roomName, homeRoomName) as ExitConstant;
    const exits   = source.room.find(exitDir);
    const adj     = getAdjacentWalkablePositions(source.pos); // all non-wall tiles within range 1
    return adj.sort((a, b) => {
        const da = PathFinder.search(a, exits.map(e => ({ pos: e, range: 0 }))).cost;
        const db = PathFinder.search(b, exits.map(e => ({ pos: e, range: 0 }))).cost;
        return da - db;
    })[0];
}
```
Run once on first visit; cache result in `Memory.rooms[roomName].containerPos`. `ConstructionOverlord` reads this instead of computing an offset.

---

## 12. Blind Reservation Fallback
**Remote Mining Paper §2 — Reservation**

> ✅ **IMPLEMENTED** v5.19 — `ReserverOverlord.init()` now persists `reservationTicksToEnd` to `Memory.rooms[room].reservationTicksToEnd` when visible, and reads+decrements that cached value each blind tick. Reserver spawns before reservation expires even with no vision.

`ReserverOverlord.init()` returns early if `!room || !room.controller`. If the target room has no scout visibility this tick, the overlord silently skips the buffer check — reservation can expire without a reserver being queued.

**Fix — persist last-known ticksToEnd:**
```ts
init(): void {
    this.reservers = this.zergs.filter(z => z.isAlive() && (z.memory as any)?.role === 'reserver');
    if (this.reservers.length > 0) return;

    const room = Game.rooms[this.targetRoom];

    // Use last-known value from Memory when room isn't visible
    const ticksToEnd = room?.controller?.reservation?.ticksToEnd
        ?? (Memory.rooms?.[this.targetRoom] as any)?.reservationTicksToEnd
        ?? 0;

    // Persist for future blind ticks
    if (room?.controller?.reservation !== undefined && Memory.rooms?.[this.targetRoom]) {
        (Memory.rooms[this.targetRoom] as any).reservationTicksToEnd =
            room.controller.reservation?.ticksToEnd ?? 0;
    }

    if (ticksToEnd < this.getThreshold()) { /* enqueue reserver */ }
}
```
Also: `ScoutOverlord` should write `Memory.rooms[roomName].reservationTicksToEnd` each visit.

---

## 13. Source Keeper (SK) Room Suppression
**Remote Mining Paper §4 — SK Operations**

SK rooms yield 4,000 energy/source per 300 ticks (13.3 e/tick) but require permanent combat presence. Currently unsupported.

> **Gate:** Implement at home RCL 7+, storage > 300k. SK rooms are a primary GCL accelerator.

### Roles Required
| Role | Body | Function |
|---|---|---|
| SK Miner | `WORK×7, CARRY, MOVE×4` | Static harvest + self-repair |
| SK Hauler | `CARRY×20, MOVE×10` | Long-range transport |
| SK Guard | `ATTACK×10, HEAL×5, MOVE×15` | Kill Keepers at Lairs every 300 ticks |

### SK Guard Loop
```ts
// Pre-position at the lair with shortest ticksToSpawn
const lairs = skRoom.find(FIND_HOSTILE_STRUCTURES, {
    filter: s => (s as any).structureType === STRUCTURE_KEEPER_LAIR
});
const nextLair = lairs.sort((a, b) =>
    (a as any).ticksToSpawn - (b as any).ticksToSpawn
)[0];
guard.travelTo(nextLair, 1);
// When keeper is visible near lair, attack it
```

### CostMatrix
- Set all lair positions (3×3 zone) to cost 255 for non-guard creeps.
- Only `SKGuardOverlord` creeps are allowed within range 3 of lairs.

---

## 14. Power Creeps
**Remote Mining Paper §5 — Late-Game Scaling**

> Only relevant at RCL 8 with Power Enabled rooms. Pure future-state.

### High-Value Powers
| Power | Effect | Priority |
|---|---|---|
| `OPERATE_SOURCE` | +500 energy/regen cycle, shorter timer | Highest |
| `REGEN_SOURCE` | Resets source regeneration immediately | High |
| `OPERATE_STORAGE` | Storage capacity ×2 | Medium |
| `OPERATE_FACTORY` | Enables commodity production | Low |

### Implementation Notes
- Power Creeps survive death (500 tick respawn, no energy cost to re-activate).
- A `PowerCreepProcess` routes the PC to each source/storage once per day to renew powers.
- Powers activated via `powerCreep.usePower(PWR_OPERATE_SOURCE, source)`.
- Requires `room.controller.isPowerEnabled` — enable via `PowerBank` raiding or buying GPLs.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- LINK / TERMINAL / MARKET PAPER — Confirmed missing via code audit       -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 15. Tower Link Role in LinkNetwork
**Link/Terminal Paper §1 — Link Role Categorization**

`LinkNetwork.ts` classifies all non-hub, non-source, non-controller links as generic "Receivers" with equal priority. The paper requires Tower Links to have **Critical** priority — higher than the Controller Link — so towers always stay charged for defense.

**Gap:** Currently `hubCanDistribute` iterates `receiverLinks` first then `controllerLink`, but all receivers are weighted equally. A Tower Link adjacent to a tower cluster may lose priority to an Extension Link.

**Fix in `LinkNetwork.ts`:**
1. Add a `towerLinkIds: Id<StructureLink>[]` array.
2. Classify a link as Tower Link if it is within range 3 of any tower **and** not already hub/source/controller.
3. In the distribution phase:
   ```
   Priority 1 → Tower Links  (threshold: < 400 energy)
   Priority 2 → Receiver Links (extensions/remote receivers)
   Priority 3 → Controller Link
   ```
4. Also update `refresh()` classification order so a link adjacent to both a tower and the controller is always classified as Tower Link first.

---

## 16. Terminal Minimum Energy Reserve Lock
**Link/Terminal Paper §7 / Terminal Logistics Paper — Risk Mitigation & Deadlock Prevention**

`TerminalOverlord` has no energy floor. If storage >80% and terminal has energy, it sends. If terminal energy drops to zero, it cannot pay transfer fees — **deadlocking** the entire logistics network permanently.

### The Four Deadlock Conditions (classical OS theory applied to Screeps)
| Condition | Screeps Manifestation |
|---|---|
| **Mutual Exclusion** | Only one transfer per tick per terminal |
| **Hold and Wait** | Terminal holds minerals, waiting for energy to pay fee |
| **No Preemption** | Cannot forcibly take energy from another terminal |
| **Circular Wait** | Room A needs energy from Room B, which needs energy from Room A |

Breaking the **Hold and Wait** condition (energy reserve lock) is the most practical fix.

**Fix — add const and guard to `handleBalancing()` and `handleMarketCalls()`:**
```ts
const TERMINAL_ENERGY_RESERVE = 50_000; // Paper recommends 50k (up from original 30k)
                                          // OPERATE_TERMINAL power widens this margin to ~25k effective

// In handleBalancing():
if (terminal.store.energy - cost < TERMINAL_ENERGY_RESERVE) return;

// In handleMarketCalls():
if (terminal.store.energy - amount - cost < TERMINAL_ENERGY_RESERVE) return;
```

### Push-Only Energy Balancing (breaks circular wait)
Unlike minerals which are **Pulled** by consumers (requesting rooms initiate nothing), energy must be **Pushed** by suppliers:
```ts
// A room with zero energy NEVER initiates a transaction — it can't afford the fee.
// The donor room ALWAYS sends first; receivers only receive.
// This prevents circular deadlock where A wants energy from B and B wants energy from A.
if (terminal.store.energy < TERMINAL_ENERGY_RESERVE) {
    // EMERGENCY: signal EmpireLogisticsProcess to push energy HERE from nearest surplus room
    (Memory.colonies[this.colony.name] as any).needsEnergyPush = true;
    return; // Do not attempt any outgoing transfer
}
```

Additionally: if `terminal.store.energy < TERMINAL_ENERGY_RESERVE` and `storage.energy > 50_000`, withdraw energy from storage to refill the terminal reserve. Assign this to `QueenOverlord` or a `FillerOverlord` task.

---

## 17. Distance-Optimized Terminal Routing
**Link/Terminal Paper §3 — Transaction Cost Calculus**

`handleBalancing()` sends to the first deficit room found (`for (const room of myRooms)`). At large distances the transfer energy cost approaches 86% of the sent amount — nearly worthless. The bot should always prefer the **closest** deficit room to minimize energy overhead.

**Fix:**
```ts
// Sort deficit rooms by transaction cost ascending before iterating
const deficitRooms = myRooms
    .filter(r => r.name !== this.colony.name &&
                 r.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < 200_000)
    .sort((a, b) =>
        Game.market.calcTransactionCost(5000, this.colony.name, a.name) -
        Game.market.calcTransactionCost(5000, this.colony.name, b.name)
    );
const target = deficitRooms[0];
```

**Economic Horizon for terminal sends:** If `calcTransactionCost(amount, src, dst) > amount * 0.5`, the transfer wastes more than 50% of the sent energy — skip it entirely and wait for a closer room to become deficit.

---

## 18. Market Price History and Manipulation Guard
**Link/Terminal Paper §4 / Terminal Logistics Paper — Statistical Market Filtering**

`handleMarketCalls()` sells at the highest current buy order with no price intelligence. It will accept any price, including manipulated "whale" orders far below fair value.

### 14-day EMA (preferred over SMA)
The paper specifies **EMA, not SMA**, because EMA responds faster to genuine market shifts while still filtering transient manipulation spikes.

**Smoothing constant:** `k = 2 / (14 + 1) = 0.1333`

**Recursive formula:** `EMA_today = price_today × k + EMA_yesterday × (1 - k)`

**Initialization:** If fewer than 14 days of history exist, initialize with an SMA of available days first.

```ts
// Run every 100 ticks, cache in GlobalCache
function computeEMA14(history: MarketHistoryItem[]): { ema: number; stdDev: number } {
    if (history.length === 0) return { ema: 0, stdDev: 0 };
    const k = 2 / (history.length + 1); // adapts if < 14 days available
    let ema = history[0].avgPrice; // Seed with oldest day
    for (let i = 1; i < history.length; i++) {
        ema = history[i].avgPrice * k + ema * (1 - k);
    }
    const stdDev = Math.sqrt(
        history.reduce((s, d) => s + Math.pow(d.avgPrice - ema, 2), 0) / history.length
    );
    return { ema, stdDev };
}
```

### Volume-Weighted Outlier Detection (Z-score + RelVol)
Price manipulation typically uses **low-volume transactions** to move `avgPrice` without genuine market participation. The `getHistory()` response includes `stddevPrice` and `volume` per day:

```ts
// When evaluating a sell order:
const { ema, stdDev } = computeEMA14(history);

// Z-score: how far is today's order from EMA?
const zScore = (bestOrder.price - ema) / (stdDev || 1);

// RelVol: is today's volume abnormally low (manipulation signal)?
const avgVol = history.reduce((s, d) => s + d.volume, 0) / history.length;
const relVol = history[history.length - 1].volume / (avgVol || 1);

if (zScore < -2 && relVol < 0.5) {
    // Low price AND low volume = likely manipulation — skip
    log.warning(`Market manipulation detected: price=${bestOrder.price}, ema=${ema.toFixed(2)}, relVol=${relVol.toFixed(2)}`);
    return;
}

// Also gate for stddevPrice spikes (flash crash signal):
if (history[history.length - 1].stddevPrice > ema * 0.3) {
    log.warning(`High volatility (stddev=${history[history.length - 1].stddevPrice}) — holding position`);
    return;
}
```

Cache `{ ema, stdDev, tick: Game.time }` in `GlobalCache` — reuse for 100 ticks, call `getHistory()` at most once per 100 ticks (it's expensive).

---

## 19. Order Management (Create / Extend / Adjust)
**Link/Terminal Paper §4 — Order Management**

`handleMarketCalls()` only uses `Game.market.deal()` (immediate execution). This is fine for energy but suboptimal for minerals — you want persistent **sell orders** so buyers come to you at your price.

**What to implement:**

### 19a. Mineral Sell Orders
```ts
// If storage has > 5000 of a mineral, post a sell order at SMA price
const excessMinerals = Object.entries(storage.store)
    .filter(([res, amt]) => res !== RESOURCE_ENERGY && amt > 5000);

for (const [resource, amount] of excessMinerals) {
    const existing = myOrders.find(o => o.resourceType === resource && o.type === ORDER_SELL);
    if (!existing) {
        Game.market.createOrder({ type: ORDER_SELL, resourceType: resource,
            price: sma14ForResource, totalAmount: amount, roomName: colony.name });
    } else if (existing.remainingAmount < 1000) {
        Game.market.extendOrder(existing.id, amount); // Replenish, don't recreate
    }
}
```

### 19b. Price Adjustment (keep competitive)
```ts
// Every 500 ticks, adjust stale orders toward current SMA
if (Game.time % 500 === 0) {
    for (const order of myOrders) {
        const currentSma = getSmaForResource(order.resourceType);
        if (Math.abs(order.price - currentSma) / currentSma > 0.1) {
            Game.market.changeOrderPrice(order.id, currentSma * 0.98); // 2% below SMA
        }
    }
}
```

**Order limit:** Stay under 300 active orders. Track `Game.market.orders` count; cancel the oldest zero-activity orders if approaching limit.

---

## 20. Empire Ping-Pong Prevention (Centralized Terminal Overlord)
**Link/Terminal Paper §6 / Terminal Logistics Paper — Quota-Delta Dispatching**

Currently each room's `TerminalOverlord` makes local decisions. If Room A has 80% storage and Room B has 60%, A sends to B. Next tick B hits 80% and sends back. This "ping-pong" wastes energy on transfer costs indefinitely.

**Fix — centralize balancing in `GlobalManager` or a new `EmpireLogisticsProcess`.**

### Staggered Heartbeat Model (CPU flat regardless of room count)
```
Tick 1 (every tick):  Energy EMERGENCY — each room checks reserve floor (§16) and sets
                       needsEnergyPush flag. EmpireLogisticsProcess reacts immediately.
Ticks 2-10 (rotation): Balance one or two BASE MINERALS per tick across the empire.
                        Rotate through resources so total scan = 1 resource/tick.
Tick 20 (every 20):   MARKET — EmpireAnalyst updates EMA thresholds (§18), checks
                        arbitrage opportunities and posts/adjusts orders (§19).
Tick 100 (every 100): GLOBAL STRATEGY — re-evaluate room quotas (§34), industrial
                        targets, factory scheduling. Full empire inventory snapshot.
```

### Logistics Hubs
In 20+ room empires, long-range direct sends waste >50% of energy in fees. Designate **2-3 centrally located rooms as Logistics Hubs** — high-energy-reserve rooms that act as intermediaries:
```ts
// Tag rooms as hubs in Memory based on map centrality score:
// centrality = -Σ(calcTransactionCost(1, hub, otherRoom)) for all rooms
// Higher score = more central. Top 2-3 rooms become Logistics Hubs.
(Memory.colonies[room.name] as any).isLogisticsHub = centrality > threshold;
```
- Hubs maintain ≥100k energy reserve (vs. standard 50k)
- Non-hub rooms route mineral transfers TO hubs first; hubs relay onward
- This cuts average transfer distance by 40-60% in spread empires

### Batch Terminal Sends
```ts
// Minimum batch for efficiency — never send small amounts:
const MIN_BATCH = 5_000;  // Minimum units per send
const IDEAL_BATCH = 25_000; // Wait for this much before sending if possible

// Wait until amount >= IDEAL_BATCH if delivery is non-urgent:
const urgent = (Memory.colonies[target.name] as any).needsEnergyPush;
const sendAmt = urgent ? Math.max(MIN_BATCH, delta) : Math.max(IDEAL_BATCH, delta);
```
Batching maximizes resource-per-intent efficiency (0.2 CPU/intent flat cost) and reduces terminal cooldown frequency.

```ts
// After send, set cooldown guard on both rooms:
(Memory.colonies[room.name] as any).terminalCooldownUntil = Game.time + 200;
```

---

## 21. Factory and Commodity Production
**Link/Terminal Paper §5 / Terminal Logistics Paper — Industrial Manufacturing**

No factory logic exists anywhere in the codebase. Factories unlock the highest-credit revenue stream via NPC commodity buyers.

> **Gate:** RCL 7+ with a built factory (`STRUCTURE_FACTORY`). Factory level (0–5) is **permanent** once set by `OPERATE_FACTORY` power — a L5 factory cannot produce L1 goods.

### Factory Level Planning
A full T5 production line requires **5 separate rooms**, each dedicated to one tier:
```
Room A → L1 factory: TUBE / SWITCH / PHLEGM / CONCENTRATE (regional raw + bars)
Room B → L2 factory: FIXTURES / TRANSISTOR / TISSUE / EXTRACT
Room C → L3 factory: FRAME / MICROCHIP / MUSCLE / SPIRIT  (+ common: COMPOSITE, CRYSTAL, LIQUID)
Room D → L4 factory: HYDRAULICS / CIRCUIT / ORGANOID / EMANATION
Room E → L5 factory: MACHINE / DEVICE / ORGANISM / ESSENCE (→ sell to NPC)
```

### Regional Resource and Chain Selection
Commodity resources are quadrant-specific in highway rooms:
| Quadrant | Raw Resource | Chain |
|---|---|---|
| North-West | Metal (Alloy) | 🔩 Mechanical → MACHINE |
| North-East | Silicon (Wire) | 💡 Electronic → DEVICE |
| South-West | Biomass (Cell) | 🧬 Biological → ORGANISM |
| South-East | Mist (Condensate) | 🌫 Mysterious → ESSENCE |

Choose chain based on which quadrant your empire is in. Mixing chains requires cross-quadrant logistics.

### Common Component Bottleneck (all chains need these)
| Product | Level | Inputs | Cooldown |
|---|---|---|---|
| `COMPOSITE` | L1 | Utrium Bar + Zynthium Bar + 20 energy | 50 ticks |
| `CRYSTAL` | L2 | Lemergium Bar + Keanium Bar + Purifier + 6 energy | 21 ticks |
| `LIQUID` | L3 | Oxidant + Reductant + Ghodium Melt + 11 energy | 60 ticks |

These are bottlenecks because T4/T5 depend on them. Produce in high volume at L2-L3 rooms.

### Full Electronic Chain (Silicon — most common starting point)
| Level | Product | Inputs |
|---|---|---|
| L1 | `SWITCH` | Wire + Oxidant + Utrium Bar |
| L2 | `TRANSISTOR` | Switch + Wire + Reductant |
| L3 | `MICROCHIP` | Transistor + Composite + Wire + Purifier |
| L4 | `CIRCUIT` | Microchip + Transistor + Switch + Oxidant |
| L5 | `DEVICE` | Circuit + Microchip + Crystal + Ghodium Melt → **sell to NPC** |

### Full Mechanical Chain (Metal — second most common)
| Level | Product | Inputs |
|---|---|---|
| L1 | `TUBE` | Alloy + Zynthium Bar + Energy |
| L2 | `FIXTURES` | Composite + Alloy + Oxidant |
| L3 | `FRAME` | Fixtures + Tube + Reductant + Zynthium Bar |
| L4 | `HYDRAULICS` | Liquid + Fixtures + Tube + Purifier |
| L5 | `MACHINE` | Hydraulics + Frame + Fixtures + Tube → **sell to NPC** |

### Factory Overlord Architecture with JIT Delivery
```ts
class FactoryOverlord extends Overlord {
    run(): void {
        if (Game.time % 20 !== 0) return; // Gate CPU
        const factory = this.colony.room?.find(FIND_MY_STRUCTURES,
            { filter: s => s.structureType === STRUCTURE_FACTORY })[0] as StructureFactory;
        if (!factory || factory.cooldown > 0) return;

        // JIT: only request ingredients when factory cooldown is low AND store is below threshold
        // (prevents pre-loading ingredients that sit in factory for 1000 ticks)
        const needsIngredients = Object.values(recipe.ingredients)
            .some(([res, amt]) => (factory.store[res] ?? 0) < amt);
        if (needsIngredients && factory.cooldown < 10) {
            // Request via EmpireLogisticsProcess — don't pre-stock more than 1 batch
            this.requestIngredients(recipe);
            return;
        }

        if (!needsIngredients) factory.produce(recipe.product);

        // Transfer finished goods to terminal when > batchSize
        if ((factory.store[recipe.product] ?? 0) > recipe.batchSize) {
            this.transferToTerminal(recipe.product);
        }
    }
}
```

### NPC Market Strategy
- NPC terminals at highway crossroads (`x=0` or `y=0` rooms like `W0N0`) buy bars and commodities at reliable prices.
- `Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_DEVICE })` — filter for orders with no `roomName` (NPC orders).
- **NPC prices decay** as supply increases — track using same 14-day EMA (§18). If `MACHINE` EMA drops >20% from peak, pivot production to another chain.

### Stronghold Loot Routing
NPC Stronghold raids drop high-tier commodities. The Terminal Overlord must handle sudden influxes:
```ts
// When a room's terminal receives unexpected commodity stockpile:
for (const resource of COMMODITY_RESOURCES) {
    const amt = terminal.store[resource] ?? 0;
    if (amt > 0) {
        const npcPrice = getLatestNPCBuyPrice(resource);
        const factoryInputValue = isFactoryInput(resource) ? getFactoryInputValue(resource) : 0;
        // Sell if NPC price > factory processing value; route to factory otherwise
        if (npcPrice > factoryInputValue * 1.2) {
            sellToNPC(resource, amt);
        } else {
            routeToFactoryRoom(resource, amt);
        }
    }
}
```

### OPERATE_TERMINAL Power Coordination
At RCL 8, Operator Power Creeps with `OPERATE_TERMINAL` reduce transfer costs by up to **50%**. This effectively doubles the energy safety margin in §16 — a 50k reserve becomes equivalent to 100k without the power. Coordinate Operator scheduling to prioritize Logistics Hub rooms first.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- GLOBAL LOGISTICS BROKER PAPER — Confirmed missing via code audit        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- NOTE: Most of this paper is ALREADY fully implemented:                  -->
<!--  ✅ Gale-Shapley stable matching (matchWithdraw + matchTransfer)        -->
<!--  ✅ Incoming/outgoing reservation ledger (rebuilt from tasks each tick)  -->
<!--  ✅ getEffectiveAmount() / getEffectiveStore()                           -->
<!--  ✅ Decay-weighted scoring (dropped=2.0×, tombstone=1.5×)               -->
<!--  ✅ Buffer ping-pong prevention (offer only when real downstream demand)  -->
<!--  ✅ Tower emergency priority escalation (isUnderAttack → priority 15)    -->
<!--  ✅ Phase-based execution (refresh→register→match→run)                   -->
<!--  ✅ Path caching in Zerg.ts, traffic shoving in TrafficManager.ts        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 22. Predictive Supply Chain (Miner Rate Forecasting)
**Global Logistics Broker Paper — Predictive Amount**

`LogisticsNetwork.getEffectiveAmount()` has an explicit code comment saying `// simplified (no predictive CPU bomb)` — production prediction was intentionally deferred. The paper describes this as a meaningful throughput improvement.

**What it means:** When a hauler is dispatched to a container that currently has 500 energy but is 20 ticks away, the miner will have added 200 more energy (10/tick × 20 ticks) by arrival. The broker can therefore dispatch the hauler sooner (container isn't "full" yet) and it will arrive to a fuller load — reducing idle wait time.

**Implementation approach (CPU-safe):**
```ts
// In getEffectiveAmount(), for source containers only:
const miningRate = 10; // energy/tick for reserved sources (5 for unreserved)
const distanceToHauler = haulerPos.getRangeTo(target.pos);
const productionPreview = Math.min(
    containerFreeCapacity,
    miningRate * distanceToHauler
);
return amount + productionPreview + incoming - outgoing;
```

**CPU guard:** Only apply production preview when `target` is a container within range 2 of a source AND there is an active miner on that site. Gate computation behind `Game.time % 5 === 0` or cache the `isSourceContainer` set from `MiningOverlord.init()`.

---

## 23. War-Time Hauler Surge Spawning
**Global Logistics Broker Paper — Military Logistics**

No code exists to increase hauler fleet size when hostiles are detected. The current `TransporterOverlord` spawns based on logistics load alone. During a siege, haulers can be killed and the tower empties before replacements arrive.

**Gap:** `TransporterOverlord` does not check `colony.room.find(FIND_HOSTILE_CREEPS)` when deciding spawn count.

**Implementation in `TransporterOverlord.init()` or `handleSpawning()`:**
```ts
const isUnderAttack = (this.colony.room?.find(FIND_HOSTILE_CREEPS)?.length ?? 0) > 0;
const surgeMultiplier = isUnderAttack ? 1.25 : 1.0; // +25% during attack

const targetCount = Math.ceil(baseHaulerCount * surgeMultiplier);
if (this.haulers.length < targetCount) {
    // enqueue additional hauler at elevated priority (100 vs normal 40)
    this.colony.hatchery.enqueue({ priority: isUnderAttack ? 100 : 40, ... });
}
```

Also consider: during an attack, newly spawned haulers should receive a simplified body (`CARRY×5, MOVE×5`) for fast deployment rather than waiting for a full multi-part body — getting *something* filling towers is better than a perfect hauler that takes 200 ticks to spawn.

---

## 24. Squad Supply Lines for Offensive Operations
**Global Logistics Broker Paper — Squad-Based Logistics**

When a `DestroyerOverlord` or `SquadOverlord` (future) is operating in a remote room, there is no supply line mechanism. The squad runs dry and is wasted. The paper describes a "Supply Line" of haulers routing energy from home to the front.

**Scope:** Only implement after Squad Combat (#10) is built. This depends on it.

**Design:**
- The `SquadOverlord` registers itself as a "mobile requester" at its current room position.
- A `SupplyLineProcess` runs in the Kernel, finds squads with `energy < 50%`, and dispatches a hauler from home storage toward the squad's current position.
- The hauler uses `travelTo(squad.leader.pos)` — path updates each tick as the squad moves.
- Safe routing: the hauler's CostMatrix must set enemy tower range zones to cost 255.

```ts
// Hauler supply loop (simplified):
if (hauler.store.energy > 0 && squad.needsSupply()) {
    hauler.travelTo(squad.leader.pos, 3);
    if (hauler.pos.inRangeTo(squad.leader.pos, 3)) {
        squad.members.forEach(m => hauler.transfer(m.creep, RESOURCE_ENERGY));
    }
} else {
    hauler.travelTo(home.storage, 1); // Return for reload
}
```

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- MILITARY STATE-MACHINE PAPER — Confirmed missing via code audit         -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- NOTE: Most of this paper is ALREADY fully implemented in DefenseOverlord.ts: -->
<!--  ✅ Tower damage formula (linear falloff 600→150 over range 5–20)      -->
<!--  ✅ Enemy HPT with boost multipliers (XLHO2=48, LHO2=36, LO=24)        -->
<!--  ✅ TOUGH damage reduction (XGHO2=0.3×, GHO2=0.5×, GO=0.7×)          -->
<!--  ✅ DPT vs HPT "Hold Fire" check with 1.1× kill margin                 -->
<!--  ✅ Healer-first focus fire targeting                                   -->
<!--  ✅ Path-based safe mode trigger (PathFinder through walls/ramparts)    -->
<!--  ✅ Blackout + threat preemptive safe mode                             -->
<!--  ✅ Dynamic counter-body selection (threat profile → body)             -->
<!--  ✅ Pre-healing pass (unconditional self-heal every tick)               -->
<!--  ✅ Tri-pipeline (ranged + melee + heal simultaneously)                 -->
<!--  ✅ Kiting logic (ranged flee at <3, melee engage at 1)                 -->
<!--  ✅ Invader wave prediction/pre-spawn                                   -->
<!--  ✅ Peacetime tower rampart repair                                      -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 25. Tower Draining FSM (Offensive)
**Military Paper — The "Drainer" State-Machine**

No offensive tower-draining logic exists. `DestroyerOverlord` sends a single combat unit that enters and fights — it doesn't oscillate to drain energy without taking full tower damage. Tower draining is the cheapest way to weaken a defended room before a real siege.

**State machine (implemented as a `DrainerOverlord`):**

```
APPROACH → STEP_IN → SOAK → STEP_OUT → RECOVER → (loop)
```

```ts
// State stored in zerg.memory.drainerState
switch (state) {
    case 'APPROACH':
        // Move to range 1 of the exit tile toward targetRoom
        // Transition: pos is on exit border → STEP_IN
    case 'STEP_IN':
        // Move exactly 1 tile into targetRoom (target range ≥ 20 from all towers)
        // Transition: moved in → SOAK
    case 'SOAK':
        // Hold position for 1 tick (tower fires, damages TOUGH parts)
        // Transition: always → STEP_OUT
    case 'STEP_OUT':
        // Move back across the room border
        // Transition: pos is in safe room → RECOVER
    case 'RECOVER':
        // Stationary healer in safe room applies heal() until hits === hitsMax
        // Transition: hits === hitsMax → STEP_IN
}
```

**Body:** `[TOUGH×18, MOVE×9, MOVE×9]` boosted with XGHO2 — 70% damage reduction means towers do 450 instead of 1500 DPT per tick. A single drainer can soak 6 towers indefinitely with T3 TOUGH + XLHO2 healer support.

**Economic goal:** Force defender to spend 10 energy/tower-shot (60 energy/tick at 6 towers) while attacker's heal cost is only in creep time. Bots without market automation will run dry.

### Economic Attrition Doctrine (from Quad Paper)
The drainer is most efficient at range **15–20** from towers — the falloff zone where damage is moderate (900–1,800/tick total) but the drainer can easily out-heal it:
```
Tower DPT vs. Range:
  Range ≤ 5:  600/tower × 6 = 3,600/tick total  ← dangerous
  Range 10:   450/tower × 6 = 2,700/tick total
  Range 15:   300/tower × 6 = 1,800/tick total  ← sweet spot
  Range ≥ 20: 150/tower × 6 = 900/tick total    ← very safe
```
- At range 15–20, T3 TOUGH (0.3× damage) reduces 1,800 to **540 effective DPT** — healable with 2 boosted HEAL parts
- While soaking, use `rangedMassAttack()` to chip ramparts: forces defender to spend repair energy *on top of* tower energy
- Track defender energy via `room.storage` when visible — retreat when defender has < 10k energy (tower fire will pause)

> **Gate:** Requires boosting (backlog #7). Implement after labs are working.

---

## 26. Siege Overlord — Breaker + Medic Pair → Quad Doctrine
**Military Paper / Quad Paper — The Siege and Destruction FSM**

`DestroyerOverlord` sends a single unboosted unit into a target room. There is no Breaker/Medic pair, no `dismantle()` logic, and no state machine for siege progression (TRAVEL → SIEGE_TARGET → BREACH → DESTROY).

**What's needed:**

### 26a. Breaker Role
```ts
// Body (1300 energy, boosted): 
[TOUGH×4, MOVE×4, WORK×8, MOVE×4]
// Boosts: XGHO2 (tough), XZHO2 (move), XLH2O (work = 4× dismantle)
// Action: creep.dismantle(target) — 50 hits/WORK vs 30 hits/ATTACK
```

### 26b. Medic Role
```ts
[TOUGH×4, MOVE×4, HEAL×12, MOVE×4]
// Boosts: XGHO2, XZHO2, XLHO2 (heal = 4×)
// Action: heal(breaker) every tick — pre-healing pattern
```

### 26c. Siege FSM States (4-Phase Quad Doctrine)
```
PHASE 1 APPROACH  → Squad travels in 2×2 formation; Movement Engine uses dilated CostMatrix (§51)
                     Positions at range 15-20 for initial attrition (§25)
PHASE 2 BREACH    → Squad paths to target rampart; snake formation (§54) through chokepoints
                     Breakers dismantle lowest-HP rampart; Medics apply predictive triage (§53)
PHASE 3 DESTROY   → Once inside: spawn → terminal → labs priority
                     Use rangedMassAttack() while moving between targets
PHASE 4 EXTRACT   → Retreat to safe room; heal to full; re-enter or report victory
```

### 26d. Safe Mode Counter-Strategy (Critical)
```ts
// A CLAIM-part creep attacks the controller to block safe mode activation:
// Safe mode CANNOT be triggered if:
//   (a) controller is being attacked by a CLAIM part, OR
//   (b) downgrade timer < 50% of max
// Deploy a "Controller Blocker" creep with CLAIM parts alongside the Breaker:
claimerCreep.attackController(room.controller);

// If defender activates safe mode anyway:
//   - Retreat entire squad
//   - Set re-engage timer: Game.time + 1000 (safe mode duration)
//   - If nuke available: fire during safe mode to break structures
//   - Resume after safe mode expires
```

### 26e. Formation Cohesion
Breaker and Medic must always be adjacent. If gap > 1 tile, Medic waits and heals. Breaker waits if Medic falls behind. For full 4-man quads: see §51 (movement) and §54 (formation transitions).

> **Gate:** Requires boosts (backlog #7) and Squad movement basics (backlog #10).

---

## 27. Nuke Detection and Emergency Rampart Response
**Military Paper — Nuke Orchestration**

No code exists to detect incoming nukes or respond to them. A nuke landing without warning destroys everything in its radius regardless of rampart HP below 10M hits (outer radius) or 20M (center).

**Detection:**
```ts
const nukes = room.find(FIND_NUKES);
// Each Nuke has: pos, timeToLand (ticks remaining)
```

**Response FSM:**
1. If `nuke.timeToLand < 5000` AND any rampart in blast radius has `hits < 10_000_000`:
   - Flag the radius tiles in `Memory.rooms[room.name].nukeZones`
   - `WorkerOverlord` prioritizes repair of those ramparts above all other construction
   - `TowerOverlord` switches from combat-repair to nuke-prep repair
2. If storage or spawn is in blast radius:
   - Activate Terminal energy dump to a safe room immediately
   - Consider Safe Mode if TTL < 300 ticks

**Where to add:** In `DefenseOverlord.run()`, before the hostile check:
```ts
const nukes = this.colony.room?.find(FIND_NUKES) ?? [];
if (nukes.length > 0) this.handleNukeResponse(nukes);
```

---

## 28. Hostile Catalog (Persistent Threat Intelligence)
**Military Paper — Sensing Layer / Threat Analyst**

There is no persistent record of which players have attacked, their observed boost tier, or their room RCL. Each tick's `hostiles` is a fresh scan with no historical context. This means the bot cannot:
- Pre-escalate defense against a known high-tier attacker who scouts before attacking
- Distinguish "first visit" scouts from established threats
- Adjust body selection based on observed boost tier rather than detected parts

**Implementation — `Memory.hostiles` catalog:**
```ts
interface HostileRecord {
    username: string;
    lastSeen: number;       // Game.time
    observedRCL?: number;
    observedBoosts: string[]; // Boost compounds seen on body parts
    attackCount: number;    // Times they've entered this room
    maxThreatScore: number; // Peak DPT observed
}
```

**Where to populate:** In `DefenseOverlord.init()`, when `hostiles.length > 0`:
```ts
for (const h of hostiles.filter(h => h.owner.username !== 'Invader')) {
    const record = Memory.hostiles?.[h.owner.username] ?? { attackCount: 0, observedBoosts: [] };
    record.lastSeen = Game.time;
    record.attackCount++;
    record.observedBoosts = [...new Set([...record.observedBoosts,
        ...h.body.filter(p => p.boost).map(p => p.boost!)])];
    Memory.hostiles[h.owner.username] = record;
}
```

**Usage:** `getDefenderBody()` can check `Memory.hostiles[username].observedBoosts` to include TOUGH/HEAL counter-boosts in body selection even before the attack starts.

---

## 29. Per-Tick Combat Simulation (Knife-Edge Survival Check)
**Military Paper — "What-If" Scenario Simulation**

`DefenseOverlord` makes good real-time decisions but does so reactively (fires if DPT > HPT). The paper describes a proactive battle simulator that runs a 10-tick projection *before* committing a unit to a position — answering: "If the quad moves to tile X, will it survive?"

This is a pre-requisite for proper Quad movement (backlog #10) and Siege Overlord (backlog #26).

**Implementation:**
```ts
function simulateSurvival(
    creepBody: BodyPartDefinition[],
    towerCount: number,
    towerRange: number,
    healerCount: number,
    healBoost: number,
    ticks: number
): boolean {
    let hp = creepBody.reduce((sum, p) => sum + p.hits, 0);
    const toughParts = creepBody.filter(p => p.type === TOUGH);
    const damageMultiplier = toughParts.some(p => p.boost === 'XGHO2') ? 0.3 : 1.0;

    const dpt = Math.max(150, 600 - (towerRange - 5) * 30) * towerCount * damageMultiplier;
    const hpt = 12 * healBoost * healerCount;

    for (let t = 0; t < ticks; t++) {
        hp = Math.min(creepBody.length * 100, hp - dpt + hpt);
        if (hp <= 0) return false; // Will die
    }
    return true; // Survives
}
```

**Use cases:**
- Before `DestroyerOverlord` enters a room: simulate 3 ticks at current tower count/energy
- Before Quad advances to next tile: simulate worst-case focus fire
- In `DrainerOverlord`: confirm SOAK step survives before stepping in

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- CHEMICAL SUPREMACY PAPER — All items confirmed MISSING via code audit   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- Zero lab code exists: no runReaction, boostCreep, STRUCTURE_LAB logic, -->
<!-- Science Overlord, Scientist creep, or mineral dependency graph anywhere.-->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 30. Science Overlord + Reaction Scheduler
**Chemical Supremacy Paper — The Science Overlord / Kernel Model**

> **Gate:** RCL 6 (3 labs available). No science code exists at all.

There is no lab management code anywhere in the codebase. The entire chemical pipeline — from `runReaction()` to boosting — must be built from scratch.

### RCL-Progressive Lab Scaling
| RCL | Labs | Config | Strategic Shift |
|---|---|---|---|
| 6 | 3 | 2-input, 1-output triangle | Initial Ghodium production; basic T1 boosts |
| 7 | 6 | 2-input, 4-output | T2 compounds; lab-boosted sorties |
| 8 | 10 | 2-input, 8-output parallel | Full T3 mass production; nuke/power creep synergy |

The Science Overlord must detect RCL changes and re-classify labs dynamically (`refresh()` every 100 ticks).

### Lab Role Classification (2 Input, 8 Output)
```ts
// During colony init, classify all 10 labs:
const labs = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LAB });
const inputLab1 = labs[0];  // Closest to Terminal
const inputLab2 = labs[1];  // Range ≤ 2 from all output labs (validated by §49)
const outputLabs = labs.slice(2); // Run reactions in parallel
```

### Reaction Scheduler (core loop)
**Note: Replace this with per-tier sleep timer implementation from §50 for full optimization.**
```ts
// Every 10 ticks, for each output lab:
for (const lab of outputLabs) {
    if (lab.cooldown > 0) continue;
    if (inputLab1.store[reagent1] > 0 && inputLab2.store[reagent2] > 0) {
        lab.runReaction(inputLab1, inputLab2);
    }
}
```

### CPU Budget
`runReaction()` costs 0.2 CPU/call. 8 output labs = 1.6 CPU/batch at RCL 8. Gate behind bucket check (`> 500`) **and** quota check — skip if product already at target stock (§34). In a large empire, 5 rooms × 1.6 CPU = 8 CPU/tick saved by skipping saturated products.

---

## 31. Recursive Mineral Dependency Resolver
**Chemical Supremacy Paper — Recursive Dependency Management**

The reaction graph is a **Directed Acyclic Graph (DAG)** where nodes are mineral compounds and edges are reactions. All Screeps reactions have **1:1 stoichiometry** — 1 unit of reagent A + 1 unit of reagent B → 1 unit of product. This means producing N units of any T3 compound requires exactly N units of every intermediate and N units of every base mineral.

A naive implementation can only queue a single step at a time. A recursive resolver walks the full DAG automatically, determining all missing precursors and skipping tiers where inventory already covers demand.

**Implementation note:** Use Screeps' built-in `REACTIONS` global (a nested object: `REACTIONS[reagent1][reagent2] = product`) to derive the reaction graph rather than maintaining a custom lookup. This guarantees accuracy as the game updates.

The reaction graph is hierarchical (T1 → T2 → T3). A naive implementation can only queue a single step at a time. A recursive resolver automatically determines all missing precursors for any target compound.

### Reaction Graph (partial — key T3 compounds)
```ts
const REACTIONS: Record<string, [string, string]> = {
    // Base
    'H2O': ['H', 'O'], 'OH': ['O', 'H'], 'ZK': ['Z', 'K'], 'UL': ['U', 'L'],
    // Tier 1
    'GH': ['G', 'H'], 'GO': ['G', 'O'],
    'UH': ['U', 'H'], 'ZO': ['Z', 'O'],
    // Tier 2
    'GH2O': ['GH', 'OH'], 'GHO2': ['GO', 'OH'],
    'UH2O': ['UH', 'OH'], 'ZHO2': ['ZO', 'OH'],
    // Tier 3 (add X catalyst)
    'XGH2O': ['GH2O', 'X'], 'XGHO2': ['GHO2', 'X'],
    'XUH2O': ['UH2O', 'X'], 'XZHO2': ['ZHO2', 'X'],
    'XLHO2': ['LHO2', 'X'],
};

function getMissingPrecursors(target: MineralCompoundConstant, amount: number,
                               inventory: Record<string, number>): Array<{resource: string, amount: number}> {
    const have = inventory[target] ?? 0;
    const need = Math.max(0, amount - have);
    if (need === 0) return []; // Already have enough

    const recipe = REACTIONS[target];
    if (!recipe) return [{ resource: target, amount: need }]; // Base mineral — buy/mine it

    return [
        ...getMissingPrecursors(recipe[0] as any, need, inventory),
        ...getMissingPrecursors(recipe[1] as any, need, inventory),
    ];
}
```

**Usage:** Call `getMissingPrecursors('XGH2O', 300, terminalStore)` to get the full shopping list for 300 units of T3 upgrade boost, automatically skipping tiers where inventory already covers demand.

---

## 32. Scientist Creep FSM (Lab Jam Prevention)
**Chemical Supremacy Paper — The Scientist Creep / Lab Jam**

A "Scientist" is a dedicated logistics creep that moves minerals between Terminal and Labs. Without it, labs cannot be loaded or unloaded, and the entire pipeline stalls. Lab jams (wrong mineral type stuck in a lab) must be actively purged.

### FSM States
```
RENEW          → Renew ticksToLive if < 300 ticks (carrying T3 minerals worth 50k credits is dangerous;
                   a dying Scientist drops everything on the floor)
FLUSH          → If lab contains wrong mineral for current order, empty it to Terminal (PRIORITY 1 —
                   always check this before any other state transition on every tick)
REAGENT_SUPPLY → Withdraw reagent from Terminal/Storage → deposit into inputLab1 + inputLab2
                   (fill both input labs to capacity before transitioning out)
PRODUCT_COLLECT→ Withdraw finished product from output labs when any single lab > 100 units
                   → deposit all into Terminal
IDLE           → No current order; move to pre-computed Science Hub tile (§49) to minimize
                   travel time when next order arrives
```

### Flush Logic (Lab Jam Prevention)
Flushing is the #1 reason lab automation fails over long durations. A global reset mid-reaction leaves partial reagents in output labs; a strategy change leaves wrong T2 in input labs. **Check flush condition first, every tick, before evaluating any other state.**
```ts
// Before any other action, scan all labs:
for (const lab of allLabs) {
    const resources = Object.keys(lab.store).filter(r => r !== RESOURCE_ENERGY);
    for (const res of resources) {
        if (res !== currentOrder.reagent1 && res !== currentOrder.reagent2 && res !== currentOrder.product) {
            // Wrong mineral — flush to terminal immediately
            scientist.withdraw(lab, res as ResourceConstant);
            scientist.transfer(room.terminal, res as ResourceConstant);
            return; // One task per tick
        }
    }
}
```

### Body
`[CARRY×8, MOVE×4]` — pure logistics, no combat parts. Renew when `ticksToLive < 300`.

---

## 33. Creep Boosting Request Protocol
**Chemical Supremacy Paper — The Boost Request Protocol**

No boost code exists. Creeps that need T3 compounds have no mechanism to request them, and labs have no concept of "reserving" minerals for a boost job.

### Request Interface
```ts
interface BoostRequest {
    creepName: string;
    bodyPart: BodyPartConstant;
    compound: MineralCompoundConstant;
    count: number; // Number of body parts to boost
}
```

### Flow
1. **Spawn time:** `SiegeOverlord` / `DefenseOverlord` registers a `BoostRequest` in `Memory.boostQueue`.
2. **Science Overlord** picks it up, verifies the lab has `count × 30` units of the compound **and** `count × 20` energy.
3. **Scientist** loads the compound + energy into the designated boost lab.
4. **Creep FSM:** Born with state `BOOSTING`. Walks to the boost lab. Calls `lab.boostCreep(creep)`. Transitions to operational state only after all boosts applied.

### Siege Pivot — Priority Override (Critical)
During active defense, the Science Overlord must **immediately interrupt ongoing production** to reserve boost compounds. Normal production order = Upgrading > GCL Farming > Industrial. Combat pivot order = Defense boosts > Siege boosts > everything else.
```ts
// In ScienceOverlord.run(), check for pending high-priority boost requests first:
const defenseRequests = Memory.boostQueue.filter(r => r.priority === 'DEFENSE');
if (defenseRequests.length > 0) {
    // Suspend current LabOrder, do not run reactions this tick,
    // signal Scientist to FLUSH current reagents and load boost compound
    this.currentOrder = null;
    this.boostMode = true;
}
```
This must complete within a single tick — defenders spawning take 3 × body.length ticks before they can be boosted.

### Boost Efficiency Reference
| Boost | Compound | Multiplier | Primary Use |
|---|---|---|---|
| Upgrade | XGH2O | +100% (no extra energy) | Power-level GCL |
| Heal | XLHO2 | +300% | Quad formation survival |
| Tough | XGHO2 | −70% damage taken | Siege tanks / defenders |
| Attack/Dismantle | XUH2O | +300% | Rampart dismantling |
| Move | XZHO2 | +300% fatigue reduction | Rapid response / quads |

### Body Part Ordering Rule (Critical)
TOUGH parts **must** be first in the body array to absorb damage before other parts:
```ts
const siegeBody = [
    TOUGH, TOUGH, TOUGH, TOUGH,   // Boosted with XGHO2 — 70% damage reduction
    MOVE, MOVE, MOVE, MOVE,       // Boosted with XZHO2
    WORK, WORK, WORK, WORK,       // Boosted with XUH2O — 4× dismantle
    WORK, WORK, WORK, WORK,
    MOVE, MOVE, MOVE, MOVE,
];
```

---

## 34. Empire-Wide Mineral Quota System
**Chemical Supremacy Paper — The Quota and Delta System**

`TerminalOverlord` only handles energy balancing. There is no mineral quota system across rooms — surplus Zynthium in Room A cannot feed a reaction in Room B.

### Quota Definition (per room in Memory)
```ts
interface RoomQuota {
    [resource: string]: number; // Target stock level
}
// Example for a room running XGH2O production:
const quota = {
    'G': 3000, 'H': 3000, 'X': 3000,
    'GH': 1000, 'GH2O': 500, 'XGH2O': 0, // 0 = produce, don't stockpile
};
```

### Delta Calculation and Routing (add to `EmpireLogisticsProcess` from §20)
```ts
for (const resource of ALL_RESOURCES) {
    const surplusRooms = myRooms.filter(r =>
        (r.terminal?.store[resource] ?? 0) > (quotas[r.name]?.[resource] ?? 0) + 500
    );
    const deficitRooms = myRooms.filter(r =>
        (r.terminal?.store[resource] ?? 0) < (quotas[r.name]?.[resource] ?? 0) - 500
    ).sort((a, b) =>  // Deepest deficit first
        (a.terminal?.store[resource] ?? 0) - (b.terminal?.store[resource] ?? 0)
    );

    // Match closest donor to deepest deficit — same cost-minimization as energy routing
    for (const deficit of deficitRooms) {
        const donor = surplusRooms.sort((a, b) =>
            Game.market.calcTransactionCost(1000, a.name, deficit.name) -
            Game.market.calcTransactionCost(1000, b.name, deficit.name)
        )[0];
        if (donor) donor.terminal!.send(resource as ResourceConstant, 1000, deficit.name);
    }
}
```

> **Extends §20** (`EmpireLogisticsProcess`) — run minerals through the same routing logic after energy balancing.

---

## 35. Make-vs-Buy Market Decision (Mineral Purchasing)
**Chemical Supremacy Paper — Market Arbitrage / Credit Liquidity**

No code exists to buy missing minerals from the market. If Catalyst (X) runs out, the entire T3 pipeline halts with no recovery mechanism.

### Decision Logic
```ts
// Run every 500 ticks in the Market Process (low-priority Kernel process)
for (const missing of getMissingPrecursors('XGH2O', targetAmount, terminalStore)) {
    if (missing.amount < 100) continue; // Not worth a market call

    const history = Game.market.getHistory(missing.resource as any);
    const sma14 = history.reduce((s, d) => s + d.avgPrice, 0) / history.length;

    const buyOrders = Game.market.getAllOrders({ type: ORDER_SELL, resourceType: missing.resource as any })
        .filter(o => o.price < sma14 * 1.1) // Only buy within 10% of fair value
        .sort((a, b) => a.price - b.price);

    if (buyOrders[0]) {
        const amount = Math.min(missing.amount, buyOrders[0].amount, 5000);
        const cost = Game.market.calcTransactionCost(amount, colony.name, buyOrders[0].roomName!);
        if (terminal.store.energy > cost + 30_000) { // Respect terminal reserve (§16)
            Game.market.deal(buyOrders[0].id, amount, colony.name);
        }
    }
}
```

**Catalyst (X) special handling:** X is consumed at every T3 step but cannot be synthesized — it must always be purchased. Create a standing buy order (`Game.market.createOrder`) for X at SMA × 0.95 to passively accumulate at below-market prices.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- AUTOMATED FOUNDRY PAPER — Confirmed missing via audit of Hatchery.ts   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- NOTE: Most of this paper is ALREADY fully implemented in Hatchery.ts:  -->
<!--  ✅ Priority queue (sorted on every enqueue)                           -->
<!--  ✅ Multi-spawn support with virtual energy ledger (no double-spend)   -->
<!--  ✅ Three-phase handshake via pendingSpawns GlobalCache Set            -->
<!--  ✅ Body cost deadlock guard (drop impossible, wait for affordable)     -->
<!--  ✅ Template repetition via CreepBody.grow()                           -->
<!--  ✅ Recovery mode spawn governor (clamp to 400e during isRecovering)   -->
<!--  ✅ maxEnergy cap per-request (Overlords restrict morphological growth) -->
<!--  ✅ Heap-first queue (cleared + re-enqueued each tick)                 -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 36. TTL-Based Pre-Spawning (Creep Replacement Before Death)
**Automated Foundry Paper — Prespawning and TTL**

No Overlord currently monitors `ticksToLive` to pre-spawn a replacement before the current creep dies. When a miner or reserver dies, there is a gap equal to full spawn time + travel time before the replacement arrives. At max distance this is ~150 ticks spawning + 50 ticks travel = 200 tick production gap per miner death.

**Gap:** Every Overlord in the codebase only checks `this.miners.length < targetCount` — it doesn't account for a miner with 5 ticks to live that is functionally already dead.

**Fix — add to each critical Overlord's `init()`:**
```ts
// In MiningOverlord.init(), ReserverOverlord.init(), etc.:
const activeMiners = this.miners.filter(m => {
    const ttl = m.creep?.ticksToLive ?? 0;
    const replacementLeadTime = m.creep!.body.length * CREEP_SPAWN_TIME + this.travelDistance;
    return ttl > replacementLeadTime; // Only count creeps that will survive long enough
});

if (activeMiners.length < this.targetCount) {
    this.colony.hatchery.enqueue({ ... }); // Pre-spawn the replacement
}
```

**Priority order for implementation:**
1. `MiningOverlord` — each 200-tick gap loses 2,000 energy
2. `ReserverOverlord` — reservation decay is expensive to recover  
3. `TransporterOverlord` — hauler gaps cause logistics gridlock

---

## 37. Flow-Based Spawn Scheduling (E/t Production vs. Consumption)
**Automated Foundry Paper — Lifetime Value / Flow-Based Model**

The current system uses count-based logic (`miners.length < targetCount`). If a colony has 2 miners and 3 haulers but is energy-negative (consuming more than producing), it won't respond by adding more miners because count targets are already met. A net-negative flow can eventually drain storage and cause a blackout.

**Implementation — add to `ColonyProcess` or `BootstrappingOverlord`:**
```ts
// Estimate E/t production and consumption each tick:
const miners = colony.zergs.filter(z => z.memory.role === 'miner');
const ept_production = miners.reduce((s, m) => {
    const workParts = m.creep?.getActiveBodyparts(WORK) ?? 0;
    return s + workParts * HARVEST_POWER; // 2 energy per WORK per tick
}, 0);

const haulers = colony.zergs.filter(z => z.memory.role === 'transporter');
const upgraders = colony.zergs.filter(z => z.memory.role === 'upgrader');
const ept_consumption =
    upgraders.reduce((s, u) => s + (u.creep?.getActiveBodyparts(WORK) ?? 0) * UPGRADE_CONTROLLER_POWER, 0) +
    haulers.length * 2; // Hauler move cost approximation

colony.state.netEnergyPerTick = ept_production - ept_consumption;

// If net flow is negative and storage < 50k, inject a miner request above economic priority
if (colony.state.netEnergyPerTick < 0 && storageLevel < 50_000) {
    colony.hatchery.enqueue({ priority: 90, bodyTemplate: [WORK, WORK, MOVE], overlord: this });
}
```

**Note:** This is a signal-injection mechanism, not a replacement for count-based spawning. It acts as a safety valve when the count system doesn't detect a flow problem.

---

## 38. Multi-Room Spawning (Global SpawnManager)
**Automated Foundry Paper — Multi-Room Spawning**

Each `Hatchery` is completely room-local. When a new room is being bootstrapped — especially at RCL 1/2 where the new room's own spawn can only produce 300-energy creeps — there is no way to request a large pioneer or worker from a mature neighbour's hatchery. The paper describes a global `SpawnManager` layer above individual `Hatchery` instances.

**Gap:** `ColonyProcess` (or `GlobalManager`) has no cross-colony spawn routing. The only cross-colony creep dispatch is `PioneerOverlord`, which enqueues on the local colony's hatchery — it assumes the local colony will always have the capacity.

**Design:**
```ts
class GlobalSpawnManager {
    // Called each tick before colony run loops
    run(): void {
        for (const request of this.pendingCrossColonyRequests) {
            const candidates = Object.values(colonies)
                .filter(c => c.name !== request.targetColony)
                .filter(c => c.hatchery.spawns.some(s => !s.spawning))
                .filter(c => c.room?.energyAvailable >= request.minCost);

            // Prefer closest colony to target (minimize creep travel time)
            const best = candidates.sort((a, b) =>
                Game.map.getRoomLinearDistance(a.name, request.targetColony) -
                Game.map.getRoomLinearDistance(b.name, request.targetColony)
            )[0];

            if (best) {
                best.hatchery.enqueue({
                    ...request.spawnRequest,
                    memory: { ...request.spawnRequest.memory, targetColony: request.targetColony }
                });
                this.pendingCrossColonyRequests.delete(request);
            }
        }
    }
}
```

**Gate:** Only useful at GCL 2+ (multiple rooms). The travel-time break-even is: if the target room is >30 tiles away and the best cross-colony creep only saves 2 body parts vs. local spawn, it's not worth it. Add a `minBodyPartSaving` threshold guard before routing.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- PREVIOUSLY DISMISSED / MISSED ITEMS — Added on full review pass        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 39. Terminal Leaky Bucket Throughput Tracking
**Link/Terminal Paper — Leaky Bucket Throughput Model**

The terminal has an incoming throughput limit (≈50 energy/tick incoming, burst capacity ≈300,000). If two rooms simultaneously send energy to a single destination during burst operations (e.g., GCL farming, emergency tower refill), transfers beyond the bucket cap are silently dropped. No code tracks this limit.

**Gap:** `TerminalOverlord` and `EmpireLogisticsProcess` (§20) issue `terminal.send()` with no awareness of how much the destination has received recently.

**Fix:**
```ts
// Track outbound sends per destination in Memory, cleared each tick
interface TerminalFlowLedger {
    [roomName: string]: { sentThisTick: number; bucketAvailable: number };
}

const TERMINAL_TICK_LIMIT = 50;       // units/tick incoming cap
const TERMINAL_BURST_CAP  = 300_000;  // total burst capacity

// Before any terminal.send():
const destLedger = flowLedger[dest] ??= { sentThisTick: 0, bucketAvailable: TERMINAL_BURST_CAP };
if (destLedger.sentThisTick + amount > TERMINAL_TICK_LIMIT) {
    // Over tick cap — defer to next tick
    return;
}
destLedger.sentThisTick += amount;
destLedger.bucketAvailable -= amount;
terminal.send(resource, amount, dest);
```

Store `flowLedger` in `GlobalCache` (heap), reset `sentThisTick` to 0 each tick. `bucketAvailable` decays by `TERMINAL_TICK_LIMIT` per tick (passive refill).

---

## 40. Cross-Shard Portal Logistics (Virtual Sink/Source)
**Global Logistics Broker Paper — Cross-Shard Economies**

The existing §5 (Inter-Shard Memory) covers the ISM memory protocol. The paper additionally defines a logistics routing pattern where portals are treated as **virtual sinks and sources** in the logistics graph — allowing the empire-wide balancing system to treat a shard-1 energy surplus as available supply for a shard-3 deficit room.

**Gap:** No portal-awareness in `EmpireLogisticsProcess` (§20). A room next to a portal is treated identically to any other room.

**Design:**
```ts
// Register portal exit as a virtual "offer" on shard 0:
if (room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_PORTAL }).length > 0) {
    const portalDestination = InterShardMemory.getLocal()[shard1RoomName];
    // Treat portal tile as a 0-cost "terminal" that can ship to any shard-N room
    // that has registered itself as needing energy via InterShardMemory
}
```

The ISM segment stores each shard room's deficit. Shard 0's logistics process reads shard 1's ISM, and if a shard-0 room is adjacent to a portal leading to shard 1's deficit room, it ships energy there first before intra-shard balancing.

> **Depends on:** §5 (ISM), §20 (EmpireLogisticsProcess).

---

## 41. Directive / Flag System (Military Intent Layer)
**Military Paper — Directives as Goal Wrappers**

The entire Overseer→Directive→Overlord architectural layer is absent. Currently, military operations (`DestroyerOverlord`) are hard-coded to a `targetRoom` string at construction time. There is no way to dynamically issue or retract a military objective without code changes. The paper describes **Directives** — persistent, flag-backed goal objects — as the correct abstraction.

**What's missing:**
- No `Directive` base class
- No `DestroyDirective` / `HarassDirective` / `ScoutDirective` types
- No `Overseer` scan that reads room flags and instantiates Overlords from them
- No human-in-the-loop flag placement triggering automated siege logic

**Minimal implementation:**
```ts
// A Directive wraps a room flag and instantiates the appropriate Overlord
class DestroyDirective {
    flag: Flag;
    overlord: DestroyerOverlord;

    constructor(flag: Flag) {
        this.flag = flag;
        this.overlord = new DestroyerOverlord(getColonyFor(flag.pos.roomName), flag.pos.roomName);
    }

    run(): void {
        // If flag removed → retract overlord, despawn destroyers
        if (!Game.flags[this.flag.name]) this.overlord.retract();
    }
}

// In GlobalManager.run():
for (const flag of Object.values(Game.flags)) {
    if (flag.color === COLOR_RED && !directives[flag.name]) {
        directives[flag.name] = new DestroyDirective(flag);
    }
}
```

> **Dependency of:** §26 (Siege Overlord), §25 (Drainer FSM), §43 (Expansion Quarantine).

---

## 42. Combat Scout Directive (Pre-Attack Room Intelligence)
**Military Paper — Scouting and Strategic Selection**

`ScoutOverlord` scouts for room expansion scoring (source count, controller level, etc.). It does **not** gather military intelligence. Before committing a `DestroyerOverlord` or `SiegeOverlord`, the bot should record enemy defensive metrics.

**Missing data gathered by a `CombatScoutDirective`:**
```ts
interface CombatIntel {
    roomName: string;
    scoutedAt: number;           // Game.time
    towerCount: number;
    towerEnergy: number[];       // Per-tower energy levels observed
    rampartMinHits: number;      // Lowest rampart HP
    rampartAvgHits: number;
    spawns: number;
    labCount: number;
    hasBoostLabs: boolean;       // Any labs with combat compounds?
    ownerUsername?: string;
}
```

**Flow:**
1. `GlobalManager` detects a hostile player room within 5 rooms of any colony.
2. Places a `CombatScoutDirective` → spawns a 1-MOVE scout.
3. Scout enters the room, calls `room.find()` on structures, records `CombatIntel` to `Memory.combatIntel[roomName]`.
4. `DestroyerOverlord` / `SiegeOverlord` reads this intel before spawning to select the right body and boost tier.

> **Depends on:** §41 (Directive system).

---

## 43. Expansion Quarantining (Hostile Expansion Detection)
**Military Paper — Phase 3 / Expansion Quarantining**

No code detects when a hostile player is claiming a room adjacent to our empire and automatically dispatches harassers to slow their growth.

**Detection — add to `GlobalManager` or `ScoutOverlord`:**
```ts
// Run every 100 ticks
for (const roomName of scoutedRooms) {
    const mem = Memory.rooms[roomName];
    if (!mem) continue;

    // Room is being claimed/reserved by a non-ally
    if (mem.owner && mem.owner !== MY_USERNAME && mem.owner !== 'Invader') {
        const distToNearestColony = Math.min(
            ...myColonyNames.map(c => Game.map.getRoomLinearDistance(c, roomName))
        );
        if (distToNearestColony <= 5) {
            // Place a HarassDirective — spawn a ranged kiter to drain their bootstrapper
            placeDirective('HARASS', roomName);
        }
    }
}
```

**Harasser body:** `[RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE]` — cheap, fast, targets their bootstrapper/pioneer to reset their spawn. Spawn from nearest friendly colony.

> **Depends on:** §41 (Directive system), §42 (Combat Scout).

---

## 44. Kernel Spawn-Duration Sleep Timer (Hatchery CPU Optimization)
**Automated Foundry Paper — Process Suspension in the Kernel**

Once `spawnCreep()` returns `OK` on a 50-part creep, the Hatchery knows it will take exactly `50 × 3 = 150 ticks` to finish. Currently `Hatchery.run()` polls `spawn.spawning` every tick for all 150 ticks — wasted CPU.

**Gap:** The Kernel has an O(1) wake map (confirmed in the forensics audit). There is no code that tells the Kernel "wake this process at tick N."

**Fix — in `Hatchery.run()` after a successful spawnCreep:**
```ts
if (result === OK) {
    const wakeAt = Game.time + body.length * CREEP_SPAWN_TIME;
    // Suspend hatchery from checking this spawn name until wake tick
    spawnSleepMap.set(request.name!, wakeAt);
}

// At top of run(), skip spawns that are sleeping:
for (const [name, wakeAt] of spawnSleepMap) {
    if (Game.time >= wakeAt) spawnSleepMap.delete(name);
}
const pendingNames = new Set(spawnSleepMap.keys());
// Skip any spawn whose current spawning.name is in pendingNames
```

Store `spawnSleepMap` in `GlobalCache` (heap). This eliminates 149 redundant `spawn.spawning` reads per large creep spawn.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- GENESIS PROTOCOL PAPER — Confirmed missing via code audit               -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- NOTE: Most of this paper is already implemented:                        -->
<!--  ✅ Kernel/Process architecture, GlobalCache heap-first storage         -->
<!--  ✅ Three-phase spawn handshake (Hatchery.ts pendingSpawns GlobalCache) -->
<!--  ✅ Orphan adoption (Overlord.zergs getter — re-parents via _overlord)  -->
<!--  ✅ Tiered priority queue (Hatchery.ts sort by priority)                -->
<!--  ✅ Emergency bootstrapper (BootstrappingOverlord, isCriticalBlackout)  -->
<!--  ✅ Gale-Shapley + reservation ledger (LogisticsNetwork.ts)             -->
<!--  ✅ Part-count balancing for haulers (TransporterOverlord.wishlistSpawns)-->
<!--  ✅ Road repair-on-transit with WORK part (TransporterOverlord.run())   -->
<!--  ✅ TTL pre-spawning for transporters (discounts dying creeps)          -->
<!--  ✅ Road-aware body (2:1 CARRY:MOVE on roads, 1:1 on plains)           -->
<!--  ✅ Bunker stamp + distance transform (BunkerLayout + ConstructionOverlord)-->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 45. Construction Site Build-Order Prioritization
**Genesis Protocol Paper — The Genesis Build Order**

`ConstructionOverlord` picks construction sites with no ROI-based ordering. The paper defines a strict priority sequence:

| Priority | Structure | Reason |
|---|---|---|
| 1 | Source Container | Prevents decay; enables static mining |
| 2 | Controller Container | Stabilizes upgrader supply |
| 3 | Extensions | Morphology scaling |
| 4 | Towers | Active defense |
| 5 | Roads | MOVE efficiency |
| 6 | Storage | 1M buffer |

**Implementation — sort sites in `ConstructionOverlord`:**
```ts
const SITE_PRIORITY: Partial<Record<BuildableStructureConstant, number>> = {
    [STRUCTURE_CONTAINER]: 1, // Refined to 1 (source) or 2 (controller) below
    [STRUCTURE_EXTENSION]: 3,
    [STRUCTURE_TOWER]:     4,
    [STRUCTURE_ROAD]:      5,
    [STRUCTURE_STORAGE]:   6,
    [STRUCTURE_WALL]:      7,
    [STRUCTURE_RAMPART]:   7,
    [STRUCTURE_LAB]:       8,
    [STRUCTURE_TERMINAL]:  8,
};

sites.sort((a, b) => {
    const prio = (site: ConstructionSite) => {
        if (site.structureType === STRUCTURE_CONTAINER) {
            const nearSource = room.find(FIND_SOURCES).some(s => site.pos.getRangeTo(s) <= 2);
            return nearSource ? 1 : 2;
        }
        return SITE_PRIORITY[site.structureType] ?? 9;
    };
    return prio(a) - prio(b);
});
```

---

## 46. Mathematical Upgrader Spawn Trigger (Surplus Gate)
**Genesis Protocol Paper / RCL 1-4 Paper — The Mathematical Upgrader Trigger / Death Spiral Prevention**

`UpgradingOverlord` uses a flat floor (`storage.energy > 100_000`). The paper defines a mathematically precise formula that gates upgrader spawns on **net energy flow** — preventing spawns from tipping a balanced economy into deficit.

**Formula:** `canSpawn = S_eff > T_crit + |Flow_net| × TimeHorizon`

- `S_eff` = storage energy − outgoing logistics reservations
- `T_crit` = cost to replace all miners + haulers + 5,000 maintenance buffer
- `Flow_net` = E/t production − consumption (from §37 flow model)
- `TimeHorizon` = upgrader body length × 3 + 50 ticks

```ts
// In UpgradingOverlord.init():
const sEff = storage.store.energy
    - (this.colony.logistics.outgoingReservationTotal ?? 0);

const tCrit = MINER_REPLACEMENT_COST + HAULER_REPLACEMENT_COST + 5_000;
const flowNet  = this.colony.state?.netEnergyPerTick ?? 0;
const horizon  = (upgraderBodyLength * 3) + 50;

const canSpawn = sEff > tCrit + Math.abs(Math.min(0, flowNet)) * horizon;
```

**Why it matters:** A colony with 105k stored but `Flow_net = −3 E/t` passes the static 100k floor. The formula blocks the spawn because the economy is consuming more than it produces — the additional upgrader would compound the deficit.

### RCL 1 Pioneer Count Formula (pre-storage context)
Before Storage exists, the upgrader trigger applies to pioneers at **RCL 1**. The optimal pioneer count is derived from:
```
Source yield: 3,000 energy / 300 ticks = 10 E/tick (owned room)
Pioneer harvest: 2 WORK × 2 E/WORK = 4 E/tick per pioneer
Duty cycle (moving overhead): ~77% productive
Pioners needed = 10 E/tick ÷ (4 E/tick × 0.77) = 3.25... → ~6.5 for two sources

For one source: ceil(10 / (4 × 0.77)) = ceil(3.25) = 3-4 pioneers
For two sources: 6-7 pioneers
```
Spawning ≥8 pioneers causes idle creeps — TTL waste exceeds the energy they'd contribute.

### Metabolic Collapse Guard (RCL 1 bootstrap)
At RCL 1, the spawn regenerates only **1 energy/tick** passively — far too slow to refill for back-to-back pioneer spawns. The first 2 pioneers spawned must **transfer to spawn** (`creep.transfer(spawn, RESOURCE_ENERGY)`) until `spawn.energy > 250` before being permitted to upgrade the controller:
```ts
// In BootstrappingOverlord.run() per pioneer:
const spawnBuffer = colony.hatchery?.room.energyAvailable ?? 0;
if (spawnBuffer < 250 && pioneer.store.energy > 0) {
    pioneer.transfer(spawn, RESOURCE_ENERGY); // Fill spawn first
} else {
    pioneer.upgradeController(room.controller!);
}
```
Without this guard, the colony spawns 2 pioneers, runs out of spawn energy, and enters a stall where no further creeps can be spawned until the first pioneers accidentally return energy — a cascade that can cost 100+ ticks at RCL 1.

---

## 47. Subreaper Process (Stale-PID Orphan Recovery)
**Genesis Protocol Paper — The Orphan Adoption (Subreaper) Logic**

> *Borrowed from Linux: a "subreaper" is a process that inherits orphaned child processes when their original parent is destroyed, rather than letting them idle until PID 1 claims them.*

### What our current system does
`Overlord.zergs` getter scans colony creeps each tick and filters by `_overlord === this.processId`. This correctly re-adopts creeps after a **global heap reset** — their Memory tag is intact, so the existing Overlord claims them instantly.

### The failure case it misses
If an Overlord is **permanently removed** — e.g. `DestroyerOverlord` finishes its mission and is torn down — any surviving destroyer creeps retain `_overlord: "destroyer_W1N1"` in memory. No active Overlord has that `processId`, so no `zergs` getter ever claims them. They become **permanent zombies** — alive, consuming ticks, performing no logic — until they decay at 1,500 ticks.

### Subreaper implementation
```ts
// Run every 10 ticks in ColonyProcess or a dedicated SubReaperProcess
if (Game.time % 10 !== 0) return;

const activeProcessIds = new Set(colony.overlords.map(o => o.processId));

for (const creep of colony.creeps) {
    const ownerId = (creep.memory as any)._overlord as string | undefined;

    // Creep has a stale PID (owner no longer exists)
    if (ownerId && !activeProcessIds.has(ownerId)) {
        // Categorize by body parts and re-parent
        if (creep.getActiveBodyparts(WORK) > 0) {
            (creep.memory as any)._overlord = 'worker'; // Re-parent to WorkerOverlord
        } else if (creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
            (creep.memory as any)._overlord = 'defense'; // Re-parent to DefenseOverlord
        } else if (creep.getActiveBodyparts(CARRY) > 0) {
            (creep.memory as any)._overlord = 'transporter'; // Re-parent to TransporterOverlord
        } else {
            // Cannot re-parent — recycle by moving to spawn for energy recovery
            (creep.memory as any)._overlord = 'bootstrapping';
        }
        log.warning(`Subreaper: re-parented orphan '${creep.name}' (was '${ownerId}')`);
    }
}
```

### Difference from current system

| Scenario | `Overlord.zergs` getter | Subreaper |
|---|---|---|
| Global heap reset | ✅ Instant re-adoption | ✅ Also works |
| Overlord destroyed (stale PID) | ❌ Creep becomes permanent zombie | ✅ Detected + re-parented |
| Creep in wrong room | ✅ Still claimed if PID matches | ✅ Re-parented to best fit |

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- CONSOLE OBSERVABILITY PAPER — Confirmed missing via code audit          -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- NOTE: Logger.ts + ErrorMapper.ts already implement virtually everything:-->
<!--  ✅ 5-level severity (TRACE/DEBUG/INFO/WARNING/ERROR) + emoji prefixes  -->
<!--  ✅ Lazy evaluation — LogMessage = string | (() => string)              -->
<!--  ✅ Heap-cached log level (avoids Memory Proxy hit per call)            -->
<!--  ✅ Delta alerting — log.alert(key, value) with 1000-entry pruned Map   -->
<!--  ✅ Modulo throttling with stagger offset — log.throttle(N, msg, offset)-->
<!--  ✅ <font color="..."> (not <span>) — correct client-safe HTML          -->
<!--  ✅ Interactive room links — Logger.roomLink() with shard detection     -->
<!--  ✅ XSS sanitization — Logger.sanitize() escapes <>&"                  -->
<!--  ✅ ErrorMapper: source-map resolution, heap-cached consumer, trace     -->
<!--     dedup fingerprint, 50-entry persistent Memory.errorLog              -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 48. Screeps-Profiler Integration (Prototype-Level CPU Measurement)
**Console Observability Paper — The Screeps Profiler**

> *"The community-developed screeps-profiler is the gold standard for performance logging. It works by wrapping standard game prototypes and measuring the CPU used by each method call, then outputs a formatted table showing average and total CPU usage for every function."*

No profiler integration exists. `ErrorMapper` identifies crash sites after the fact; it cannot show which method is silently consuming 3ms per tick across 300 creeps.

**What screeps-profiler adds that `Logger` cannot:**
- Wraps `Creep.prototype`, `Room.prototype`, `RoomPosition.prototype`, etc. at the method level
- Measures CPU delta before/after every call — identifies expensive prototype methods invisibly consuming CPU
- Outputs a ranked table: `[method] | calls | total CPU | avg CPU` — pin-points the bottleneck without any per-site instrumentation

**Integration pattern (dev-only, gate behind Memory flag):**
```ts
// main.ts — wrap once at global scope, not inside the loop
import { Profiler } from 'screeps-profiler';

if (Memory.profilerEnabled) {
    Profiler.enable();
}

export const loop = ErrorMapper.wrapLoop(() => {
    if (Memory.profilerEnabled) {
        Profiler.wrap(() => kernel.run());
    } else {
        kernel.run();
    }
});
```

**Install:** `npm install screeps-profiler --save-dev`

**Toggle from console:** `Memory.profilerEnabled = true` → redeploy → watch the table after 100 ticks → `Memory.profilerEnabled = false` → redeploy to remove overhead.

**Why it matters:** Logger + ErrorMapper identify *what crashed* and *what state things were in*. Profiler identifies *why the CPU bucket is draining* — the class of invisible performance bug no amount of strategic logging can find.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- SCIENCE OVERLORD PAPER — Additional items not covered in §30-35        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- §30-35 already cover: Science Overlord scaffold, recursive dependency  -->
<!-- resolver, Scientist FSM, boost request protocol, empire mineral quota,  -->
<!-- and make-vs-buy market logic. New items below are distinct gaps.        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 49. Lab Cluster Geometry Validation (Range-2 Constraint Enforcement)
**Science Overlord Paper — Algorithmic Spatial Placement / Flower vs Diamond**

The bunker stamp places 10 lab tiles but contains no code that verifies the **range-2 constraint**: every output lab must be within range 2 of *both* input labs for `lab.runReaction(inputLab1, inputLab2)` to return `OK` rather than `ERR_NOT_IN_RANGE`. If the stamp shifts (e.g. due to terrain obstacles), reactions silently fail.

**Standard layouts:**

| Layout | Input positions (relative to cluster center) | Best for |
|---|---|---|
| **Flower** | Center pair: `(0,0)` and `(1,0)` — outputs in circle | Compact bases — 1 Science Hub tile reaches all labs |
| **Diamond** | Diagonal pair: `(0,0)` and `(0,2)` — outputs in grid | Bunker stamps — integrates with min-cut rampart perimeter |
| **Figure-8** | Linear pair sharing a long axis — scalable from 3→10 | Progressive growth from RCL 6 to RCL 8 |

**Validation function — run during `ScienceOverlord.init()` after RCL 6:**
```ts
function validateLabCluster(inputLab1: StructureLab, inputLab2: StructureLab,
                             outputLabs: StructureLab[]): boolean {
    for (const lab of outputLabs) {
        const r1 = lab.pos.getRangeTo(inputLab1.pos);
        const r2 = lab.pos.getRangeTo(inputLab2.pos);
        if (r1 > 2 || r2 > 2) {
            log.error(`Lab cluster geometry violation: lab at ${lab.pos} is range ${r1}/${r2} from inputs (max 2)`);
            return false;
        }
    }
    return true;
}
```

Run once every 500 ticks. If validation fails, log a WARNING and fall back to one-at-a-time reactions on whichever output labs are in range.

**Scientist Hub tile** — pre-compute the single tile that minimizes total travel distance to all 10 labs + Terminal:
```ts
// During colony boot, cache this tile in Memory.rooms[name].scienceHub
const hubTile = _.minBy(walkableTiles, tile =>
    [inputLab1, inputLab2, ...outputLabs, terminal]
        .reduce((sum, s) => sum + tile.getRangeTo(s.pos), 0)
);
```

---

## 50. Cooldown-Aware Reaction Scheduler with Per-Tier Sleep Timer
**Science Overlord Paper — CPU Efficiency / Process Suspension**

The reaction scheduler in §30 checks `lab.cooldown > 0` every tick. This works but wastes CPU examining all 8 output labs every tick even when the slowest reaction (T3) has an 80-tick cooldown. The paper specifies per-tier cooldowns that the scheduler should use to sleep the reaction process.

**Reaction cooldown table:**
| Tier | Example | Cooldown (ticks) |
|---|---|---|
| Base minerals | H + O → H2O | 5 |
| Tier 1 | GH, UH, ZO, etc. | 10 |
| Tier 2 | GH2O, UH2O, etc. | 15 |
| Tier 3 (T3) | XGH2O, XLHO2, etc. | 80 |

**Sleep timer integration (extends §44 Kernel Sleep Timer):**
```ts
// After a successful runReaction(), record wake time per output lab:
const cooldown = REACTION_TIME[product] ?? 10; // REACTION_TIME = lookup table above
spawnSleepMap.set(`lab:${lab.id}`, Game.time + cooldown);

// At top of reaction scheduler, skip sleeping labs:
if ((spawnSleepMap.get(`lab:${lab.id}`) ?? 0) > Game.time) continue;
```

**CPU bucket gate (batch reactions only when healthy):**
```ts
// Skip entire reaction batch if bucket is low — defend CPU for logistics+defense
if (Game.cpu.bucket < 500) return;

// Also skip if product stockpile is already at quota (§34):
const quota = Memory.mineralQuotas?.[colony.name]?.[product] ?? 3000;
if ((terminal.store[product] ?? 0) >= quota) continue;
```

This eliminates 8 redundant `lab.cooldown` property reads per tick during a T3 production run (80-tick windows), reducing per-tick overhead by ~0.3 CPU per room at full 10-lab operation.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- QUAD SYSTEMS PAPER — All items confirmed MISSING                        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- §25 (Drainer) enriched with attrition doctrine (range 15-20, rangedMassAttack) -->
<!-- §26 (Siege) enriched with 4-phase quad doctrine and safe mode counter   -->
<!-- New sections below: quad-specific systems not covered anywhere          -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 51. 2x2 Dilated CostMatrix Pathfinding
**Quad Paper — Geometric Dilation / Multi-Tile Entity Movement**

PathFinder calculates routes for single-tile entities. A 2×2 quad occupies 4 tiles simultaneously — routing the anchor creep normally causes trailing members to collide with walls. **Geometric dilation** pre-processes terrain so PathFinder implicitly steers the entire 2×2 footprint clear of obstacles.

### Dilation Rule
For every unwalkable tile at `(x, y)`, mark these 4 tiles as impassable in the quad's CostMatrix:
```
(x,   y),  (x-1, y),  (x,   y-1),  (x-1, y-1)
```
This ensures: if the **anchor** (top-left creep) is on any walkable tile in the dilated matrix, all 3 other members are guaranteed to also be on walkable terrain.

### Implementation
```ts
function buildQuadCostMatrix(room: Room): CostMatrix {
    const matrix = new PathFinder.CostMatrix();
    const terrain = new Room.Terrain(room.name);

    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                // Dilate: mark all 4 anchor positions that would place a quad member here
                matrix.set(x,   y,   255);
                matrix.set(x-1, y,   255);
                matrix.set(x,   y-1, 255);
                matrix.set(x-1, y-1, 255);
            }
            // Also mark swamp penalty for all 4 dilated positions (§52 note)
            if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
                for (const [dx, dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
                    const cx = x + dx, cy = y + dy;
                    if (matrix.get(cx, cy) < 10) matrix.set(cx, cy, 10);
                }
            }
        }
    }

    // Structures: mark built obstacles
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART) {
            matrix.set(s.pos.x - 1, s.pos.y,     255);
            matrix.set(s.pos.x,     s.pos.y - 1, 255);
            matrix.set(s.pos.x - 1, s.pos.y - 1, 255);
            matrix.set(s.pos.x,     s.pos.y,     255);
        }
    }
    return matrix;
}
```

**Cache:** Store the dilated matrix in `GlobalCache` per room. Invalidate when a structure is built/destroyed (`room.find(FIND_STRUCTURES)` count changes). Reuse for all movement calls that tick.

**Dynamic obstacles:** Hostile creeps get cost **50** (not 255) — encourages routing around but doesn't fail the path if surrounded.

---

## 52. Collective Fatigue Engine (creep.pull())
**Quad Paper — Kinetic Synchronization / Shared Fatigue**

Each creep in a 2×2 quad independently generates and clears fatigue. If members have different MOVE counts, the slowest member controls group speed. Without synchronization, the quad desynchronizes after entering any swamp.

### Fatigue Model
```
Fatigue generated on move = Σ(non-MOVE body parts) × terrain_cost
Fatigue cleared per tick   = Σ(MOVE parts × 2)

For 1 tile/tick movement:  cleared ≥ generated required
Swamp: terrain_cost = 10   (vs 2 on plain, 1 on road)
```

### Pull Chain (lockstep movement)
```ts
// Designate creep[0] as "Engine" — it leads and pulls the chain
// Each member pulls the next: [0] pulls [1] pulls [2] pulls [3]
// Result: fatigue from all members concentrates on the Engine
const [engine, back1, back2, back3] = quadMembers;

// Movement intent order matters — must be set before game processes movement:
engine.move(directionToTarget);
engine.pull(back1);   // back1's fatigue transfers to engine
back1.move(engine);   // back1 follows engine
back1.pull(back2);
back2.move(back1);
back2.pull(back3);
back3.move(back2);
```

### Engine Body Design
Since all fatigue concentrates on the Engine, over-provision its MOVE parts:
```ts
// Standard plain terrain — 1 MOVE per 2 non-MOVE parts:
// Engine: [TOUGH×4, MOVE×4, HEAL×8, MOVE×6]  ← extra MOVE absorbs followers' fatigue
// Heavy:  [TOUGH×4, MOVE×2, WORK×12]          ← MOVE-light; fatigue transferred to Engine
```

With T3 `XZHO2` (MOVE boost): fatigue clearance = MOVE × 2 × 3 = 6× per MOVE part — allows 2:1 WORK:MOVE ratio even in swamps.

---

## 53. Predictive Triage Healing
**Quad Paper — Defensive Resilience / Pre-Healing**

No heal prioritization exists for squads. Individual creeps heal themselves reactively. Against 6 RCL 8 towers all targeting the same creep (3,600 DPT at close range), reactive healing is fatal — the creep dies before the heal intent fires.

### Algorithm
```ts
function triageQuad(members: CombatZerg[], room: Room): void {
    const towers = room.find(FIND_HOSTILE_STRUCTURES,
        { filter: s => s.structureType === STRUCTURE_TOWER }) as StructureTower[];

    // Step 1: Predict incoming damage for each member
    const predicted = members.map(m => ({
        member: m,
        incomingDamage: towers.reduce((sum, t) => sum + calcTowerDamage(t, m.pos!), 0),
        effectiveDamage: 0,
    }));

    // Step 2: Apply TOUGH reduction
    for (const p of predicted) {
        const toughMult = getToughDamageMultiplier(p.member.creep!);
        p.effectiveDamage = p.incomingDamage * toughMult;
    }

    // Step 3: Sort by most at-risk (highest effective damage relative to current HP)
    predicted.sort((a, b) =>
        (b.effectiveDamage - (b.member.hits ?? 0))
        - (a.effectiveDamage - (a.member.hits ?? 0))
    );

    // Step 4: Assign healers to highest-deficit member first
    const healers = members.filter(m => m.creep?.getActiveBodyparts(HEAL) > 0);
    const primaryTarget = predicted[0].member;

    for (const healer of healers) {
        const dist = healer.pos?.getRangeTo(primaryTarget.pos!);
        if (dist === 1) {
            healer.heal(primaryTarget.creep!);      // 12 HP × boost
        } else if (dist && dist <= 3) {
            healer.rangedHeal(primaryTarget.creep!); // 4 HP × boost
        }
    }
}
```

**Boost reference for triage:**
| Part | Unboosted | T3 Boosted (XLHO2) |
|---|---|---|
| `HEAL` (melee range 1) | 12 HP/tick | 48 HP/tick |
| `HEAL` (ranged range 3) | 4 HP/tick | 16 HP/tick |
| `TOUGH` damage factor | 1.0× | 0.3× (70% reduction) |

**Pre-healing:** Even if the target is at full HP, assign healers to the predicted primary target *before* damage resolves — the heal and damage intents process the same tick, minimizing the net health deficit.

---

## 54. Snake Formation FSM (1×4 ↔ 2×2 Transitions)
**Quad Paper — Structural Fluidity / Chokepoint Navigation**

Bunkers intentionally include 1-wide corridors and zig-zag entrances to break 2×2 formations. A rigid movement engine stalls at these chokepoints. The Snake FSM allows the quad to transition to a 1×4 line and reform after passing through.

### Detection
```ts
// Attempt dilated pathfinding (§51). If no path found:
const quadPath = PathFinder.search(anchor.pos, target, { roomCallback: () => dilatedMatrix });
if (quadPath.incomplete) {
    // Fall back to standard 1-tile pathfinding — if this succeeds, chokepoint detected
    const singlePath = PathFinder.search(anchor.pos, target);
    if (!singlePath.incomplete) triggerSnakeMode();
}
```

### FIFO Coordinate Buffer
```ts
// Maintain a rolling queue of the last 4 positions the leader occupied
const positionBuffer: RoomPosition[] = [];  // Stored in heap (not Memory)

// Each tick: push leader's current pos, trim to 4 entries
positionBuffer.push(leader.pos.clone());
if (positionBuffer.length > 4) positionBuffer.shift();

// Assign followers to buffer positions by index:
// Member[1] → positionBuffer[1], Member[2] → positionBuffer[2], etc.
for (let i = 1; i < quadMembers.length; i++) {
    const target = positionBuffer[positionBuffer.length - i];
    if (target) quadMembers[i].moveTo(target);
}
```

### FSM States
```
QUAD_MOVE   → 2×2 formation; dilated CostMatrix pathfinding; pull chain active
SNAKE_ENTER → Leader enters chokepoint; followers switch to FIFO buffer tracking
SNAKE_MOVE  → All members traverse corridor in single file; rangedHeal() only (adjacency lost)
SNAKE_EXIT  → Leader reaches open area and stops; followers close up
QUAD_REFORM → Once all members adjacent in 2×2 positions → QUAD_MOVE
```

**Healing during Snake:** Members may be 2-3 tiles apart in the corridor. Switch from `heal()` to `rangedHeal()` for all members. Ideally trigger snake transitions only when outside tower range — the tail is completely exposed during re-formation.

**Performance:** `positionBuffer` uses `RoomPosition.clone()` to avoid heap reference leaks. Never serialize the buffer to Memory — it's ephemeral and rebuilds after global reset (the quad simply re-detects its formation state from member positions).

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- RCL 1-4 SPEEDRUN PAPER — Confirmed already implemented:                 -->
<!--  ✅ Kernel/heap-first architecture, GlobalCache                         -->
<!--  ✅ Three-phase spawn handshake (Hatchery.ts + pendingSpawns)           -->
<!--  ✅ Orphan adoption (Overlord.zergs getter)                             -->
<!--  ✅ Gale-Shapley stable matching (LogisticsNetwork.ts)                  -->
<!--  ✅ Road repair-on-transit (TransporterOverlord.run())                  -->
<!--  ✅ TTL pre-spawning (discounts dying creeps)                           -->
<!--  ✅ Bunker stamp + distance transform (BunkerLayout)                    -->
<!--  ✅ BootstrappingOverlord + isCriticalBlackout                          -->
<!-- New items below: early-game math not captured elsewhere                 -->
<!-- §4 enriched with §51-54 quad system references                          -->
<!-- §46 enriched with pioneer count formula + metabolic collapse guard      -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 55. Container vs Drop Mining ROI (RCL 2 Paradigm Shift)
**RCL 1-4 Paper — The Mining Paradigm Shift and Container Economics**

At RCL 2, the `BootstrappingOverlord` must pivot from universal pioneers to a static miner + hauler split. A key decision at this point: **drop mining vs container mining**.

### Energy Yield Comparison

| Method | Gross Yield | Loss | Net E/tick | How |
|---|---|---|---|---|
| **Drop Mining** | 10 E/tick | 1.0 E/tick decay | **9.0 E/tick** | Decay = `ceil(pile/1000)` = 1/tick at 10 E/tick accumulation |
| **Container Mining** | 10 E/tick | 0.1 E/tick upkeep | **9.9 E/tick** | Container decays 5,000 HP/100 ticks; repair() = 1 energy per 100 HP |

**Drop mining decay math:** Energy piles decay at `ceil(amount/1000)` per tick. At 10 E/tick accumulation, any pile grows fast enough to always trigger ≥1 unit of decay per tick.

**Container upkeep math:**
- Container loses 5,000 HP / 100 ticks = 50 HP/tick of structural decay
- `repair()` restores 100 HP per 1 energy → cost = **0.5 E/tick** (remote/neutral rooms)
- In **owned rooms**: decay rate is 10× lower → **0.1 E/tick** upkeep
- Container mining yields 10× less waste than drop mining in owned rooms

**ROI on container build cost (250 energy):**
```
Savings per tick = 9.9 - 9.0 = 0.9 E/tick
Break-even      = 250 energy ÷ 0.9 E/tick = ~278 ticks ≈ <1 source regeneration cycle
```
The container pays for itself in under one 300-tick source cycle. Build it first (§45 priority 1).

### 6 WORK Miner with Integrated Repair Duty
A 5 WORK miner fully saturates the source (5 × 2 E/WORK = 10 E/tick). Upgrade to **6 WORK** to use the spare action slot for `repair()`:
```ts
// In MiningOverlord run(), after harvest():
const container = miner.pos?.lookFor(LOOK_STRUCTURES)
    .find(s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer | undefined;
if (container && container.hits < container.hitsMax && miner.store.energy > 0) {
    miner.repair(container); // Uses 1 energy, restores 100 HP — zero overhead, no dedicated repairman
}
```
With WORK boost (`XLH2O`): repair restores 400 HP/energy — a 6 WORK miner maintains the container indefinitely with near-zero energy cost.

### Hauler CPU Savings (cache container ID vs room.find)
```ts
// BAD — expensive every tick for every hauler:
const drops = room.find(FIND_DROPPED_RESOURCES); // O(n) spatial scan

// GOOD — O(1) lookup after container is built:
const containerId = Memory.colonies[colony.name].sourceContainerIds[sourceIdx];
const container = Game.getObjectById(containerId);
hauler.withdraw(container, RESOURCE_ENERGY); // Bypasses spatial query entirely
```
Cache container IDs in `Memory.colonies[name].sourceContainerIds[]` during `MiningOverlord.init()` when the container is first detected.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- EMPIRE SCALE PAPER — Confirmed already implemented:                     -->
<!--  ✅ RoomScorer.ts + ScoutOverlord.ts (room scoring exists)             -->
<!--  ✅ ColonizeDirective lifecycle (partially — claim flag placement)      -->
<!--  ✅ BootstrappingOverlord (pioneer spawning and management)             -->
<!--  ✅ GlobalManager auto-creates Colony on room claim                     -->
<!--  ✅ Terminal network (§16-21 cover terminal logistics)                  -->
<!-- New items below: Observer scouting and terminal leaky bucket            -->
<!-- §6 enriched: full ColonizeDirective lifecycle, surplus formula,        -->
<!--   pioneer body table, maturation milestones, CPU hibernation,          -->
<!--   colonization failover and cool-down                                  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 56. Observer-Driven Room Scouting
**Empire Scale Paper — Strategic Room Selection / Observer Automation**

`ScoutOverlord` dispatches `[MOVE]` scout creeps reactively (when a flag is placed). At RCL 8, the `STRUCTURE_OBSERVER` allows the bot to gain vision of any room within 10 rooms at **zero creep cost** — 0 CPU overhead vs. ~3 CPU to path and move a scout creep each tick.

The Observer is currently **unused**. There is no code that calls `observer.observeRoom()` or that uses the Observer to power an automated discovery pipeline.

### Observer Mechanics
```ts
// StructureObserver: 1 observeRoom() call per tick, costs 1 CPU intent
// Vision persists for that tick only — must call every tick for continuous coverage
observer.observeRoom('W10N5'); // Gain vision of W10N5 this tick
const room = Game.rooms['W10N5']; // Now accessible
```

### Rotation Algorithm (systematic map coverage)
```ts
// Store scan cursor in GlobalCache (heap — no Memory serialization cost)
let scanCursor = GlobalCache.get('observerCursor') ?? 0;
const candidateRooms = getEmpireAdjacentRooms(); // All rooms within 10 of any colony

// Scan one room per tick in rotation:
const targetRoom = candidateRooms[scanCursor % candidateRooms.length];
observer.observeRoom(targetRoom);
GlobalCache.set('observerCursor', scanCursor + 1);

// After gaining vision, feed into RoomScorer:
const room = Game.rooms[targetRoom];
if (room) roomScorer.scoreAndRecord(room);
```

### Room Scoring Criteria (automated target selection, no flag needed)
| Criterion | Weight | Measurement |
|---|---|---|
| Source count | 2× bonus | `room.find(FIND_SOURCES).length === 2` |
| Plain terrain percentage | High | Distance transform max value > 5 |
| Mineral synergy | High | Empire lacks this mineral type |
| Distance to nearest colony | Penalty | `Game.map.getRoomLinearDistance()` |
| Strategic isolation | Bonus | Room in Novice/Respawn area |
| Existing owner/reservation | Disqualifier | `room.controller?.owner` or `.reservation` |

When a room scores above `EXPANSION_THRESHOLD` AND colonization gates pass (§6b): auto-place ColonizeDirective without any player flag.

> **Gate:** Requires RCL 8 (Observer unlocked). Observer should be placed during base layout planning (§BunkerLayout).

---

## 57. Terminal Inbound Throughput Limit (Leaky Bucket)
**Empire Scale Paper — Terminal Network / Leaky Bucket Throughput**

The Screeps server enforces a **leaky bucket** rate limit on inbound terminal transactions. This is not documented in the official API but confirmed in forum discussions and observed behavior:

```
Inbound limit: 50 resource units per tick
Bucket capacity: 300,000 units (fills at 50/tick when not draining)
```

This means a room cannot receive more than 50 resources/tick from all incoming terminal transfers combined, regardless of the sender's capacity. Sending 1,000,000 energy in a single transaction does not instantly refill the recipient — the energy is queued and drained at 50/tick.

### Implications for Empire Logistics
1. **Emergency energy refills are slow:** A newly-spawned colony needing 100k energy takes at minimum `100,000 / 50 = 2,000 ticks` to receive it via terminal alone
2. **Cannot terminal-bootstrap RCL 1-3 rooms:** Physical pioneer/transporter supply must fill the gap (§6c Phase 3)
3. **Over-sending is safe but wasteful:** The terminal will hold excess until the recipient's bucket drains it — but this blocks the sender's terminal for the cooldown period

### Architectural Impact
```ts
// When planning bulk energy transfers, check effective throughput:
const TERMINAL_INBOUND_RATE = 50; // units/tick
const ticksToDeliver = Math.ceil(amount / TERMINAL_INBOUND_RATE);

// For colonization support: supplement terminal delivery with Transporter haulers
// until the new room reaches RCL 6+ and has sufficient local harvesting
if (targetRCL < 6) {
    usePhysicalTransporters = true; // Don't rely on terminal alone
}
```

> **Note:** This limit also justifies the Logistics Hubs (§20) — hubs maintain large energy reserves because even with priority access, inbound delivery cannot instantly refill them during emergencies.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- POWER CREEP PAPER — All items confirmed MISSING (zero PC code exists)   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 58. Power Creep Operator — Full Integration
**Power Creep Paper — Kernel-Driven Operator Architecture**

No Power Creep logic exists anywhere in the codebase — no `PowerProcess`, no registry, no FSM, no ops logistics, no renewal logic.

> **Gate:** Requires GPL > 0 (Power Creeps must be unlocked and leveled). Start at GPL 1 with `GENERATE_OPS`; invest in `OPERATE_SPAWN` and `OPERATE_LAB` at mid-GPL.

### 58a. Global Power Registry (Memory Schema)
```ts
// Memory.powerRegistry[pcName]:
interface PowerCreepRecord {
    name: string;
    state: OperatorState;           // FSM state for recovery after global reset
    assignedRoom: string;           // Home room
    ticksToLive: number;            // Updated every tick when spawned
    spawnCooldown: number;          // 8-hour lockout timer when dead
    powers: Record<number, number>; // Cached { [POWER_ID]: level } — avoid repeated API calls
    opsThreshold: number;           // Withdraw from storage when carry < this (default: 200)
}
```
Power Creeps exist at account level and survive room loss — this registry is the single source of truth across global resets.

### 58b. Operator FSM (Priority-Ordered States)

```
RENEW            → Absolute priority 1. TTL < TTL_safe → move to PowerSpawn → pc.renew()
ENABLE_ROOM      → Priority 2. room.controller.isPowerEnabled === false → pc.enableRoom(ctrl)
GENERATE_OPS     → Priority 3. Always on cooldown check every 50 ticks; background task
                   (compatible with MOVE in same tick — execute while traveling)
OPERATE_EXTENSION→ Priority 4. energyAvailable < 50% energyCapacity AND spawn is active
                   → move within range 3 of storage → usePower(PWR_OPERATE_EXTENSION)
OPERATE_SPAWN    → Priority 5. spawnQueue.estimatedClearTime > threshold
                   → move within range 3 of spawn → usePower(PWR_OPERATE_SPAWN)
OPERATE_LAB      → Priority 6. lab.effects[PWR_OPERATE_LAB].ticksRemaining < 50
                   → move within range 3 of lab → usePower(PWR_OPERATE_LAB)
IDLE             → Move to central "ops hub" tile; execute GENERATE_OPS if ready
```

### 58c. OPERATE_EXTENSION Automation
```ts
// Trigger condition (checked every tick):
const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
const spawnBusy = room.find(FIND_MY_SPAWNS).some(s => s.spawning !== null);

if (energyRatio < 0.5 && spawnBusy) {
    const target = room.storage ?? room.terminal;
    if (pc.pos.inRangeTo(target!, 3)) {
        pc.usePower(PWR_OPERATE_EXTENSION, target!);
    } else {
        pc.moveTo(target!);
    }
}
```

**Fill percentage by level (ops cost: 2, cooldown: 50 ticks):**
| Level | Fill % | Required PC Level |
|---|---|---|
| 1 | 20% | 0 |
| 2 | 40% | 2 |
| 3 | 60% | 7 |
| 4 | 80% | 14 |
| 5 | 100% | 22 |

At level 5, a single activation fills all 60 extensions + spawn instantly — replaces an entire courier fleet during burst spawning.

### 58d. OPERATE_SPAWN Automation
Sprint viability formula:
```ts
// Is OPERATE_SPAWN worth using right now?
const queueTicks = spawnQueue.reduce((sum, req) => sum + req.bodyLength * 3, 0);
const spawnReductionRatio = 0.8; // Level 5 = 80% reduction
const timeSaved = queueTicks * spawnReductionRatio;
const opsCost = 100;
const opsValuePerTick = currentOpsPrice; // From market EMA

if (timeSaved > 50 || room.isUnderAttack) { // 50 tick threshold
    pc.usePower(PWR_OPERATE_SPAWN, spawn);
}
```
Level 5 provides 80% spawn time reduction for 1,000 ticks — essentially 5× spawn throughput. Apply during sieges, rapid fleet replacement, or mass colonization pushes.

### 58e. OPERATE_LAB Automation
```ts
// Track effect expiry on input labs:
for (const lab of [inputLab1, inputLab2]) {
    const effect = lab.effects?.find(e => e.effect === PWR_OPERATE_LAB);
    const ticksLeft = effect?.ticksRemaining ?? 0;
    if (ticksLeft < 50) {
        // Move and apply before the effect expires (50 tick buffer for travel time)
        if (pc.pos.inRangeTo(lab, 3)) {
            pc.usePower(PWR_OPERATE_LAB, lab);
        } else {
            pc.moveTo(lab);
        }
    }
}
```
OPERATE_LAB adds 2-10 reaction units/tick for 1,000 ticks. At level 5 (10 extra/tick) a single room produces compounds at ~3× the normal rate — equivalent to running a 3-room lab network from one room.

### 58f. Ops Resource Logistics
```ts
// Ops generation rate (Level 22): 8 ops / 50 ticks = 0.16 ops/tick
// Ops needed: 100 (OPERATE_SPAWN) + 10 (OPERATE_LAB) per 1000 ticks = 0.11 ops/tick
// Net positive at high level; OPERATE_EXTENSION at 2 ops/50 ticks adds only 0.04 ops/tick burden

// Carry management:
const LOW_OPS = 200;   // Withdraw from storage when below this
const HIGH_OPS = 800;  // Deposit surplus when above this

if ((pc.store[RESOURCE_OPS] ?? 0) < LOW_OPS) {
    pc.withdraw(room.storage!, RESOURCE_OPS, Math.min(800, room.storage!.store[RESOURCE_OPS]));
} else if ((pc.store[RESOURCE_OPS] ?? 0) > HIGH_OPS) {
    pc.transfer(room.storage!, RESOURCE_OPS, pc.store[RESOURCE_OPS] - HIGH_OPS);
}
```

**Empire-wide ops balancing via Terminal:**
- Treat ops like energy in §20 EmpireLogisticsProcess
- Priority tiers: `ops < 200` = DEFICIT (request inbound); `ops 200-500` = STABLE; `ops > 500` = SURPLUS (push to deficit rooms)
- Use `OPERATE_TERMINAL` to reduce transfer energy cost by 50% — positive feedback loop
- If empire-wide ops < 10% of aggregate requirement: buy from NPC highway terminal buy orders (`Game.market.deal`)

### 58g. Safe Renewal Threshold Formula
```ts
// Proactive renewal — never let the PC die to age
function getSafeRenewalThreshold(pc: PowerCreep, powerSpawnPos: RoomPosition): number {
    const travelTime = Math.ceil(
        PathFinder.search(pc.pos, { pos: powerSpawnPos, range: 1 }).cost
    ); // PC has no fatigue: 1 tile/tick always
    const SAFETY_BUFFER = 100; // Extra ticks for emergency tasks or path blockage
    return travelTime + SAFETY_BUFFER;
}

// In FSM every tick:
if (pc.ticksToLive < getSafeRenewalThreshold(pc, nearestPowerSpawn.pos)) {
    setState('RENEW'); // Override all other states — highest priority
}
```

**TTL phase table:**
| Phase | TTL Range | Action |
|---|---|---|
| Nominal | > travelTime + 500 | Normal economy optimization |
| Cautionary | travelTime + 500 to travelTime + 100 | Finish current task, route toward PowerSpawn |
| Critical | travelTime + 100 to travelTime | Abandon task, move to PowerSpawn |
| Emergency | < travelTime | Force-path ignoring traffic; treat as highest kernel priority |

### 58h. 8-Hour Lockout Recovery
```ts
// In PowerProcess.run() when pc.ticksToLive === 0 (dead):
Memory.powerRegistry[pc.name].state = 'OFFLINE';
Memory.powerRegistry[pc.name].spawnCooldown = DATE_NOW + (8 * 3600 * 1000); // 8 hours real-time

// Compensate for lost OPERATE_EXTENSION: spawn extra courier creeps
colony.hatchery.enqueue({ role: 'filler', priority: HIGH, count: +2 });

// Recovery check (run every 100 ticks when OFFLINE):
for (const pcName in Memory.powerRegistry) {
    const record = Memory.powerRegistry[pcName];
    if (record.state === 'OFFLINE') {
        const pc = Game.powerCreeps[pcName];
        if (pc && pc.spawnCooldown === 0) {
            const powerSpawn = colony.room.find(FIND_MY_STRUCTURES,
                { filter: s => s.structureType === STRUCTURE_POWER_SPAWN })[0];
            if (powerSpawn) {
                pc.spawn(powerSpawn as StructurePowerSpawn);
                record.state = 'ENABLE_ROOM'; // First action after respawn
            }
        }
    }
}
```

### 58i. Burst Spawning Coordination (OPERATE_EXTENSION + OPERATE_SPAWN Synergy)
```ts
// SpawnManager signals the PC process when a large burst begins:
// 1. SpawnManager sets Memory.powerRegistry[pcName].burstActive = true
// 2. PC FSM enters OPERATE_EXTENSION loop:
//    - Wait for energyAvailable to drop (first creep in burst finishes)
//    - Trigger OPERATE_EXTENSION → extensions instantly refilled for next creep
//    - Repeat for each creep in the burst queue
// 3. OPERATE_SPAWN applied once at burst start (1000-tick effect covers entire burst)

// Net result at Level 5:
// - Standard 50-part spawn: 150 ticks → 30 ticks (80% reduction)
// - 10 queued creeps: 1,500 ticks → 300 ticks
// - Extensions refilled between each spawn: 0 courier-ticks needed
// CPU savings: eliminates ~10 courier paths/burst = ~15 CPU/burst
```

### 58j. Intensification Ratio
```
R_intensification = (room_value_with_PC) / (room_value_without_PC)

At Level 5 OPERATE_SPAWN + OPERATE_LAB:
  Spawn throughput: 5× (80% reduction)
  Lab throughput:   3× (10 extra reactions/tick)
  Combined:         R ≈ 3.0 to 4.0 (one powered room ≈ 3-4 standard rooms)

Energy cost of power processing: 50 energy / 1 power unit
This energy could fund RCL upgrades for GCL. Break-even:
  If R > 3: intensive growth (Power Creep) is preferred over extensive growth (new room)
  If empire has room slots unused: prioritize extensive until rooms are full
```

> **Cross-references:** OPERATE_TERMINAL reduces logistics costs (§20); OPERATE_SPAWN synergizes with Hatchery (§44); `ops` terminals use same EMA valuation as §18.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- STRATEGIC DIRECTIVES PAPER — Items already captured elsewhere:          -->
<!--  ✅ ColonizeDirective lifecycle (§6 — fully enriched)                  -->
<!--  ✅ Quad dilated CostMatrix, fatigue, triage, snake FSM (§51-54)        -->
<!--  ✅ Siege Overlord 4-phase doctrine (§26)                               -->
<!--  ✅ Tower draining FSM (§25)                                            -->
<!--  ✅ Power Creep Operator FSM (§58)                                      -->
<!--  ✅ Gale-Shapley logistics (confirmed in LogisticsNetwork.ts)           -->
<!-- New: Science Overlord (§7 enriched), PowerBankDirective (§59),         -->
<!--      Min-Cut GuardDirective (§60)                                       -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 59. PowerBankDirective (Highway Power Acquisition)
**Strategic Directives Paper — PowerBankDirective / Power Harvesting**

No code handles Power Banks. Power Banks contain 500-10,000 power units inside 2,000,000 HP structures in highway rooms. They are the only source of power for GPL advancement and are time-limited (expire at 0 HP or after ~32,000 ticks of spawning).

> **Gate:** RCL 8 required (needs 50+ part creeps and Terminal for power hauling). Power Banks are in highway rooms with no controller — any player can claim the drops.

### Reflect Damage Math (Duo Design)
Power Banks reflect **50% of incoming melee damage** back to the attacker. Because a creep cannot `attack()` and `heal()` in the same tick (shared combat pipeline), cracking requires a **Duo**: one ATTACK creep and one dedicated HEAL companion.

```
Attacker: 20 ATTACK parts
  DPS out: 20 × 30 = 600 hits/tick
  Reflect:          300 hits/tick received

Healer companion minimum HEAL required:
  300 reflect ÷ 12 HP per HEAL part = 25 HEAL parts
```

### Optimal Duo Bodies
| Role | Body | Cost | Notes |
|---|---|---|---|
| **Attacker** | `TOUGH×10, ATTACK×20, MOVE×20` | 2,100 | TOUGH absorbs early reflect spikes |
| **Healer** | `HEAL×25, MOVE×25` | 7,500 | Fully covers 300 reflect/tick |

Both creeps move at 1 tile/tick (equal MOVE:non-MOVE ratio on plains). They must stay adjacent — healer uses `heal(attacker)` every tick while attacker calls `attack(powerBank)`.

### Power Hauler Fleet Sizing
```ts
// Hauler calculation based on observed power amount:
const powerAmount = powerBank.power;           // 500–10,000
const carryPerHauler = 25;                     // 25 CARRY parts = 500 capacity
const travelTicks = pathLength * 2;            // Round trip distance
const ticksUntilCracked = powerBank.hits / 600; // Estimated at 600 DPS

// Haulers needed: enough CARRY for all power, arriving as bank hits 0
const haulersNeeded = Math.ceil(powerAmount / (carryPerHauler * 50)); // 50 = CARRY capacity

// Dispatch haulers so they arrive when bank.hits < 10,000 (end of crack):
const dispatchAt = Game.time + ticksUntilCracked - travelTicks;
```

### Timing and "Snipe" Prevention
Other players can collect dropped power the tick it hits the ground. The hauler fleet **must** arrive at the bank on the exact tick it reaches 0 HP. The PowerBankDirective calculates dispatch time and pre-positions haulers 1-2 rooms away during the crack phase. Haul body: `[CARRY×25, MOVE×25]` for 1 tile/tick speed regardless of carry load.

---

## 60. Min-Cut Wall Placement (GuardDirective Algorithmic Fortification)
**Strategic Directives Paper — GuardDirective / Minimum Weighted Rampart Placement**

Currently, rampart placement is hardcoded in `BunkerLayout`. No automated min-cut calculation exists. The current layout may use more ramparts than mathematically necessary, exposing inner structures to RangedMassAttack and increasing repair CPU overhead.

> **Gate:** RCL 5+ (rampart HP worth protecting). Run once during room setup and re-run on source room structural changes. Cache result in `Memory.rooms[name].minCutRamparts`.

### Min-Cut Algorithm (Edmonds-Karp / Dinic's)
The problem is modeled as an **s-t max-flow** on a directed flow network:
```
For each room tile at (x, y):
  Split into two nodes: in-node[x,y] and out-node[x,y]
  Connect them with capacity = tile_weight:
    - Tiles inside the protect zone (near spawn/storage): capacity = ∞ (never cut)
    - Tiles adjacent to exits: capacity = ∞ (source nodes)
    - All other walkable tiles: capacity = 1

Adjacent tiles connect: out-node[x,y] → in-node[x2,y2] with capacity ∞

Run max-flow from source (exit tiles) to sink (core structures)
The min-cut identifies which tile-nodes to cut = where to place ramparts
```
By the max-flow min-cut theorem, the set of cut tiles is the minimum number of ramparts needed to completely separate exits from the base core.

Reference implementations: `Josef37/screeps-min-cut-wall` (GitHub), `clarkok` gist (Edmonds-Karp).

### 3-Tile Buffer Rule
Ramparts must be placed **at least 3 tiles** from any internal structure. This prevents `rangedMassAttack()` (effective at range 3) from hitting structures while attackers are blocked by the rampart line.

```ts
// Filter min-cut tiles that are < 3 away from core structures:
const corePositions = [storage.pos, terminal.pos, ...spawns.map(s => s.pos)];
rampartCandidates = minCutTiles.filter(pos =>
    corePositions.every(core => pos.getRangeTo(core) >= 3)
);
```

### 1-HP Rampart Shield Strategy (Mechanical Exploit)
A rampart with **any positive HP** absorbs an entire incoming attack intent, regardless of damage magnitude. This enables a zero-energy-cost "repair-build" trick:

```ts
// When a rampart is about to be destroyed (hits <= 1):
// Place a construction site for a new rampart on the SAME tile.
// As the old rampart dies, the new one spawns at 1 HP → absorbs the next attack.
// Cost: 1 energy per repair tick (100 HP restored per energy).
// Effect: reduces damage throughput by ~33%, blocks any single attack per tick.

if (rampart.hits <= 1) {
    room.createConstructionSite(rampart.pos, STRUCTURE_RAMPART);
    // Worker must reach and repair 1 HP within the same tick or next tick
}
```

### Stationary Defender Body Patterns
Guards placed on ramparts before a siege can use all 50 parts for combat (no MOVE required while stationary):
| Pattern | Body | Strategic Intent |
|---|---|---|
| **Heavy Melee Guard** | `ATTACK×40, HEAL×10` | Max melee back-power vs. attackers |
| **Mass Attack Guard** | `RANGED_ATTACK×30, HEAL×20` | AoE damage to punish quad formations |
| **Paladin** | `TOUGH×10, ATTACK×20, HEAL×20` | Tanking frontline (requires T3 XGHO2 boost) |

### Tower Hold-Fire Logic (Drainer Countermeasure)
If a hostile creep's **boosted heal-per-tick (HPT) exceeds combined tower DPT at current ranges**, firing wastes energy permanently with no net damage effect. Add to `DefenseOverlord`:

```ts
const towerDPT = towers.reduce((sum, t) => sum + getTowerDamageAt(t.pos, hostile.pos), 0);
const hostileHPT = hostile.body.filter(p => p.type === HEAL).length
    * 12 * (isT3Boosted(hostile) ? 4 : 1);

if (hostileHPT >= towerDPT) {
    return; // HOLD FIRE — drainer detected; save energy for authentic threats
}
towers.forEach(t => t.attack(hostile));
```
> **Cross-references:** Min-cut ramparts complement BunkerLayout (§45 build order priority 7). GuardDirective defender bodies align with §26 Siege counter-strategy. Tower Hold-Fire was previously noted in §25 but this is the full implementation.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- LOGISTICS BROKERAGE / TRAFFIC PAPER — Already implemented:              -->
<!--  ✅ Kernel/Process/Scheduler architecture                               -->
<!--  ✅ Gale-Shapley logistics matching (LogisticsNetwork.ts)               -->
<!--  ✅ Move Priority system (MovePriority.ts — just created)               -->
<!--  ✅ TrafficManager with push protocol                                   -->
<!--  ✅ ParkingZones.ts (existing parking logic)                            -->
<!--  ✅ 1:2 MOVE:CARRY road body ratio (TransporterOverlord)                -->
<!--  ✅ Distance Transform + BunkerLayout                                   -->
<!--  ✅ Heap-first GlobalCache; parsed memory preservation                  -->
<!-- New: §61 predictive request amount, §62 rampart-aware idling +         -->
<!--       Abandon Directive, §63 RCL8 Stationary Manager                   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 61. Predictive Request Amount and Floodfill Traffic Zoning
**Logistics Brokerage Paper — predictedRequestAmount / Throughput Optimization**

`LogisticsNetwork.requestTask()` scores tasks by current amount and distance but does **not** account for the fill rate of the source during transit. A hauler assigned to a nearly-empty container 20 tiles away will arrive to find 200 more energy than was present when the task was scored — the estimate is stale.

### predictedRequestAmount
```ts
function predictedRequestAmount(
    target: StoreStructure | Resource,
    haulerPos: RoomPosition,
    fillRatePerTick: number  // From MiningOverlord: 2 × WORK parts (e.g. 10 E/tick for 5 WORK)
): number {
    const travelTicks = PathFinder.search(haulerPos, { pos: target.pos, range: 1 }).cost;
    const currentAmount = 'store' in target
        ? target.store.getUsedCapacity(RESOURCE_ENERGY)
        : target.amount;
    return Math.min(
        currentAmount + fillRatePerTick * travelTicks,
        'store' in target ? target.store.getCapacity(RESOURCE_ENERGY) : Infinity
    );
}
```
Cache `fillRatePerTick` in `Memory.rooms[name].sourceFillRates[sourceId]` during `MiningOverlord.init()`. A hauler that is moving is still "active" — the predicted amount eliminates what would otherwise appear as idle transit time.

### Floodfill Traffic Zone Classification
After base layout is finalized, classify tiles by proximity to core structures:
```ts
// Zone 0 — Core (range ≤ 1 from Storage/Spawn): Queens and fillers only
// Zone 1 — Logistics Ring (range 2-4): Active haulers in transit
// Zone 2 — Periphery (range 5+): Parking zone for idle creeps

const zone = (pos: RoomPosition): 0 | 1 | 2 => {
    const d = Math.min(
        pos.getRangeTo(storage),
        ...spawns.map(s => pos.getRangeTo(s))
    );
    if (d <= 1) return 0;
    if (d <= 4) return 1;
    return 2;
};

// In TrafficManager: idle creep in Zone 0 or 1 → push to nearest Zone 2 tile
if (creep.memory.priority === MovePriority.IDLE && zone(creep.pos) < 2) {
    const parkingTile = colony.parkingZones.getNearestZone2Tile(creep.pos);
    trafficManager.requestMove(creep, parkingTile);
}
```
Store the zone map in `GlobalCache` — recompute only on room structural changes.

---

## 62. Rampart-Aware Defensive Parking and Abandon Directive
**Logistics Brokerage Paper — Defensive Posturing / Abandon Protocol**

### Rampart-Aware Idling (DEFCON Retreat)
When `DefenseOverlord` sets room DEFCON ≥ 3 (enemies inside perimeter), all idle creeps must retreat to rampart-covered tiles instead of parking in Zone 2. Currently there is no RetreatTask and no rampart-tile index.

```ts
// Add to ParkingZones (or new RampartCoverIndex):
function getNearestCoveredTile(pos: RoomPosition, room: Room): RoomPosition | undefined {
    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART && s.hits > 0
    });
    return ramparts
        .map(r => r.pos)
        .sort((a, b) => a.getRangeTo(pos) - b.getRangeTo(pos))[0];
}

// In TransporterOverlord.run():
if (defcon >= 3 && creep.isIdle()) {
    const safePos = getNearestCoveredTile(creep.pos, room);
    if (safePos) creep.task = new MoveTask(safePos); // RetreatTask
}
```
This override fires before normal logistics assignment. Remote miners/haulers in dangerous rooms retreat toward the colony controller (safest point).

### Abandon Directive (Total Breach Evacuation)
No `DirectiveAbandon` exists. If all towers are destroyed or an overwhelming force breaches the bunker, the Overseer needs a final "evacuate wealth" protocol.

```ts
// DirectiveAbandon triggers when:
//   - All owned structures below 20% HP AND no safe mode available
//   - OR player manually places an Abandon flag

// Evacuation actions (priority order):
// 1. Withdraw all non-energy minerals from Terminal and Storage
// 2. Activate terminal.send() to nearest viable colony for each resource
// 3. All mobile creeps pick up dropped resources; transfer to any hauler heading out
// 4. Spawn only if parent colony can be reached within TTL of the creep

// Memory flag after abandon:
Memory.colonies[roomName].isAbandoned = true;
Memory.colonies[roomName].abandonedAt = Game.time;

// GlobalManager: skip Colony process for abandoned rooms;
// retain Memory.rooms[roomName] for 10,000 ticks for post-analysis
```
> **Gate:** Requires Terminal (RCL 6+) and at least one adjacent colony with a functional Terminal to receive resources.

---

## 63. RCL 8 Stationary Manager (Zero-Idle Anchor Creep)
**Logistics Brokerage Paper — Stationary Manager Architecture**

At RCL 8, the traditional hauler role reaches its limits. The standard filler fleet burns CPU on pathfinding and occupies tiles in the bunker core. The **Stationary Manager** (or "Queen V2") replaces them with a single immobile creep permanently stationed at an anchor tile.

### Body Plan
```ts
// Stationary Manager body — NO MOVE parts:
const body = repeatParts([CARRY, CARRY, WORK, WORK, WORK, WORK], 5);
// = 10 CARRY + 20 WORK (can also use all CARRY for pure logistics)
// Spawned at anchor tile by positioning the hatchery spawn adjacent to it
// OR: spawned normally then "pushed" to anchor by a dedicated mover creep (1 tick only)
```

### Anchor Tile Placement
The anchor tile must be **within range 1 of Storage, Terminal, and at least 4-6 extensions/links**. In standard bunker layouts this is typically the center tile of the Fast Filler flower (§55: 7 extensions in 7 ticks from one tile).

### Functional Coverage
```ts
// In ManagerOverlord.run():
// 1. Transfer energy from storage to adjacent extensions (cycle through all in-range)
// 2. Transfer minerals from storage to terminal (when terminal needs restocking)
// 3. Transfer energy from link to storage (when link is full)
// 4. When all of the above are satisfied (manager.isIdle() effectively):
//    Fortify nearest rampart below HP threshold using repair()
//    (WORK parts: 1 energy → 100 HP; 20 WORK = 2000 HP/tick of rampart fortification)
```

### Zero-Idle Logic
The manager has **no idle state** — when logistics are balanced it fortifies ramparts. This ensures every tick of the creep's 1,500-tick lifespan contributes either energy throughput or structural defense. No MoveTo calls are ever issued — eliminates all pathfinding CPU for this role.

### Spawning Continuity
Apply TTL pre-spawning (as with transporters): spawn the replacement manager when the current one's TTL falls below `body.length × 3 + 5 ticks`. The replacement is pushed to the anchor tile by the expiring manager (which can move the new creep during the 1 tick they overlap).

> **Gate:** Only valuable at RCL 8 with fully built bunker and Fast Filler layout in place. Earlier RCLs should use standard filler creeps.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- PATHFINDING / TRAFFIC MANAGEMENT PAPER — Already implemented:           -->
<!--  ✅ TrafficManager.ts (centralized intent reconciliation, push/swap)    -->
<!--  ✅ MovePriority.ts (just created — priority-based displacement)        -->
<!--  ✅ Static/dynamic CostMatrix separation with heap caching              -->
<!--  ✅ Broadphase routing (Game.map.findRoute corridor narrowing)          -->
<!--  ✅ Heap-first GlobalCache vs Memory serialization                      -->
<!--  ✅ Distance Transform + Floodfill (BunkerLayout, ParkingZones)         -->
<!--  ✅ Recursive shoving/vacatePos                                         -->
<!--  ✅ Dynamic road-health-weighted CostMatrix (recent implementation)     -->
<!-- New: §64 Bipartite Matching traffic, §65 heuristic tuning/stuck        -->
<!--       detection/pull-train borders, §66 WASM/Clockwork pathfinding     -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 64. Bipartite Matching Traffic Reconciliation (Ford-Fulkerson)
**Pathfinding Paper — Level 3 Traffic Management / Graph Theory**

The current `TrafficManager` uses sequential processing with recursive shoving. This inherently favors creeps evaluated earlier in the JavaScript loop — later creeps are forced to detour around tiles already claimed by earlier creeps, producing suboptimal global throughput. The **Bipartite Matching** approach evaluates the entire room's movement matrix simultaneously.

### The Flow Network Model
```
Vertices Set A: Every creep with a move intent this tick
Vertices Set B: Every walkable tile adjacent to any of those creeps
Edges:
  - creep → desired_target_tile  (capacity 1: primary intent)
  - creep → current_tile         (capacity 1: "stay" option — always valid)

Objective: maximize total fulfilled move intents without assigning 2 creeps to same tile

Algorithm: Ford-Fulkerson (or Edmonds-Karp for guaranteed O(VE²)):
  1. Build adjacency → intent graph each tick
  2. Run max-flow on the bipartite graph
  3. Each matched edge represents a fulfilled move intent
  4. Unmatched creeps stay in place (no deadlock, just sub-optimal throughput)
```

### Why It's Superior to Recursive Shoving
- **No ordering bias**: all creeps evaluated simultaneously — no first-processed advantage
- **Eliminates circular deadlock**: graph max-flow handles cyclic dependencies mathematically
- **Guaranteed max throughput**: Ford-Fulkerson provably maximizes fulfilled move intents
- **Handles N-body jams** (mass upgrading, siege clusters) where sequential pushing fails

### Implementation Note
This is complex to implement from scratch. Reference implementation: `sy-harabi/screeps-traffic` (the author's blog post "Journey to Solving the Traffic Management Problem" details the exact Screeps adaptation). For our `TrafficManager.ts`, this represents the upgrade path beyond the current recursive shoving model once the basic system is stable.

> **Priority:** Implement after the current MovePriority + recursive shoving system is proven stable. BMP adds ~5ms CPU overhead vs ~2ms for shoving, but eliminates all systematic ordering bias.

---

## 65. Pathfinding Heuristic Tuning, Stuck Detection, and Pull Train Border Logic
**Pathfinding Paper — Advanced Routing Heuristics / Temporal Stuck Detection / creep.pull() borders**

### Heuristic Weight Tuning
The current `TrafficManager` uses PathFinder with default `heuristicWeight: 1.0` (true A*). Increasing this transforms A* into Greedy Best-First Search — exponentially faster but occasionally jagged paths:

```ts
// Dynamic heuristic based on CPU and creep priority:
const cpuAvailable = Game.cpu.bucket;
const heuristicWeight =
    cpuAvailable > 8000 ? 1.0 :   // Full A* when bucket is healthy
    cpuAvailable > 4000 ? 1.2 :   // Slightly greedy
    cpuAvailable > 1000 ? 1.5 :   // Very greedy (fast but jagged)
    2.0;                           // Emergency mode: near-Dijkstra speed penalty

const result = PathFinder.search(origin, goal, { heuristicWeight, maxOps: 1500 });
```

**Path smoothing** (post-search): After a greedy search, straighten jagged paths by iterating over consecutive direction pairs and collapsing unnecessary zigzags:
```ts
function smoothPath(path: RoomPosition[]): RoomPosition[] {
    // Remove intermediate positions that are collinear with neighbors
    return path.filter((pos, i) =>
        i === 0 || i === path.length - 1 ||
        pos.getDirectionTo(path[i-1]) !== path[i+1].getDirectionTo(path[i])
    );
}
```

### Move Off Exit (Anti-Bounce)
When a creep transitions to a new room, the pathfinder sometimes returns it to the exit tile on the next tick (bounce loop). Override for exactly one tick upon room entry:
```ts
// Track last known roomName in creep memory:
if (creep.memory.lastRoom !== creep.room.name) {
    creep.memory.lastRoom = creep.room.name;
    // Force one step away from the exit tile:
    const awayFromExit = creep.pos.getDirectionTo(creep.room.getPositionAt(25, 25)!);
    creep.move(awayFromExit); // Override pathfinder for this single tick
    return; // Skip normal pathfinding this tick
}
```

### Temporal Stuck Detection
`ERR_NO_PATH` is an unreliable stuck indicator — a creep may have a valid path cached but be physically blocked by a stationary ally. Track coordinates across ticks:

```ts
// In Zerg.travelTo() (or TrafficManager post-reconciliation):
const STUCK_THRESHOLD = 3; // ticks without moving = stuck
const lastPos = creep.memory.lastPos;
const lastPosTime = creep.memory.lastPosTime ?? Game.time;

if (lastPos && creep.pos.isEqualTo(lastPos.x, lastPos.y)) {
    if (Game.time - lastPosTime >= STUCK_THRESHOLD) {
        // STUCK — force path recalculation with blocking entity cost-inflated
        const blocker = creep.pos.lookFor(LOOK_CREEPS)
            .find(c => c.name !== creep.name);
        if (blocker) {
            // Inject high cost for blocking creep's tile in next pathfind:
            creep.memory.avoidPos = { x: blocker.pos.x, y: blocker.pos.y, cost: 50 };
        }
        delete creep.memory.cachedPath; // Force full path recalculation
        creep.memory.lastPosTime = Game.time;
    }
} else {
    creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y };
    creep.memory.lastPosTime = Game.time;
}
```

### Pull Train Border Crossing (Multi-tick Choreography)
`creep.pull()` trains break at room exits because the tug transitions to the new room before the wagon can follow — the wagon loses its follower status. Current code has no multi-tick border crossing logic:

```ts
// Detect approach to exit tile (range ≤ 1 from border):
const nearExit = creep.pos.x <= 1 || creep.pos.x >= 48
    || creep.pos.y <= 1 || creep.pos.y >= 48;

if (nearExit && train.wagon) {
    // Phase 1 (tug at border): pull wagon to exit tile first
    train.tug.pull(train.wagon);
    train.wagon.move(train.tug); // Wagon follows tug intent
    // Don't let tug cross yet — wait until wagon is also on exit tile
    if (!train.wagon.pos.isEqualTo(exitTile)) return; // Hold tug

    // Phase 2 (both at border): move tug across; wagon pulls through next tick
    // Tug crosses → wagon crosses the tick after via momentum
}
```
This requires 2-3 tick coordinated state (store `trainState: 'crossing' | 'normal'` in tug memory).

---

## 66. WebAssembly Pathfinding (Clockwork / Rust Integration)
**Pathfinding Paper — WASM / Clockwork / Rust Pathfinding**

For 200+ room empires, JavaScript's interpreted nature causes measurable pathfinding CPU overhead due to garbage collection spikes, dynamic typing overhead, and V8's JIT limitations. The current PathFinder is already native C++ — the bottleneck is the **CostMatrix generation** and **traffic reconciliation** that happen in JS around it.

**`screeps-clockwork`** (npm: `screeps-clockwork`) is a Rust-compiled WASM drop-in providing:
- Dijkstra distance maps (O(1) next-hop lookup — the "cache path, not endpoint" pattern)
- BFS floodfill (for parking zone and sector analysis)
- Custom flow field routing (no per-creep A* — entire room solved in one pass)

### Integration Pattern
```ts
// Install: npm install screeps-clockwork (WASM compiled Rust)
import { ClockworkCostMatrix, dijkstra } from 'screeps-clockwork';

// One-time computation: distance map from Storage (all tiles to Storage)
const distMap = dijkstra(storage.pos, (roomName, costMatrix) => {
    // Provide road-weighted CostMatrix (same as existing static matrix)
    return colony.pathingManager.getStaticMatrix(roomName);
});

// heap-cache the distance map (survives ticks, not global resets):
GlobalCache.set(`distMap:${room.name}:storage`, distMap);

// Per-creep movement (O(1), no A* per tick):
const nextPos = distMap.getLowestNeighbor(creep.pos); // Pre-computed
creep.move(creep.pos.getDirectionTo(nextPos));
```

### Performance Comparison
| Approach | CPU per 100 creeps | Path Quality | Memory |
|---|---|---|---|
| Native `moveTo()` | ~50ms | Good | Heap bloat (path arrays) |
| Custom A* (current) | ~15ms | Excellent | Heap (CostMatrix cache) |
| Clockwork Dijkstra flow field | ~2ms | Excellent | Heap (distance map) |
| Clockwork WASM (heavy ops) | ~0.5ms | Equivalent | WASM linear memory |

**Decision gate:** Implement Clockwork for **high-repetition routes only** (storage haulers, mining loops, extension filling). Leave A* PathFinder for low-frequency, irregular paths (military, scouts, pioneers). The WASM/JS boundary adds latency for one-off paths.

> **Current status:** Not started. The codebase would need `screeps-clockwork` added as a dependency and the `TrafficManager` adapted to use flow fields for colony-internal logistics routes. Reference: [Screeps #27 — Optimizing with Rust](https://jonwinsley.com/notes/screeps-clockwork)

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- OBSERVABILITY / DEBUGGING PAPER — Already implemented:                  -->
<!--  ✅ GlobalCache (heap-first, survives tick, lost on global reset)       -->
<!--  ✅ Memory serialization guard (segment usage in §5 RawMemory)         -->
<!--  ✅ Kernel try/catch at top level (partial)                             -->
<!-- New: §67 error logging + circular buffer, §68 Grafana pipeline +       -->
<!--       global reset detection, §69 RoomVisuals debug + profiler         -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 67. Persistent Error Logging and RawMemory Circular Buffer
**Observability Paper — Black Box Logging / Flight Recorder**

Currently, errors are only printed via `console.log()` — they are lost the moment the browser is closed. There is no persistent error store, no stack trace capture, and no log rotation.

### Structured Error Logger (Top-Level Catch)
```ts
// In main.ts — wrap entire loop:
export function loop() {
    try {
        Kernel.run();
    } catch (e: unknown) {
        const err = e as Error;
        const entry = {
            tick: Game.time,
            msg: err.message,
            stack: err.stack ?? 'no stack',
            ctx: 'GlobalLoop'
        };
        // Rotate: keep only 50 most recent errors
        if (!Memory.errors) Memory.errors = [];
        Memory.errors.push(entry);
        if (Memory.errors.length > 50) Memory.errors.shift();
        console.log(`<font color="red">${err.stack}</font>`);
    }
}
```

### RawMemory Circular Buffer (Flight Recorder)
For 6-hour observability, push structured event logs to a RawMemory segment instead of Memory (avoids JSON parse overhead and the 2MB cap):

```ts
// Segment layout: header (JSON) + newline-delimited log JSON
const LOG_SEGMENT = 99;
const MAX_SEGMENT_SIZE = 95_000; // stay under 100KB limit

function appendLog(entry: LogEntry): void {
    RawMemory.setActiveSegments([LOG_SEGMENT]);
    const raw = RawMemory.segments[LOG_SEGMENT] ?? '';
    const line = JSON.stringify(entry) + '\n';
    if ((raw.length + line.length) > MAX_SEGMENT_SIZE) {
        // Circular wrap: drop oldest 20% of content
        RawMemory.segments[LOG_SEGMENT] = raw.slice(raw.length * 0.2) + line;
    } else {
        RawMemory.segments[LOG_SEGMENT] = raw + line;
    }
}

// Usage:
appendLog({ tick: Game.time, level: 'ERROR', msg: 'Miner died', room: 'W5N3' });
appendLog({ tick: Game.time, level: 'WARN', msg: 'CPU bucket < 1000', bucket: Game.cpu.bucket });
```

**Severity tiers:** `ERROR` (exceptions), `WARN` (thresholds crossed), `INFO` (state transitions), `DEBUG` (verbose — disabled in prod). Toggle debug logging via `Memory.debugLevel`.

---

## 68. Grafana/InfluxDB External Telemetry and Global Reset Tracking
**Observability Paper — External Dashboard / Agent Pipeline / Reset Detection**

### Stats Export Schema
Write a `Memory.stats` object every tick (< 0.2 CPU — the agent pulls it via the Screeps API):
```ts
// In Kernel.run(), last step each tick:
Memory.stats = {
    tick:      Game.time,
    cpu:       { used: Game.cpu.getUsed(), bucket: Game.cpu.bucket, limit: Game.cpu.limit },
    gcl:       { level: Game.gcl.level, progress: Game.gcl.progress },
    rooms:     {} as Record<string, RoomStats>,
    market:    { credits: Game.market.credits }
};

for (const colony of Overmind.colonies) {
    Memory.stats.rooms[colony.name] = {
        rcl:        colony.controller.level,
        energy:     colony.storage?.store[RESOURCE_ENERGY] ?? 0,
        energyFlow: colony.state?.netEnergyPerTick ?? 0,
        creepCount: Object.values(colony.creeps).length,
        spawnQueue: colony.hatchery?.spawnQueue.length ?? 0,
        defcon:     colony.defcon
    };
}
```

### Agent Stack (run outside Screeps)
```
Game Script → Memory.stats (written every tick)
    ↓
Screeps API GET /api/user/memory (agent polls every 30s — within 1440/day limit)
    ↓
node-agent (ScreepsPlus/node-agent or custom) → InfluxDB line protocol
    ↓
InfluxDB (time-series store) ← queried by → Grafana (dashboards)
```
Key Grafana panels:
- CPU bucket over time (identifies CPU exhaustion spikes)
- Energy/tick per room (identifies economic collapses)
- Creep population by role (detects "colony death" before it happens)
- DEFCON level per room (reconstructs attack timeline post-mortem)

### Global Reset Detection
```ts
// In main.ts, OUTSIDE the loop() function (runs on VM init only):
if (typeof global.resetTick === 'undefined') {
    global.resetTick = Game.time;
    global.heapWarmedUp = false;
    if (!Memory.globalResets) Memory.globalResets = [];
    Memory.globalResets.push({ tick: Game.time, date: new Date().toISOString() });
    if (Memory.globalResets.length > 20) Memory.globalResets.shift();
    console.log(`[KERNEL] Global reset detected at tick ${Game.time}`);
}

// In Kernel.run():
if (!global.heapWarmedUp) {
    // First tick after reset — re-populate GlobalCache from Memory/RawMemory
    GlobalCache.warmUp(); // Rebuilds CostMatrices, room caches, etc.
    global.heapWarmedUp = true;
}
```
If `Memory.globalResets` shows frequent resets shortly before errors, the `GlobalCache.warmUp()` is the CPU culprit — it's rebuilding all caches cold. Optimize: defer non-critical cache warming to subsequent ticks.

### Game.notify for Critical Thresholds
```ts
// "Fingers-crossed" alerting — only notify on true crises:
if (Game.cpu.bucket < 1000) {
    Game.notify(`CPU bucket critical: ${Game.cpu.bucket} at tick ${Game.time}`, 60); // 60 min cooldown
}
if (colony.controller.ticksToDowngrade < 5000 && colony.controller.level === 8) {
    Game.notify(`RCL8 downgrade risk in ${colony.name}!`, 120);
}
```

---

## 69. RoomVisuals Debug Overlays and Screeps Profiler
**Observability Paper — Visual Debugging / Performance Profiling**

### Debug Overlay System
Toggle debug overlays via `Memory.debugMode = true` (set from browser console):
```ts
// In Kernel.run(), after all logic:
if (Memory.debugMode) {
    for (const colony of Overmind.colonies) {
        const vis = new RoomVisual(colony.name);

        // State labels on all creeps:
        for (const creep of Object.values(colony.creeps)) {
            vis.text(creep.task?.name ?? 'idle', creep.pos, { fontSize: 4, color: '#fff' });
        }

        // Path intent lines (from TrafficManager.pendingMoves):
        for (const [creep, target] of TrafficManager.pendingMoves) {
            vis.line(creep.pos, target, { color: '#0f0', lineStyle: 'dashed', opacity: 0.4 });
        }

        // CostMatrix heatmap (on-demand — expensive, use sparingly):
        if (Memory.debugCostMatrix === colony.name) {
            const matrix = colony.pathingManager.getDynamicMatrix(colony.name);
            for (let y = 0; y < 50; y++) {
                for (let x = 0; x < 50; x++) {
                    const cost = matrix.get(x, y);
                    if (cost > 1) vis.rect(x - 0.5, y - 0.5, 1, 1,
                        { fill: cost >= 255 ? '#f00' : '#fa0', opacity: cost / 255 * 0.6 });
                }
            }
        }
    }
}
```

### RawMemory Visual Snapshots (Rewind Capability)
```ts
// Store a snapshot of key positions when an error occurs:
if (Memory.errors.length > prevErrorCount) {
    const snapshot = {
        tick: Game.time,
        creepPositions: Object.values(Game.creeps).map(c => ({
            name: c.name, x: c.pos.x, y: c.pos.y, room: c.room.name, task: c.memory.task
        }))
    };
    RawMemory.segments[98] = JSON.stringify(snapshot); // Segment 98 = snapshot slot
}
// Player can read Memory.segments[98] after the fact to "see" pre-crash state
```

### CPU Profiler Integration
```ts
// gdborton/screeps-profiler — wraps game classes and reports CPU per function:
// npm install screeps-profiler

import { profiler } from 'screeps-profiler';
profiler.enable();
export function loop() {
    profiler.wrap(() => {
        Kernel.run();
    });
}
// Output: function name, total calls, avg/max CPU per call — formatted as HTML table
// Run for 100-tick windows to identify which Overlord or process is the CPU bottleneck
```

### Public Segment for Alliance Observability
```ts
// Share bot status with allied players (PvP coordination, trade partners):
RawMemory.setPublicSegments([0]); // Segment 0 is public-readable by any player

const publicState = {
    tick: Game.time,
    rooms: Overmind.colonies.map(c => ({
        name: c.name, rcl: c.controller.level, defcon: c.defcon
    })),
    diplomatic: Memory.diplomatic // Trade prices, alliance status, etc.
};
RawMemory.segments[0] = JSON.stringify(publicState);

// Allied player reads our segment:
RawMemory.setActiveForeignSegment('ally_name', 0);
const theirState = JSON.parse(RawMemory.foreignSegment?.data ?? '{}');
```

> **Cross-references:** RawMemory Segments was §5 in original backlog. Stats pipeline uses same Memory.stats written by §20 EmpireLogisticsProcess. GlobalCache warmup is the Kernel init path.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- SYSTEMS RESILIENCE PAPER — Already implemented:                         -->
<!--  ✅ BootstrappingOverlord (exists — spawns pioneers)                    -->
<!--  ✅ Spawn priority (priority 0 for bootstrappers in Hatchery.ts)        -->
<!--  ✅ Spawn Time Governor (briefly in anti-fragile OS conversation)       -->
<!--  ✅ Global Hivemind rescue outline (anti-fragile OS conversation)       -->
<!-- New: §70 conditional morphology selector, MVC math, Hamiltonian        -->
<!--       extension routing, tombstone/ruin recovery priority               -->
<!--  §71 4-layer recovery protocol, Safe Mode auto-trigger, tower priority  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 70. Conditional Morphology Selector and MVC Spawn Logic
**Resilience Paper — Minimum Viable Creep / Pioneer vs Split-Role Math**

The current `BootstrappingOverlord` uses a fixed pioneer body. It does not check for pre-existing energy sources (containers, tombstones, dropped resources) that would change the optimal first spawn.

### Pioneer vs Split-Role: Quantitative Result
At 10 tiles from source, 0 energy in room:

| Strategy | First delivery tick | CPU resilience |
|---|---|---|
| **Pioneer `[W,C,M]`** — spawn at T=200 | T≈210 (ticks to source + harvest + return) | Single creep completes full cycle even if one part dies early |
| **Split-role: miner then hauler** — spawn at T=150+100=250 | T≈260 | Hauler death = no delivery; miner becomes useless |

**Pioneer wins by ~50 ticks** and is CPU-resilient. Exception: if a container exists with energy, a 100-energy hauler `[C,M]` wins by 100 ticks.

### Conditional Morphology Selector (implemented in BootstrappingOverlord)
```ts
function selectBootstrapBody(room: Room): BodyPartConstant[] {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return [WORK, CARRY, MOVE]; // default

    // Priority 1: pre-processed energy exists → spawn lightweight hauler first
    const container = spawn.pos.findInRange(FIND_STRUCTURES, 25, {
        filter: (s): s is StructureContainer =>
            s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
    })[0];
    const tombstone = room.find(FIND_TOMBSTONES)
        .find(t => t.store[RESOURCE_ENERGY] > 0);
    const dropped = room.find(FIND_DROPPED_RESOURCES,
        { filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50 })[0];

    if (container || tombstone || dropped) {
        // 100-energy hauler can drain pre-existing energy instantly
        if (room.energyAvailable >= 100) return [CARRY, MOVE];
    }

    // Priority 2: no pre-existing energy → need harvest+carry loop
    // Spawn at 200 (WORK+CARRY+MOVE), not 300 — don't wait for extensions
    if (room.energyAvailable >= 200) return [WORK, CARRY, MOVE];

    // Still accumulating — don't spawn yet (0-199 is wasted spawn cost)
    return [];
}
```

### Minimum Viable Creep (MVC) — Never Use energyCapacityAvailable
```ts
// WRONG — waits for ALL extensions to fill (impossible in a blackout):
if (room.energyAvailable === room.energyCapacityAvailable) spawnCreep(fullBody);

// CORRECT — spawn smallest viable body using only what's immediately available:
const mvBody = selectBootstrapBody(room);
if (mvBody.length > 0 && room.energyAvailable >= bodyCost(mvBody)) {
    spawn.spawnCreep(mvBody, 'bootstrap_' + Game.time, { memory: { role: 'bootstrap' } });
}
```

### Spawn Time Governor (Body Scaling During Recovery)
Track spawner saturation — the fraction of ticks the spawn is occupied:
```ts
const SATURATION_WINDOW = 100; // ticks
const spawnActiveTicks = GlobalCache.get('spawnActiveTicks') ?? 0;
const saturation = spawnActiveTicks / SATURATION_WINDOW;

// Recovery phase: target 100% saturation with small creeps
// Transition phase: increase body size only when energy is building faster than being consumed
const netEnergyPerTick = colony.state.netEnergyPerTick ?? 0;
const maxBodyCost = netEnergyPerTick > 0
    ? Math.min(300 + netEnergyPerTick * 50, 1500)  // Scale gradually
    : 200; // Cap at pioneer during deficit

// Do NOT spawn a 3000-energy creep as soon as room hits 3000 —
// that creep dying resets progress. Scale gradually.
```

### Extension Fill Order: Hamiltonian Path vs Flood-Fill
Rather than `findClosestByPath` (CPU-intensive, causes "ping-ponging"):
```ts
// Pre-compute optimal fill order once, cache in Memory:
// Hamiltonian path: visit every extension exactly once from the spawn outward
// Store as ordered array of IDs in Memory.rooms[name].extensionFillOrder

// In BootstrappingOverlord, use the cached order:
if (!colony.memory.extensionFillOrder) {
    colony.memory.extensionFillOrder = computeHamiltonianFillOrder(spawn, extensions);
}
// Each tick: find first un-filled extension in pre-computed order:
const target = colony.memory.extensionFillOrder
    .map(id => Game.getObjectById<StructureExtension>(id))
    .find(e => e && e.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
```

---

## 71. 4-Layer Recovery Protocol: Detection, Prioritization, Defense, and Hivemind
**Resilience Paper — CRITICAL_BLACKOUT State Machine / Safe Mode / Global Hivemind**

### Layer 1: Colony Crash Detection (Overseer CRITICAL_BLACKOUT)
```ts
// In Overseer.run(), checked every tick:
const energyRatio = room.energyAvailable / Math.max(room.energyCapacityAvailable, 300);
const popZero = colony.minersAndHaulers.length === 0;
const hasSpawn = room.find(FIND_MY_SPAWNS).length > 0;

if (energyRatio < 0.10 && popZero && hasSpawn) {
    colony.state.defcon = DEFCON.CRITICAL_BLACKOUT;
    // Place BootstrappingDirective — overrides all secondary spawning
    Overmind.directives.place(new BootstrappingDirective(colony.name));
}
```

### Layer 2: Hatchery Priority Override During Blackout
Standard fill order: Extensions → Towers → Labs. During `CRITICAL_BLACKOUT`:
```
Priority 1: STRUCTURE_SPAWN (must always be fillable for MVC spawning)
Priority 2: STRUCTURE_TOWER (if hostiles present — losing bootstrap creep > spawn delay)
Priority 3: STRUCTURE_EXTENSION (to build up spawn capacity)
Priority 4: Everything else — suspended
```
```ts
if (colony.state.defcon === DEFCON.CRITICAL_BLACKOUT) {
    // Refill towers FIRST if enemies are present, BEFORE extensions:
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const fillOrder = hostiles.length > 0
        ? [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_EXTENSION]
        : [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER];
    hatchery.setFillOrder(fillOrder);
}
```

### Layer 3: Safe Mode Auto-Trigger
```ts
// Trigger safe mode when: colony is in blackout AND hostile attackers are present
const hasAttackers = room.find(FIND_HOSTILE_CREEPS, {
    filter: c => c.getActiveBodyparts(ATTACK) > 0
        || c.getActiveBodyparts(RANGED_ATTACK) > 0
        || c.getActiveBodyparts(WORK) > 0  // dismantlers
}).length > 0;

if (colony.state.defcon === DEFCON.CRITICAL_BLACKOUT && hasAttackers) {
    if (room.controller?.activateSafeMode() === OK) {
        appendLog({ tick: Game.time, level: 'WARN', msg: 'Safe mode activated', room: room.name });
        // Conserve: don't trigger again until remaining activations > 1
    }
}
```
Track `Memory.rooms[name].safeModeUses` to distinguish "minor probe" (1 hostile scout) from "wipe" (squad with ATTACK + HEAL). Only activate if `hostiles.length > 1` or any hostile has ATTACK parts.

### Layer 4: Global Hivemind Help Request (Cross-Colony Recovery)
```ts
// In ColonyProcess.run() — crippled colony sets a help flag:
if (colony.state.defcon === DEFCON.CRITICAL_BLACKOUT) {
    Memory.hivemind.helpRequests[colony.name] = {
        tick: Game.time,
        energyNeeded: colony.room.energyCapacityAvailable,
        pos: colony.room.find(FIND_MY_SPAWNS)[0]?.pos
    };
}

// In healthy neighboring colonies (within 3 rooms):
for (const [targetRoom, request] of Object.entries(Memory.hivemind.helpRequests)) {
    if (Game.time - request.tick > 500) { delete Memory.hivemind.helpRequests[targetRoom]; continue; }
    if (Game.map.getRoomLinearDistance(colony.name, targetRoom) <= 3) {
        // Spawn a large transporter and send it to targetRoom spawn
        colony.hatchery.requestCreep({
            body: [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE],
            // = 8 CARRY (400 energy) + 4 MOVE — can fully refill an RCL 3 hatchery in 1 trip
            memory: { role: 'hivemindRescue', targetRoom, dropOff: request.pos }
        });
    }
}
```

> **Cross-references:** BootstrappingOverlord body logic feeds into §6c (pioneer waves during ColonizeDirective). Safe Mode guard aligns with §60 GuardDirective. Global Hivemind uses same inter-colony Memory schema as §20 EmpireLogisticsProcess.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- EARLY-GAME LOGISTICS PAPER — Already implemented:                       -->
<!--  ✅ Gale-Shapley matching in LogisticsNetwork.ts (confirmed)            -->
<!--  ✅ Effective Store ledger (§61 predictive request amount)              -->
<!--  ✅ TrafficManager recursive shoving / bipartite matching               -->
<!--  ✅ Drop mining (§55 — container vs drop mining ROI)                    -->
<!--  ✅ Heap-first GlobalCache                                               -->
<!-- New: §72 RCL1 metabolic stabilization, Mobile Container pattern        -->
<!--  §73 mobile creep requesters in LogisticsNetwork, predictive requesting -->
<!--      static sink anchoring, AWAITING_SUPPLY FSM state                  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 72. RCL 1 Metabolic Stabilization and Mobile Container Pattern
**Early-Game Logistics Paper — Pioneer Economy / Hauler-to-Worker Direct Delivery**

### RCL 1: Pioneer Economy Math
At RCL 1 (300 energy cap), the optimal body is `[WORK×2, CARRY, MOVE]` = 250 energy:
- 2 WORK = 2 E/tick harvest; CARRY = 50 capacity; MOVE = 1 tile/tick (empty), 0.5 (full)

**Metabolic stabilization protocol — first 2 pioneers:**
```ts
// Pioneers 1 & 2: FORCE spawn refill until 250-energy buffer exists.
// Do NOT upgrade controller until spawn is stable:
if (creep.memory.pioneerId <= 2) {
    if (colony.room.energyAvailable < 250) {
        // Transfer to spawn before any other action
        const spawn = creep.pos.findInRange(FIND_MY_SPAWNS, 1)[0];
        if (spawn) { creep.transfer(spawn, RESOURCE_ENERGY); return; }
    }
}
// Only after buffer is established do pioneers start upgrading.
// Controller saturation at 10 E/tick requires: 10 / (harvest rate per pioneer)
// = 10 / (2 WORK × 1 E/tick × duty_cycle ≈ 0.7) → ~7 pioneers for full saturation
```

**Pioneer count for controller saturation:** 6-7 pioneers (6.5 rounded). Each 250E pioneer with 2 WORK parts processes ~1.4 E/tick net (accounting for travel). 10 E/tick source ÷ 1.4 = 7.1.

### Drop Mining Decay Math (RCL 2 before containers)
```
Decay rate: floor(energy_on_ground / 1000) energy per tick
At full source output (10 E/tick dropped):
  pile builds to ~500 E before hauler arrives → decay ≈ 0 at <1000 E
  pile reaches 1000 E if hauler is delayed → decay = 1 E/tick (10% tax)
```
Maximize hauler cycle speed to keep pile below 1,000 E. Once container is built, decay replaced by 50 HP/tick container decay = 0.1 E/tick repair cost (5× cheaper than ground decay).

### Mobile Container Pattern (RCL 2: No Storage, Extensions Full)
When spawn + extensions are full (550 energy at RCL 2) and no storage exists, idle haulers carry full loads with no valid structural target. Workers drain energy and walk 30+ ticks to source containers.

**Solution:** redirect idle full haulers to push energy directly to workers:
```ts
// In TransporterOverlord.run() — after structural fill targets exhausted:
if (hauler.carry.energy > 0 && structuralTargets.length === 0) {
    // Expand target search to include mobile workers:
    const workers = colony.room.find(FIND_MY_CREEPS, {
        filter: c => (c.memory.role === 'builder' || c.memory.role === 'upgrader')
            && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (workers.length > 0) {
        // Sort by largest energy deficit (most urgent first):
        workers.sort((a, b) =>
            b.store.getFreeCapacity(RESOURCE_ENERGY) - a.store.getFreeCapacity(RESOURCE_ENERGY)
        );
        const target = workers[0];
        if (hauler.pos.isNearTo(target)) {
            hauler.transfer(target, RESOURCE_ENERGY);
        } else {
            hauler.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
        }
    }
}
```
> **CPU note:** multiple haulers independently searching `FIND_MY_CREEPS` is O(N²). Acceptable at RCL 2 (< 10 creeps). Replace with Logistics Broker integration at RCL 4+.

---

## 73. Mobile Creep Requesters in LogisticsNetwork (Broker Integration)
**Early-Game Logistics Paper — Extending Gale-Shapley to Mobile Workers**

### The "Last Mile" Problem
Current `LogisticsNetwork.ts` only accepts `StoreStructure` objects as requesters. Workers that run out of energy during construction walk to source containers (30+ tile round trips = ~60 tick duty cycle loss per fill). The fix: extend the broker to accept `Creep` objects as mobile requesters.

### Extending LogisticsTarget to Accept Creeps
```ts
// In LogisticsNetwork.ts:
type LogisticsTarget = StoreStructure | Creep;  // Add Creep as valid target

function getTargetCapacity(target: LogisticsTarget): number {
    if (target instanceof Creep) return target.store.getFreeCapacity(RESOURCE_ENERGY);
    return target.store.getFreeCapacity(RESOURCE_ENERGY);
}

function getTargetPos(target: LogisticsTarget): RoomPosition {
    return target.pos; // Works for both Creep and Structure
}
```

### AWAITING_SUPPLY FSM State (Worker Side)
Workers register requests instead of autonomously fetching energy:
```ts
// In builder/upgrader FSM:
const PREDICTIVE_THRESHOLD = consumeRate * (nearestHaulerDistance + 5);
// Example: 5 E/tick consumption, hauler 10 tiles away → register at 55 energy

if (creep.store[RESOURCE_ENERGY] < PREDICTIVE_THRESHOLD
    && !creep.memory.supplyRequestActive) {

    // Register with broker — halt movement to become a static sink
    colony.logistics.registerRequest({
        id: creep.id,
        pos: creep.pos,
        amount: creep.store.getFreeCapacity(RESOURCE_ENERGY),
        priority: getSitePriority(creep.memory.targetSite), // Tower > Extension > Road
        type: 'creep'
    });
    creep.memory.supplyRequestActive = true;
    creep.memory.supplyAnchorPos = { x: creep.pos.x, y: creep.pos.y };
    // CRITICAL: stop moving — become a mathematically static target for path caching
}

// While supply request is active: build only, do NOT move
if (creep.memory.supplyRequestActive) {
    creep.build(Game.getObjectById(creep.memory.targetSite)!);
    return; // Skip moveTo — wait for hauler delivery
}
```

### Effective Store for In-Flight Reservations
```ts
// In LogisticsNetwork.requestTask():
// When a hauler is matched to a creep requester, immediately mark energy as "in-flight":
effectiveStore[creep.id] = (effectiveStore[creep.id] ?? 0) + hauler.store[RESOURCE_ENERGY];

// On subsequent matching iterations this tick:
const creepDeficit = creep.store.getFreeCapacity(RESOURCE_ENERGY)
    - (effectiveStore[creep.id] ?? 0);
if (creepDeficit <= 0) continue; // Already served — skip this requester
```
This prevents two haulers from racing to the same builder (the core "energy racing" problem).

### Static Sink Path Caching (Hauler Side)
Because the worker is now stationary during delivery:
```ts
// In hauler task — target is a static RoomPosition (not a moving creep):
const cachedPath = GlobalCache.get(`path:${hauler.name}:${creep.id}`);
if (cachedPath) {
    // Follow cached direction string — 0 CPU pathfinding cost per tick
    hauler.move(cachedPath[hauler.memory.pathIndex++ % cachedPath.length]);
} else {
    const result = PathFinder.search(hauler.pos, { pos: creep.pos, range: 1 });
    GlobalCache.set(`path:${hauler.name}:${creep.id}`, result.path);
}
// On arrival:
if (hauler.pos.isNearTo(creep.pos)) {
    hauler.transfer(creep, RESOURCE_ENERGY);
    GlobalCache.delete(`path:${hauler.name}:${creep.id}`); // Invalidate cached path
    creep.memory.supplyRequestActive = false; // Release anchor
}
```

> **Cross-references:** LogisticsNetwork.ts Gale-Shapley matching (existing). Effective Store ledger first described in §61 (predictive request amount). Static sink anchoring synergizes with §65 temporal stuck detection (anchored worker should not be flagged as stuck). Priority scores align with MovePriority.ts (§app).

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- OVERSEER-OVERLORD PARADIGM PAPER — Already implemented:                 -->
<!--  ✅ Overmind singleton, Colony, Overlord, Directive, Zerg wrappers      -->
<!--  ✅ Kernel init/run/suspend lifecycle                                    -->
<!--  ✅ LogisticsNetwork (Gale-Shapley), TrafficManager, HiveCluster        -->
<!--  ✅ ExpansionPlanner, Strategist, RoomScorer                            -->
<!--  ✅ CombatOverlord, GuardDirective, DefenseOverlord                     -->
<!-- New: §74 build/refresh duality, prespawn formula, $ caching, bucket    -->
<!--       limiter, intent grouping, directive color coding                  -->
<!--  §75 SwarmOverlord synchronization (swarmWishlist, pivot),             -->
<!--       Assimilator sha256 checksum verification protocol                 -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 74. Build/Refresh Duality, Prespawn Formula, $ Caching, and Bucket Limiter
**Overseer-Overlord Paper — Lifecycle Optimization / CPU Management**

### Build vs. Refresh Duality (40% CPU Reduction)
Re-instantiating all class instances every tick is prohibitively expensive for V8's garbage collector. The standard Overmind lifecycle:
```ts
// In Kernel.run():
const REBUILD_INTERVAL = 20; // Full rebuild every 20 ticks (or on global reset)

if (Game.time % REBUILD_INTERVAL === 0 || isGlobalReset()) {
    Overmind.build();   // Full constructor calls: creates Colonies, HiveClusters, Overlords, Directives
} else {
    Overmind.refresh(); // Lightweight: only updates .room, .creeps, .structures references
                        // Keeps existing class instances alive — no garbage collection spike
}
Overmind.init();  // Register spawning requests, logistics inputs/outputs (every tick)
Overmind.run();   // Execute state-changing actions (every tick)
```
**The key insight:** game object *references* (`creep.pos`, `structure.hits`) change every tick, but the *class instances* wrapping them don't need to be reconstructed. `refresh()` walks existing instances and updates their internal pointers — O(N) instead of O(N × constructor cost).

### Prespawn Formula (Zero-Downtime Replacement)
```ts
// In Overlord.lifetimeFilter():
// Spawn replacement exactly when current creep has (spawnTicks + travelTicks) left:
const spawnTicks = body.length * CREEP_SPAWN_TIME; // 3 ticks per body part
const travelTicks = PathFinder.search(spawn.pos, { pos: task.pos, range: 1 }).path.length;
const prespawnBuffer = spawnTicks + travelTicks;

// Filter out creeps that still have enough time:
const activeCreeps = overlord.zerg.filter(z => z.ticksToLive > prespawnBuffer);
// If activeCreeps.length < targetCount → wishlist a replacement NOW
```
Cache `travelTicks` in `colony.memory.sourcePaths[sourceId]` — don't PathFinder.search() every tick.

### $ Caching Module (Memoize Room Scans)
```ts
// Custom caching module: memoizes expensive room queries per tick
const $ = {
    _cache: new Map<string, { tick: number; value: any }>(),

    get<T>(key: string, compute: () => T): T {
        const entry = this._cache.get(key);
        if (entry && entry.tick === Game.time) return entry.value as T;
        const value = compute();
        this._cache.set(key, { tick: Game.time, value });
        return value;
    }
};

// Usage (called N times across overlords but computed once):
const hostiles = $.get(`hostiles:${room.name}`, () => room.find(FIND_HOSTILE_CREEPS));
const structures = $.get(`structures:${room.name}`, () => room.find(FIND_STRUCTURES));
const myCreeps = $.get(`creeps:${room.name}`, () => room.find(FIND_MY_CREEPS));
```
Also used for `$.refreshRoom()` — updates cached structure HP / store values without re-scanning.

### Intent Grouping (0.2 CPU per Successful Intent)
Each successful `transfer()`, `harvest()`, `build()`, or `attack()` costs 0.2 CPU. Failed intents (e.g., `ERR_NOT_IN_RANGE`) cost ~0.05 CPU. **Don't call intents unless they'll succeed:**
```ts
// BAD: calls transfer() even when creep is full, wasting 0.2 CPU:
creep.transfer(spawn, RESOURCE_ENERGY);

// GOOD: gate on preconditions to avoid wasted API calls:
if (creep.store[RESOURCE_ENERGY] > 0 && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    && creep.pos.isNearTo(spawn)) {
    creep.transfer(spawn, RESOURCE_ENERGY);
}
```

### Bucket Limiter (CPU Exhaustion Protection)
```ts
// In Kernel.run(), before Overmind.run():
const bucket = Game.cpu.bucket;

if (bucket < 500) {
    // CRITICAL: suspend everything except spawn refilling and basic defense
    colony.overlords.filter(o => o.priority > PRIORITY.CRITICAL).forEach(o => o.suspend());
    console.log(`[KERNEL] Bucket critically low (${bucket}), suspending non-essential overlords`);
    return;
}

if (bucket < 2000) {
    // LOW: suspend upgrading and scouting
    colony.overlords
        .filter(o => o.priority >= PRIORITY.LOW) // upgraders, scouts
        .forEach(o => o.suspend());
}
// Otherwise: full execution
```
Suspended overlords skip their `init()` and `run()` calls but remain instantiated (no rebuild cost).

### Directive Color Coding System
Standardize flag color combinations for O(1) directive type lookup:
```ts
const DIRECTIVE_COLORS = {
    ATTACK:    { color: COLOR_RED,    secondaryColor: COLOR_RED },
    DISMANTLE: { color: COLOR_RED,    secondaryColor: COLOR_PURPLE },
    GUARD:     { color: COLOR_BLUE,   secondaryColor: COLOR_BLUE },
    DEFENSE:   { color: COLOR_BLUE,   secondaryColor: COLOR_PURPLE },
    HAUL:      { color: COLOR_YELLOW, secondaryColor: COLOR_YELLOW },
    LINK:      { color: COLOR_YELLOW, secondaryColor: COLOR_BLUE },
    ABANDON:   { color: COLOR_BROWN,  secondaryColor: COLOR_RED },
    REBUILD:   { color: COLOR_BROWN,  secondaryColor: COLOR_YELLOW },
};
// On flag placement: Overseer calls Game.flags.filter by color pair → O(1) type resolution
```

---

## 75. SwarmOverlord Synchronization and Assimilator Verification
**Overseer-Overlord Paper — Swarm Combat / Multi-Player Collective Intelligence**

### SwarmOverlord: Preventing Trickle Attacks
Uncoordinated attackers entering one-by-one are easily killed by towers. The `SwarmOverlord` enforces synchronous spawn completion:
```ts
class SwarmOverlord extends CombatOverlord {
    swarmWishlist(): void {
        // Don't request individual creeps — request the entire squad atomically:
        const squadReady = this.zerg.length >= this.requiredCount
            && this.zerg.every(z => z.ticksToLive > this.estimatedTravelTime);

        if (!squadReady) {
            // Hold at staging room — do NOT enter target room until squad is complete
            this.zerg.forEach(z => z.travelTo(this.stagingPos, { range: 5 }));
            return;
        }
        // Squad assembled — move as formation
        this.executeFormationMove();
    }

    pivot(direction: DirectionConstant): void {
        // Rotate entire formation in-place without breaking spatial integrity:
        // Each member moves to the position previously held by its clockwise neighbor
        const positions = this.zerg.map(z => z.pos);
        this.zerg.forEach((z, i) => z.travelTo(positions[(i + 1) % positions.length]));
    }
}
```

### Assimilator Verification Protocol (sha256 + Heartbeat)
The Assimilator allows multiple players running identical codebases to cooperate. To prevent modified-code exploitation:
```ts
// Step 1: @assimilationLocked decorator marks critical functions
@assimilationLocked
class Overmind {
    // sha256 checksum computed at build time from all @assimilationLocked function bodies
    static readonly codeHash: string = COMPUTED_AT_BUILD_TIME;
}

// Step 2: Every 1000 ticks, assimilated player sends heartbeat:
if (Game.time % 1000 === 0 && isAssimilatedPlayer) {
    const masterTerminal = Game.getObjectById<StructureTerminal>(MASTER_TERMINAL_ID);
    if (masterTerminal) {
        masterTerminal.send(RESOURCE_ENERGY, 100, masterroom, Overmind.codeHash);
        // Transaction description = current codeHash
    }
}

// Step 3: Master Overmind reads terminal transaction history:
const transactions = Game.market.incomingTransactions
    .filter(t => t.to === masterroom && t.description);
for (const t of transactions) {
    const trusted = MASTER_LEDGER.includes(t.description); // sha256 whitelist
    if (!trusted) {
        revokeClearance(t.from); // Remove cooperative directives for untrusted hash
    }
}
```
This creates a **verifiable automated union**: cooperative territory sharing, cross-player logistics, and military coordination — only available to players running verified, unmodified code.

> **Cross-references:** build/refresh duality extends §68 global reset detection (warmUp is only called in build phase). Bucket limiter is the formal spec for what §20 CPU-guard logic does. SwarmOverlord.pivot() is the formation rotation referenced in §26 siege/quad tactics. Directive color table is the systematic spec for all Directives in §59-62.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- RCL 3/4 ARCHITECTURE PAPER — Already implemented:                       -->
<!--  ✅ Static miners, haulers, tower refilling (existing overlords)         -->
<!--  ✅ ConstructionOverlord, WorkerOverlord, UpgradingOverlord             -->
<!--  ✅ DefenseOverlord with heavy invader escalation (RCL Gaps conv.)      -->
<!--  ✅ RoomScorer, ExpansionPlanner, ColonizeDirective                     -->
<!--  ✅ Distance Transform + Floodfill (BunkerLayout, ParkingZones)         -->
<!-- New: §76 storage push→pull transition, tower damage falloff math,       -->
<!--       rampart decay thresholds & tiered repair, kernel priority table   -->
<!--  §77 RCL4 heavy invader full spec, 3-phase colonial bootstrap protocol  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 76. Storage Push→Pull Transition, Tower Falloff, and Tiered Rampart Repair
**RCL 3/4 Paper — Economic Pivot / Defensive Infrastructure Math**

### Storage: Push-Based → Pull-Based Logistics
```
RCL 1-3 (Push): Miners fill containers → haulers must find structural sinks immediately
  Problem: when spawn+extensions full, haulers idle with full loads → drop mining decay
  
RCL 4+ (Pull): Miners → containers → storage (buffered hub)
  All workers pull from Storage as single source of truth
  Result: 1,000,000-unit buffer absorbs income spikes, smooths economy
  CPU win: workers call one getObjectById(storageId) instead of room.find(FIND_STRUCTURES)
```
```ts
// Logistics reconfiguration at RCL 4 storage construction:
if (colony.storage && colony.storage.isActive()) {
    // Update all hauler tasks: target = storage instead of spawn/extensions
    colony.logistics.setPrimaryHub(colony.storage);

    // Workers: pull from storage, not containers
    colony.workers.forEach(w => w.memory.energySource = colony.storage!.id);

    // Storage fill order for new construction:
    hatchery.setFillSource(colony.storage); // Extensions filled from storage, not containers
}
```

### Tower Damage Falloff (Placement Math)
Tower damage is **not constant** — it falls off linearly with distance:

| Range | Damage/tick | Heal/tick | Repair HP/tick |
|---|---|---|---|
| ≤ 5 tiles | 600 | 400 | 800 |
| 5-20 tiles | Linear interpolation | Linear | Linear |
| ≥ 20 tiles | 150 (minimum) | 100 | 200 |

```ts
function getTowerDamageAt(tower: StructureTower, target: RoomPosition): number {
    const range = tower.pos.getRangeTo(target);
    if (range <= TOWER_OPTIMAL_RANGE) return TOWER_POWER_ATTACK; // 600
    if (range >= TOWER_FALLOFF_RANGE) return TOWER_POWER_ATTACK - TOWER_FALLOFF; // 150
    // Linear interpolation:
    const falloffRatio = (range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
    return Math.floor(TOWER_POWER_ATTACK - TOWER_FALLOFF * falloffRatio);
}
// Tower placement: maximize coverage of room exits within 10 tiles
// A tower at the core (25,25) averages ~375 DPS to any edge tile — suboptimal
// Preferred: 2 towers at opposite quadrants, each covering their nearest exit
```

### Rampart HP Thresholds by RCL
| RCL | Rampart max HP | Decay rate | Repair cost |
|---|---|---|---|
| 2 | 300,000 | 300 HP / 100 ticks | 3 E / 100 ticks |
| 3 | 1,000,000 | 300 HP / 100 ticks | 3 E / 100 ticks |
| 4 | 3,000,000 | 300 HP / 100 ticks | 3 E / 100 ticks |
| 8 | 300,000,000 | 300 HP / 100 ticks | 3 E / 100 ticks |

Rampart maintenance is cheap (3 E / 100 ticks ≈ 0.03 E/tick per rampart) but must be continuous — a rampart dropped to 0 HP disappears, removing cover for internal structures.

### Tiered Repair Prioritization (No "Sitting" on Single Wall)
```ts
// WorkerOverlord repair logic — tiered minimum-then-scale approach:
function getRepairTarget(room: Room, storageEnergy: number): Structure | null {
    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART
    }) as StructureRampart[];

    // Tier 1: emergency — any rampart below 10k HP (about to disappear):
    const dying = ramparts.find(r => r.hits < 10_000);
    if (dying) return dying;

    // Tier 2: minimum threshold — bring all ramparts to 50k before raising target:
    const atMinimum = ramparts.find(r => r.hits < 50_000);
    if (atMinimum) return atMinimum;

    // Tier 3: incremental scale — raise target based on storage buffer:
    // Target HP grows 10k per 100k energy in storage:
    const targetHP = Math.min(50_000 + Math.floor(storageEnergy / 100_000) * 10_000,
        RAMPART_HITS_MAX[room.controller!.level]);
    return ramparts.find(r => r.hits < targetHP) ?? null;
    // Gate: only repair above Tier 2 when storage > 100,000 E
}
```

> **Only authorize rampart fortification above minimum threshold when `storage.store[RESOURCE_ENERGY] > 100,000`** — scaling walls is a low-priority sink that must never drain the economic buffer.

---

## 77. RCL 4 Heavy Invader Escalation and 3-Phase Colonial Bootstrap
**RCL 3/4 Paper — DefenseOverlord Heavy Invader Logic / ColonizeDirective Bootstrap**

### RCL 4 Heavy Invader Full Specification
At ~100,000 total energy harvested per room, invaders spawn. At RCL 4+, they upgrade to "Heavy" classification:

| Property | RCL 3 (Light) | RCL 4+ (Heavy) |
|---|---|---|
| Squad size | 1 | 2-5 |
| Max healing | ~50 HPT | up to 600 HPT (healer body) |
| Behavior | Aggressive, simple | Kiting, squad cohesion |
| Tower defeat | 1 tower at range ≤ 10 | May negate full tower output |

```ts
// In DefenseOverlord — heavy invader escalation response:
const invaders = room.find(FIND_HOSTILE_CREEPS);
const hasHealers = invaders.some(c => c.getActiveBodyparts(HEAL) > 0);
const invaderHPT = invaders.reduce((sum, c) =>
    sum + c.getActiveBodyparts(HEAL) * HEAL_POWER, 0);
const towerDPT = towers.reduce((sum, t) =>
    sum + getTowerDamageAt(t, invaders[0]?.pos ?? room.getPositionAt(25,25)!), 0);

// HOLD FIRE if healer negates tower (already in §60 tower hold-fire logic)
// ESCALATE: spawn active defenders if heavy squad detected:
if (hasHealers && invaderHPT >= towerDPT * 0.5) {
    // Solo healer can almost negate tower — need active melee
    this.requestCreep(DEFENDER_CONFIGS.GUARD);      // ATTACK×20, MOVE×20
}
if (invaderHPT >= towerDPT) {
    // Full negation — need ranged kiter + healer support
    this.requestCreep(DEFENDER_CONFIGS.KITER);      // RANGED×15, MOVE×15
    this.requestCreep(DEFENDER_CONFIGS.HEALER_SUP); // HEAL×10, MOVE×10
}

// Targeting priority: Healers first, then Ranged, then Melee
const primaryTarget = invaders.sort((a, b) => {
    const priority = (c: Creep) =>
        c.getActiveBodyparts(HEAL) > 0 ? 0 :
        c.getActiveBodyparts(RANGED_ATTACK) > 0 ? 1 : 2;
    return priority(a) - priority(b);
})[0];
towers.forEach(t => t.attack(primaryTarget));
```

### 3-Phase Colonial Bootstrap Protocol (ColonizeDirective)
When `DirectiveClaim` succeeds, the new colony transitions through 3 phases:

```
Phase 1 — SUPPORT (tick 0 → first spawn constructed):
  Parent colony spawns and sends:
  • Lawyer (Claimer):  [CLAIM, MOVE×25]      — claim/reserve controller
  • Engineer (Builder): [WORK×5, CARRY×5, MOVE×5] — build first spawn
  • Paralegal (Upgrader): [WORK×3, CARRY×2, MOVE×3] — prevent downgrade
  New room harvests directly from sources (no haulers yet — no energy pipeline to disrupt)
  Parent colony: no energy drawback as long as buffer > 200k

Phase 2 — TRANSITION (first spawn → storage constructed):
  New room self-spawns small pioneers from its own spawn
  Parent colony still sends Engineers to build containers, extensions, storage CS
  Energy gate: parent stops sending workers when new room storage > 0 (self-sufficient)

Phase 3 — AUTONOMY (storage built → colony fully independent):
  New ColonyProcess registered in Kernel
  LogisticsNetwork activated for new room
  Parent colony withdraws all support overlords
  Strategist marks new room as ACTIVE in empire memory
```

```ts
// In ColonizeDirective — phase detection:
const targetRoom = Game.rooms[this.targetRoomName];
const colonyPhase =
    !targetRoom?.find(FIND_MY_SPAWNS).length ? 'SUPPORT' :
    !targetRoom?.storage ? 'TRANSITION' :
    'AUTONOMY';

if (colonyPhase === 'SUPPORT') {
    parentColony.hatchery.requestCreep(COLONIST_CONFIGS.LAWYER);
    parentColony.hatchery.requestCreep(COLONIST_CONFIGS.ENGINEER);
    parentColony.hatchery.requestCreep(COLONIST_CONFIGS.PARALEGAL);
} else if (colonyPhase === 'AUTONOMY') {
    this.remove(); // Directive fulfilled — remove flag
}
```

> **Cross-references:** Tower hold-fire logic fully specified in §60 (GuardDirective). Remote mining energy gate (§d428 conversation) prevents Phase 1 SUPPORT from draining parent below 50k. Expansion criteria (two-source rooms, low swamp) documented in §20 ExpansionPlanner. Tiered repair thresholds complement §45 build order priority 6 (rampart construction before fortification).

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- INVADERCORE PAPER — Already implemented:                                 -->
<!--  ✅ ScoutOverlord (passive vision for remote rooms)                     -->
<!--  ✅ RemoteMiningOverlord (energy gate when storage low)                 -->
<!--  ✅ DefenseOverlord (invader response)                                  -->
<!-- New: §78 InvaderCore detection, stronghold taxonomy, Cleaner body,     -->
<!--       dismantle() failure on cores, damage reflection math              -->
<!--  §79 3-state Cleaner FSM, invaderGoal predictive dispatch,             -->
<!--       JIT spawning, ruin looting hauler phase                           -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 78. InvaderCore Detection, Stronghold Taxonomy, and Cleaner Body Design
**InvaderCore Paper — Territorial Denial / Remote Room Defense**

### The Silent Shutdown Problem
When a Level 0 `StructureInvaderCore` ("Lesser Core") appears in a remote harvesting room, it aggressively reservations the neutral controller, blocking player reservation. Sources in a reserved room produce 3,000 energy/300 ticks; in a neutral or NPC-reserved room they produce only 1,500. An undetected core halts 6,000 energy per 300 ticks per two-source room. Over 24h (~28,800 ticks) = **576,000 energy lost silently.**

### NPC Stronghold Levels and Damage Reflection
| Level | Core HP | Damage Reflection | Defense |
|---|---|---|---|
| 0 (Lesser Core) | 100,000 | 20% | None |
| 1 | 200,000 | 30% | 1 Tower, weak ramparts |
| 2 | 500,000 | 40% | 2 Towers, melee defenders (6t respawn) |
| 3 | 1,000,000 | 50% | 3 Towers, 50-part defenders (3t respawn) |
| 4 | 2,000,000 | 75% | 4 Towers, boosted defenders (2t respawn) |
| 5 | 5,000,000 | 95% | 6 Towers, expert defenders (1t respawn) |

Reflection applies to all damage types. `WORK`/`dismantle()` returns `ERR_INVALID_TARGET` on `StructureInvaderCore` — **cannot be dismantled.** Only `attack()` works on the core itself. WORK parts are still essential for clearing blocking walls/ramparts that surround the core.

### Detection Protocol (Controller Reservation Cache)
```ts
// In ScoutOverlord / RemoteMiningOverlord:
// Update reservation status whenever room is visible:
if (Game.rooms[remoteRoom]) {
    const ctrl = Game.rooms[remoteRoom].controller;
    if (ctrl) {
        Memory.remoteMining[remoteRoom].reservation = {
            username: ctrl.reservation?.username ?? null,
            ticksToEnd: ctrl.reservation?.ticksToEnd ?? 0,
            lastSeen: Game.time
        };
        // Detect core directly when room is visible:
        const core = Game.rooms[remoteRoom].find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_INVADER_CORE
        })[0] as StructureInvaderCore | undefined;
        if (core) {
            Memory.remoteMining[remoteRoom].invaderCore = { id: core.id, hits: core.hits };
        } else {
            delete Memory.remoteMining[remoteRoom].invaderCore;
        }
    }
}

// Check cached reservation status (works even when room is invisible):
if (Memory.remoteMining[remoteRoom].reservation?.username === 'Invader') {
    // Core present — suspend miner/hauler spawning for this room:
    colony.remoteMining.suspendRoom(remoteRoom);
    // Dispatch Cleaner:
    colony.hatchery.requestCreep(CLEANER_CONFIG, remoteRoom);
}
```

### Cleaner Body Design (Level 0/1 Core)
Self-healing is mandatory: 10 ATTACK parts deal 300 dmg/tick → 20% reflection = 60 dmg/tick taken. Must heal ≥ 60 HP/tick. 5 HEAL parts = 60 HP/tick at melee range — exactly sufficient:
```
MOVE×20, ATTACK×10, WORK×5, HEAL×5  (total 40 parts, cost = 20×50 + 10×80 + 5×100 + 5×250)
= 1000 + 800 + 500 + 1250 = 3,550 energy
```
- **MOVE×20**: 1:1 ratio (20 non-MOVE parts) → 1 tile/tick on plains
- **ATTACK×10**: 300 dmg/tick to core
- **WORK×5**: 250 dmg/tick to blocking walls/ramparts via `dismantle()`
- **HEAL×5**: 60 HP/tick melee self-heal → cancels Level 0 reflection exactly

For **Level 2+ cores** (40% reflection), scale to HEAL×8+: 300 × 0.40 = 120 HP/tick needed.

---

## 79. Cleaner FSM, invaderGoal Predictive Dispatch, and Ruin Looting
**InvaderCore Paper — State Machine / JIT Spawning / Loot Recovery**

### 3-State Cleaner FSM
```ts
const CleanerState = {
    TRAVEL: 'TRAVEL',     // Inter-room movement to target room
    CLEAR:  'CLEAR',      // Dismantling blocking walls/ramparts
    ATTACK: 'ATTACK',     // Core attack + self-heal loop
};

// In CleanerOverlord.run():
switch (cleaner.memory.state) {

    case CleanerState.TRAVEL:
        cleaner.travelTo(new RoomPosition(25, 25, targetRoom), { maxRooms: 16 });
        if (cleaner.room.name === targetRoom) cleaner.memory.state = CleanerState.CLEAR;
        break;

    case CleanerState.CLEAR: {
        const core = Game.getObjectById<StructureInvaderCore>(coreId);
        if (!core) { cleaner.memory.state = CleanerState.TRAVEL; break; } // Room went dark
        // Check if path to core is blocked:
        const pathResult = PathFinder.search(cleaner.pos, { pos: core.pos, range: 1 },
            { ignoreDestructibleStructures: true });
        const blockingStructure = cleaner.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
        })[0];
        if (blockingStructure) {
            cleaner.dismantle(blockingStructure); // WORK parts clear the path
        } else {
            cleaner.memory.state = CleanerState.ATTACK; // Path clear
        }
        break;
    }

    case CleanerState.ATTACK: {
        const core = Game.getObjectById<StructureInvaderCore>(coreId);
        if (!core) {
            // Core destroyed — transition to loot/recycle
            delete Memory.remoteMining[targetRoom].invaderCore;
            colony.remoteMining.resumeRoom(targetRoom);
            cleaner.memory.state = 'DONE';
            break;
        }
        // Self-heal if below 90% HP (pre-heal buffer for reflection):
        if (cleaner.hits < cleaner.hitsMax * 0.9) {
            cleaner.heal(cleaner); // 60 HP/tick melee
        }
        if (cleaner.pos.isNearTo(core)) {
            cleaner.attack(core); // 300 dmg/tick — cannot call attack() AND heal() on same target
        } else {
            cleaner.moveTo(core);
        }
        break;
    }
}
```

### invaderGoal Predictive Defense
```ts
// Track total energy harvested per remote room:
// (update each tick miners successfully harvest)
Memory.remoteMining[roomName].totalHarvested =
    (Memory.remoteMining[roomName].totalHarvested ?? 0) + harvestAmount;

// Invader spawns approximately every 100,000 energy harvested:
const INVADER_GOAL = 100_000;
const harvested = Memory.remoteMining[roomName].totalHarvested % INVADER_GOAL;
const ticksUntilInvasion = (INVADER_GOAL - harvested) / 10; // ~10 E/tick from one source

if (ticksUntilInvasion < 500 && !Memory.remoteMining[roomName].guardDispatched) {
    // Pre-emptively dispatch a guard before the invasion occurs:
    colony.hatchery.requestCreep(GUARD_CONFIG, roomName);
    Memory.remoteMining[roomName].guardDispatched = true;
}
// Reset guardDispatched after invasion event (when invaders are detected + killed)
```

### JIT Spawning on Core Detection
Rather than maintaining a standing cleaner army:
```ts
// Triggered ONLY when reservation.username === 'Invader':
// The cleaner's ObjectiveId is tied to the core's id — auto-retires when core gone:
if (!activeCleaners.some(c => c.memory.objectiveId === coreId)) {
    colony.hatchery.requestCreep({
        ...CLEANER_CONFIG,
        memory: {
            role: 'cleaner',
            objectiveId: coreId,   // Ties lifecycle to specific core
            targetRoom: roomName,
            state: CleanerState.TRAVEL
        }
    });
}
// If cleaner dies before core is destroyed: re-trigger detection → re-spawn next tick
```

### Ruin Looting (Hauler Phase)
When core is destroyed, ruins persist for `EFFECT_COLLAPSE_TIMER` remaining ticks and may contain energy or boost minerals from the core's treasury:
```ts
// In CleanerOverlord — after core death detected:
const ruins = Game.rooms[targetRoom]?.find(FIND_RUINS, {
    filter: r => r.structure.structureType === STRUCTURE_INVADER_CORE
        && r.store.getUsedCapacity() > 0
});

if (ruins?.length) {
    // Dispatch lightweight hauler to collect ruins:
    colony.hatchery.requestCreep({
        body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE],
        memory: { role: 'ruinHauler', targetRoom, ruinId: ruins[0].id }
    });
}
// Ruin hauler: withdraw from ruin → return to colony terminal
```

> **Cross-references:** `ScoutOverlord` provides the pulse vision that populates `Memory.remoteMining[room].reservation`. `RemoteMiningOverlord` energy gate (50k storage threshold) prevents spawning miners/haulers for a contested room simultaneously. The `invaderGoal` predictive dispatch complements `§77` heavy invader escalation. Ruin hauler logic mirrors §62 tombstone/dropped resource recovery.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- SOURCE KEEPER PAPER — Already implemented:                               -->
<!--  ✅ RemoteMiningOverlord (standard 5-WORK miners, haulers)              -->
<!--  ✅ ScoutOverlord (sector vision)                                        -->
<!--  ✅ DefenseOverlord (reactive NPC invader response)                     -->
<!-- New: §80 SK room economics, keeper lifecycle, damage-trigger spawn,     -->
<!--       body specs (Guard/Miner/Hauler), passive container repair         -->
<!--  §81 lair-cycling FSM, predictive timer memory, hauler handshake,      -->
<!--       net energy model, melee vs ranged guard decision                  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 80. Source Keeper Room Economics, Keeper Lifecycle, and Body Specs
**Source Keeper Paper — Sector Center Exploitation / SKGuardOverlord**

### Why SK Rooms: The 73% Productivity Surplus
| Room State | Energy/Source/300t | Energy/tick |
|---|---|---|
| Neutral (unreserved) | 1,500 | 5 |
| Reserved (remote) | 3,000 | 10 |
| **Source Keeper room** | **4,000** | **13.33** |

SK rooms contain **3 sources + 1 mineral deposit**. Total: 12,000 energy/300 ticks vs 6,000 for a 2-source reserved room. Net efficiency after creep costs ~**80%** vs 40-50% for standard remote mining.

**Net energy model over 1,500 ticks (one Guard TTL):**
```
E_gross = 3 sources × 13.33 E/tick × 1500 ticks = 59,985 energy
C_guard  = 2,800 energy
C_miners = 3 × 950 = 2,850 energy
C_haulers = 4 × 1,500 = 6,000 energy
C_total  = 11,650 energy
E_net    = 59,985 − 11,650 = 48,335 energy  (~80% efficiency)
```

### Source Keeper Lifecycle (Critical Timing Mechanics)
```
• Keeper TTL: 1,500 ticks (same as player creeps)
• On keeper death (any cause): KeeperLair starts 300-tick cooldown → spawns next keeper
• DAMAGE TRIGGER: as soon as a keeper receives ANY damage, the 300-tick countdown
  for the NEXT keeper begins immediately — regardless of current keeper's HP or TTL.
  If old keeper is still alive at countdown=0 → forced suicide to allow successor spawn.
  
⚠ Double-spawn risk: if Guard's DPS is too low, old keeper may still be alive
  when new keeper spawns → 2 keepers at one source. Must ensure old keeper is cleared
  before countdown reaches 0. Track hits + ticksToSpawn simultaneously.
  
• Keeper path: static, pre-calculated (non-dynamic) → Guard can intercept mathematically
• Keeper position: moves to source, stays stationary → doesn't kite → melee guard wins
```

### Three-Tier Body Compositions
```ts
// SK Guard: lair suppression (cost = 2,800 energy)
// ATTACK×10 = 300 dmg/tick; kills 5,000-HP keeper in ~17 ticks
// HEAL×5 = 60 HP/tick self-heal; sustains approach damage
// MOVE×15 = 1:1 ratio (25 non-MOVE parts: 10+5 = 15 non-MOVE → 15 MOVE)
const SK_GUARD: BodyPartConstant[] = [
    ...Array(10).fill(ATTACK),
    ...Array(5).fill(HEAL),
    ...Array(15).fill(MOVE)
];

// SK Miner: full source depletion (cost = 950 energy)
// WORK×7 = 14 E/tick → 4,200 E/300t → fully depletes 4,000 source with buffer
// CARRY×1: enables passive container self-repair (no dedicated repairer needed)
// MOVE×4: 1:1 ratio (7+1 = 8 non-MOVE → need 4 MOVE for roads, 8 for plains)
const SK_MINER: BodyPartConstant[] = [
    ...Array(7).fill(WORK),
    CARRY,
    ...Array(4).fill(MOVE)
];

// SK Hauler: high-volume logistics (cost = 1,500 energy)
// CARRY×20 = 1,000 energy capacity per trip
// MOVE×10: 2:1 carry:move → 1 tile/tick on roads (full load), road-heavy infrastructure required
const SK_HAULER: BodyPartConstant[] = [
    ...Array(20).fill(CARRY),
    ...Array(10).fill(MOVE)
];
```

### Passive Container Repair (SK Miner)
Neutral room container decay = **5,000 HP / 100 ticks** (vs 5,000/500t in owned rooms — much faster). SK Miner's single CARRY part enables inline repair:
```ts
// In SK Miner task — after harvesting, before depositing:
if (miner.store[RESOURCE_ENERGY] > 0 && container.hits < container.hitsMax * 0.8) {
    miner.repair(container); // Costs 1 E per 100 HP repaired (WORK part)
    // Single CARRY holds enough to repair & still deposit surplus
}
```
This eliminates the need for a remote repair creep — ~950 energy saved per 1,500 ticks per source.

---

## 81. Lair-Cycling FSM, Predictive Timer Memory, and Hauler Handshake
**Source Keeper Paper — SKGuardOverlord Implementation / Logistics Optimization**

### Lair-Cycling: Predictive Synchronization Algorithm
One Guard manages all 3 sources by cycling between lairs. Arrival must coincide with `ticksToSpawn = 0`:
```ts
// In SKGuardOverlord.run():
const lairs = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_KEEPER_LAIR
}) as StructureKeeperLair[];

// Priority ranking: active keeper = P0; imminent spawn ≤ 50 ticks = P1
const urgentLair = lairs
    .filter(l => l.ticksToSpawn !== undefined)
    .map(l => ({
        lair: l,
        keeper: l.pos.findInRange(FIND_HOSTILE_CREEPS, 1)[0],
        travelTime: PathFinder.search(guard.pos, { pos: l.pos, range: 1 }).path.length
    }))
    .sort((a, b) => {
        // P0: active keeper present → attack now
        if (a.keeper && !b.keeper) return -1;
        if (!a.keeper && b.keeper) return 1;
        // P1: spawn imminent — earlier spawn = higher priority
        return (a.lair.ticksToSpawn ?? Infinity) - (b.lair.ticksToSpawn ?? Infinity);
    })[0];

// Dispatch: move to arrive at lair the same tick keeper spawns
const SAFETY_BUFFER = 3;
if (urgentLair) {
    const { lair, keeper, travelTime } = urgentLair;
    if (keeper) {
        // P0: attack active keeper; check double-spawn risk
        if (keeper.hits <= 300 && (lair.ticksToSpawn ?? 300) < travelTime) {
            // Old keeper near death, new one incoming — burst: skip heal, all attack
            guard.attack(keeper);
        } else {
            guard.attack(keeper);
            if (guard.hits < guard.hitsMax * 0.9) guard.heal(guard);
        }
        if (!guard.pos.isNearTo(keeper)) guard.moveTo(keeper);
    } else if ((lair.ticksToSpawn ?? 999) <= travelTime + SAFETY_BUFFER) {
        // P1: begin move to intercept spawn
        guard.moveTo(lair);
    } else {
        // Idle: position at range 1 from next lair
        guard.moveTo(lair, { range: 1 });
    }
}
```

### Predictive Timer Memory (80% CPU Reduction)
Instead of doing `room.find(FIND_STRUCTURES)` every tick to read `ticksToSpawn`:
```ts
// Tick N: read and cache lair timers when room is visible
if (Game.rooms[skRoom]) {
    const lairs = Game.rooms[skRoom].find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_KEEPER_LAIR
    }) as StructureKeeperLair[];

    Memory.skRooms[skRoom].lairTimers = lairs.map(l => ({
        id: l.id,
        pos: { x: l.pos.x, y: l.pos.y },
        cachedAt: Game.time,
        ticksToSpawn: l.ticksToSpawn ?? 300
    }));
}

// Ticks N+1 to N+249: decrement locally (no room.find needed)
Memory.skRooms[skRoom].lairTimers.forEach(lt => {
    lt.ticksToSpawn = Math.max(0,
        lt.ticksToSpawn - (Game.time - lt.cachedAt)
    );
});

// Tick N+250: re-sync with actual room data to handle damage-trigger deviations
if (Game.time % 250 === 0) {
    // Re-read actual lairs to catch reset caused by damage triggers
    delete Memory.skRooms[skRoom].lairTimers;
}
```
This cuts SK room CPU monitoring from ~5ms/tick to ~0.5ms/tick for timer-based decisions.

### Hauler-Miner Handshake (Synchronized Dispatch)
Prevents haulers traveling to empty containers or arriving too early:
```ts
// In SKGuardOverlord or LogisticsNetwork:
const DISPATCH_THRESHOLD = 0.8; // Dispatch hauler when container is 80% of hauler capacity

Memory.skRooms[skRoom].sources.forEach(sourceData => {
    const container = Game.getObjectById<StructureContainer>(sourceData.containerId);
    if (!container) return;

    const haulerCapacity = SK_HAULER.filter(p => p === CARRY).length * CARRY_CAPACITY; // 1000
    const containerLevel = container.store[RESOURCE_ENERGY];

    if (containerLevel >= haulerCapacity * DISPATCH_THRESHOLD
        && !sourceData.haulerDispatched) {
        // Container at 800+ energy → dispatch hauler now
        colony.hatchery.requestCreep({
            ...SK_HAULER_CONFIG,
            memory: { role: 'skHauler', targetContainer: container.id, targetRoom: skRoom }
        });
        sourceData.haulerDispatched = true;
    }

    // Reset flag when container empties (hauler collected)
    if (containerLevel < 100) sourceData.haulerDispatched = false;
});
```

### Melee vs. Ranged Guard Decision Gate
```ts
// In SKGuardOverlord — body selection based on CombatIntel:
const hostileTypes = Memory.skRooms[skRoom].lastHostiles ?? [];
const hasKitingInvaders = hostileTypes.some(h => h.bodyParts.includes(RANGED_ATTACK));

const guardBody = hasKitingInvaders
    ? SK_GUARD_RANGED  // RANGED_ATTACK×10, HEAL×5, MOVE×20 — effective vs kiting
    : SK_GUARD_MELEE;  // ATTACK×10, HEAL×5, MOVE×15 — cheaper, high burst vs stationary keepers

// Update CombatIntel when guard enters room with hostiles:
if (guard.room.name === skRoom && hostiles.length > 0) {
    Memory.skRooms[skRoom].lastHostiles = hostiles.map(h => ({
        bodyParts: h.body.map(b => b.type)
    }));
}
```

> **Cross-references:** SKGuardOverlord extends the same Directive-attachment pattern as §59 (GuardDirective). Predictive timer memory follows the same pattern as §74 ($ caching module). Hauler handshake mirrors §73 (static sink path caching). InvaderCore escalation within SK rooms follows §78 detection protocol. Lair-cycling invaderGoal tracking feeds into §79 predictive dispatch.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- TRAVELER/CARTOGRAPHER PAPER — Already covered:                           -->
<!--  ✅ §64 Bipartite matching / reconcileTraffic intent approach           -->
<!--  ✅ §65 Heuristic tuning, stuck detection, temporal tracking            -->
<!--  ✅ §66 WASM/Clockwork flow fields for high-repetition routes           -->
<!--  ✅ §74 $ caching module, heap-first persistence                        -->
<!--  ✅ TrafficManager recursive shoving / priority pushing                 -->
<!-- New: §82 POI shared path caching, serialized direction strings,        -->
<!--       hostile room cost=255 avoidance, staggered post-reset inflation,  -->
<!--       traffic throughput math, road-priority CostMatrix values         -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 82. POI Path Sharing, Direction String Serialization, and Hostile Room Avoidance
**Traveler/Cartographer Paper — Navigation Refinements Not Covered by §64-66**

### Point-of-Interest (POI) Shared Path Cache
Static routes (storage → remote source, spawn → controller) are calculated once and **shared across all creeps** with that route:
```ts
// Key: origin_room:dest_id — computed once per global reset per route
const POI_PATH_KEY = `poi:${originRoom}:${dest.id}`;

let sharedPath = GlobalCache.get<RoomPosition[]>(POI_PATH_KEY);
if (!sharedPath) {
    const result = PathFinder.search(origin, { pos: dest.pos, range: 1 }, {
        roomCallback: (room) => colony.pathingManager.getRoadWeightedMatrix(room),
        maxOps: 20_000
    });
    sharedPath = result.path;
    GlobalCache.set(POI_PATH_KEY, sharedPath); // Lives until global reset
    // Also serialize to Memory for post-reset resilience:
    Memory.poiPaths[POI_PATH_KEY] = serializePath(sharedPath);
}

// Every hauler with this destination uses the same object — zero additional PathFinder calls
creep.memory.sharedPathKey = POI_PATH_KEY;
creep.memory.pathStep = 0; // Index into sharedPath
```

### Serialized Direction String Format
Store paths as compact strings: each character = one direction constant (1-8):
```ts
// Serialize: RoomPosition[] → direction string
function serializePath(path: RoomPosition[]): string {
    let str = '';
    for (let i = 0; i < path.length - 1; i++) {
        str += path[i].getDirectionTo(path[i + 1]).toString();
    }
    return str; // e.g. "33215622" — 1 char per step, 50-step path = 50 bytes
}

// Deserialize: restore directions from string (no RoomPosition construction needed)
function getNextDirection(str: string, step: number): DirectionConstant {
    return parseInt(str[step]) as DirectionConstant;
}

// Usage in Zerg.travelTo():
const dir = getNextDirection(creep.memory.serializedPath, creep.memory.pathStep);
creep.move(dir);
creep.memory.pathStep++;
// Per-tick cost: string index + parseInt + move() — negligible vs PathFinder.search()
```

### Hostile Room Avoidance (roomCallback cost=255)
```ts
// In TrafficManager / travelTo roomCallback:
function buildRoomCallback(roomName: string): CostMatrix | boolean {
    // Block fully hostile rooms:
    if (Memory.rooms[roomName]?.hostile) {
        return false; // false = skip this room entirely (PathFinder treats as impassable)
    }

    // Standard road-priority matrix:
    const matrix = new PathFinder.CostMatrix();
    for (const road of Game.rooms[roomName]?.find(FIND_STRUCTURES,
        { filter: s => s.structureType === STRUCTURE_ROAD }) ?? []) {
        matrix.set(road.pos.x, road.pos.y, 1);
    }
    // Plains = 2 (prefer roads); swamps = 10; walls = 255:
    for (const terrain of new Room.Terrain(roomName).getRawBuffer()) {
        // terrain values: 0=plain, 1=wall, 2=swamp
    }
    return matrix;
}

// Mark room as hostile on encounter (persists in Memory):
function markRoomHostile(roomName: string, expiresAt: number): void {
    Memory.rooms[roomName] = { ...(Memory.rooms[roomName] ?? {}),
        hostile: true, hostileUntil: expiresAt };
}

// Clear stale hostility flags:
if (Memory.rooms[roomName]?.hostileUntil && Memory.rooms[roomName].hostileUntil < Game.time) {
    delete Memory.rooms[roomName].hostile;
}
```

### Road-Priority CostMatrix Values
```
Tile Type       | Default Cost | Road-Prioritized Cost (use in roomCallback)
----------------|--------------|--------------------------------------------
Road            | 1            | 1
Plain terrain   | 2 (w/MOVE)   | 2  (matches MOVE ratio — correct)
Swamp terrain   | 10           | 10
Occupied tile   | 255 (wall)   | 0  (ignore creeps in pathfinding — Traveler default)
Hostile room    | variable     | false (skip room entirely)
```
Setting plains to cost=2 and swamps to 10 makes the pathfinder strongly prefer roads — haulers will travel slightly longer routes to stay on roads, reducing MOVE part fatigue and extending effective TTL.

### Staggered Post-Reset Heap Inflation
After a global reset, hundreds of creeps simultaneously re-inflate paths from Memory → CPU spike:
```ts
// In Kernel.run() — post-reset detected via global.resetTick:
const isPostReset = !global.resetTick;
if (isPostReset) {
    global.resetTick = Game.time;
    global.pathInflationQueue = Object.keys(Memory.creeps); // All creep names
}

// Inflate BATCH_SIZE paths per tick until queue is empty:
const BATCH_SIZE = 5; // Tune based on CPU budget
if (global.pathInflationQueue?.length) {
    const batch = global.pathInflationQueue.splice(0, BATCH_SIZE);
    for (const name of batch) {
        const creepMem = Memory.creeps[name];
        if (creepMem?.serializedPath) {
            // Re-inflate: string → RoomPosition[] → heap
            const sharedKey = creepMem.sharedPathKey;
            if (sharedKey && !GlobalCache.has(sharedKey)) {
                // Priority: high-priority roles inflate first (miners before scouts)
                GlobalCache.set(sharedKey, deserializePath(Memory.poiPaths[sharedKey]));
            }
        }
    }
}
```

### Traffic Delay → Throughput Math
Traffic jams have measurable economic impact. For a remote source producing 10 E/tick:
```
Perfect system:       1,000 E capacity / 100 tick round-trip = 10 E/tick throughput
With 10-tick delay:   1,000 E / 110 ticks = 9.09 E/tick → 9% loss per source
10-room empire:       10 × 9% loss ≈ 10,000 E/hour lost to idle creeps in bottlenecks
```
Traffic management (§64 bipartite matching, recursive shoving) recovers this loss by ensuring zero idle time in bottlenecks. At scale: worth ~50,000 E/day per empire.

> **Cross-references:** POI cache key pattern matches §74 $ caching module. Direction string serialization is the compact Memory format for §65 stuck-detection path storage. Hostile room `false` return is coordinated with §60 GuardDirective (hostile room detection). Staggered inflation extends §68 global reset warmUp. Road-priority matrix values are the formal spec for §65 heuristicWeight CostMatrix.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- RCL 3 ADVICE PAPER — Almost entirely already covered:                   -->
<!--  ✅ Remote mining: §55 (container ROI), §10 RemoteMiningOverlord       -->
<!--  ✅ Scouting: ScoutOverlord, §78 controller reservation cache          -->
<!--  ✅ Storage push→pull: §76                                              -->
<!--  ✅ Rampart tiered repair: §76 50k minimum threshold                   -->
<!--  ✅ Dynamic task assignment: LogisticsNetwork Gale-Shapley (existing)  -->
<!-- New (narrow gaps only): §83 — early 20k HP NPC-proof cap,             -->
<!--   RCL 2/3 remote mining ignition window                                -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 83. Early Rampart HP Cap and Remote Mining Ignition Window
**RCL 3 Advice — Gaps Not Covered by §55/§76/§77**

> ✅ **PARTIALLY IMPLEMENTED** — Remote mining energy gate (50k/75k thresholds) already in `RemoteMiningOverlord.handleSpawning()`. Rampart HP cap is handled by `WorkerOverlord` repair logic. InvaderCore cleanup done in §9.

### 20k-50k HP "NPC-Proof" Rampart Cap During Upgrading Phase
§76 defines the tiered repair algorithm starting at 50k minimum. The *reason* 20k-50k suffices during early RCL 3 (before storage exists):
```
Light NPC invader (RCL 3): ~1,000 max HP, ~30 ATTACK dmg/tick
Tower at optimal range:     600 dmg/tick → kills invader in 2 ticks
Single rampart at 20k HP: withstands 20k / 30 = 666 ticks of uncontested melee
→ Any rampart > 10,000 HP is effectively immune to light invaders with a single tower

Cap during upgrading: 20,000–50,000 HP
  • Good enough to stop all RCL 3 light invaders
  • Does NOT drain storage before it exists
  • Prevents worker "sitting" on a single wall instead of building extensions
```
```ts
// In WorkerOverlord — RCL 3 specific: use lower cap if no storage yet
const EARLY_GAME_RAMPART_CAP = 50_000;
const rampartTarget = colony.storage
    ? getStorageScaledTarget(colony.storage.store[RESOURCE_ENERGY])
    : EARLY_GAME_RAMPART_CAP; // Pre-storage: hard cap at 50k, never scale up
```

### Remote Mining Ignition Window (RCL 2-3)
Explicit timing recommendation often omitted from general docs:
```
RCL 2 (550 energy cap) — viable to start IF:
  ✅ Spawn + extensions consistently full
  ✅ At least 2 pioneer-class miners active on home sources
  Start with: 1 reserver [CLAIM, MOVE] + 1 small miner [WORK×2, CARRY, MOVE×2]
  Return: +5 E/tick (unreserved), eventually +10 E/tick once reserved

RCL 3 (800 energy cap) — target ignition point for all top bots:
  ✅ Static miners + hauler network established (containers built)
  ✅ Tower operational for basic NPC defense in home room
  Spawn dedicated: [CLAIM, MOVE×4] reserver + [W×5, M] miner + [C×10, M×5] haulers
  Return: +10 E/tick per remote source = 2× home income with 2 remote sources

Gate: only start remote operations when home storage buffer ≥ 50,000 E (pre-storage:
      when spawn+extensions remain full for 500 consecutive ticks)
```

> **Cross-references:** Early rampart cap refines §76 tiered repair Tier 2 (50k threshold). Gate condition mirrors §77 ColonizeDirective Phase 1 SUPPORT energy check (buffer > 200k).

---

## 84. Per-File Audit: Bug Analysis, Hardening, and Optimization (All Systems)
**Code Quality — All 71 Source Files, Grouped by System**

> Each entry lists the file, its audit focus, and specific suspected bugs / hardening gaps / optimization opportunities. Files may appear in multiple groups.

---

### System 1: Kernel & Boot (main.ts entry point + full kernel layer)

| File | Audit Focus |
|---|---|
| [`main.ts`](file:///c:/code/screeps/src/main.ts) | Top-level `try/catch` — verify stack trace includes creep name context. Check `Memory.gcl` / `Memory.rooms` cleanup for dead rooms each tick. Confirm `global.resetTick` sentinel is set before any overlord instantiation. Bucket-limiter threshold hardcoded or configurable? |
| [`kernel/Kernel.ts`](file:///c:/code/screeps/src/kernel/Kernel.ts) | Process scheduling: does priority queue restore after `suspend()`? Verify `init()` runs before `run()` for all processes every tick, never reversed. Dead-process GC — are zombie `ColonyProcess` instances torn down when colony room is lost? |
| [`kernel/Process.ts`](file:///c:/code/screeps/src/kernel/Process.ts) | Base class: check that `suspend()` / `resume()` state is idempotent (double-suspend safe). Confirm `priority` is immutable after construction — late mutation would break scheduler ordering. |
| [`kernel/ProcessStatus.ts`](file:///c:/code/screeps/src/kernel/ProcessStatus.ts) | Enum completeness — are all states (RUNNING, SUSPENDED, DEAD) handled in every switch/if in Kernel.ts? |
| [`kernel/GlobalCache.ts`](file:///c:/code/screeps/src/kernel/GlobalCache.ts) | TTL eviction: does cache correctly invalidate stale entries after global reset vs tick-boundary? Check for key collisions between rooms with identical names (e.g., shard transfers). Memory leak risk: unbounded cache growth if keys are never deleted. |
| [`kernel/GlobalManager.ts`](file:///c:/code/screeps/src/kernel/GlobalManager.ts) | Verify `warmUp()` is called exactly once per global reset — not per tick. Check whether lost-creep memory (`Memory.creeps`) is purged here or in `main.ts`. |
| [`kernel/ErrorMapper.ts`](file:///c:/code/screeps/src/kernel/ErrorMapper.ts) | Source-map lookup on minified builds — does it gracefully degrade to raw stack on lookup failure? Circular-error protection: error during error mapping should not throw. |
| [`kernel/PathInflationGuard.ts`](file:///c:/code/screeps/src/kernel/PathInflationGuard.ts) | Is `BATCH_SIZE` tuned to current creep count, or hardcoded? Verify queue drains before next global reset wipes it. Check that inflation priority (miners > scouts) is actually enforced and not FIFO. |
| [`kernel/memory/SegmentManager.ts`](file:///c:/code/screeps/src/kernel/memory/SegmentManager.ts) | `setActiveSegments` called every tick? Verify max-5-segments limit is never exceeded. Circular buffer wrap-around logic: check off-by-one on segment size. Confirm segment 0 (public) is never accidentally written with private data. |
| [`version.ts`](file:///c:/code/screeps/src/version.ts) | Confirm version string is stamped at build time and written to `Memory.version` for remote observability. |

---

### System 2: Colony Lifecycle & Resource Management

| File | Audit Focus |
|---|---|
| [`os/colony/Colony.ts`](file:///c:/code/screeps/src/os/colony/Colony.ts) | Room-object refresh: does `.room` reference get re-assigned on every `refresh()` call or just on `build()`? Lost-visibility recovery: if colony room leaves `Game.rooms` (observer lost), does colony enter graceful degradation? Verify `energyLevel` thresholds used for overlord gating are consistent with §76 rampart cap logic. |
| [`os/colony/Hatchery.ts`](file:///c:/code/screeps/src/os/colony/Hatchery.ts) | Spawn deadlock guard: if all spawns are busy and energy is sufficient, does the queue back up? Verify `energyAvailable` (not `energyCapacityAvailable`) is used for MVC spawns during blackout. Check that `spawnQueue` is sorted by priority and not insertion-order. Prespawn formula: is `travelTicks` cached or re-PathFindered each call? |
| [`os/colony/LogisticsNetwork.ts`](file:///c:/code/screeps/src/os/colony/LogisticsNetwork.ts) | Effective-store ledger: verify `in-flight` reservations are cleared when a transporter dies mid-trip. Check for over-supply: does the broker correctly skip targets whose `effectiveStore + inFlight >= capacity`? Tombstone/ruin entries: are they removed from the offer list when they expire? |
| [`os/colony/MiningSite.ts`](file:///c:/code/screeps/src/os/colony/MiningSite.ts) | Container tracking: does `MiningSite` handle the case where the container is destroyed and needs to be rebuilt? Source object retrieved by ID each tick or cached? Verify `isActive` check covers both miner-present and container-not-full states. |
| [`os/colony/LinkNetwork.ts`](file:///c:/code/screeps/src/os/colony/LinkNetwork.ts) | Link cooldown (10 ticks): does `LinkNetwork` gate `transferEnergy` calls on `link.cooldown === 0`? Priority: verify receiver links (upgrade station) take priority over sender links. No-op protection: skip transfer if sender and receiver are the same link. |

---

### System 3: Traffic Management & Pathfinding

| File | Audit Focus |
|---|---|
| [`os/infrastructure/TrafficManager.ts`](file:///c:/code/screeps/src/os/infrastructure/TrafficManager.ts) | Recursive shove depth limit: unbounded recursion could stack-overflow in dense rooms — add `MAX_SHOVE_DEPTH` guard. Road-health CostMatrix: is the 100-tick periodic invalidation actually implemented (§83 gap)? Verify `registerMove` is called before `reconcile` — never after. Check that creeps with `MOVE` priority = `CRITICAL` cannot be shoved. |
| [`os/infrastructure/MovePriority.ts`](file:///c:/code/screeps/src/os/infrastructure/MovePriority.ts) | Completeness: are all overlord types represented? Check for priority collisions (two different roles sharing the same integer). Verify `PRIORITY.CRITICAL` is reserved and not assigned to non-critical roles. |
| [`os/zerg/Zerg.ts`](file:///c:/code/screeps/src/os/zerg/Zerg.ts) | `travelTo`: does it use cached direction string or re-paths every tick? Stuck detection: `STUCK_THRESHOLD` ticks — is `lastPos` purged after movement resumes? Verify `avoidPos` from stuck detection is injected into the CostMatrix roomCallback, not just stored in memory. `travelTo` range param: check that `range: 1` vs `range: 0` is used correctly for `build` (range 3) vs `transfer` (range 1). |
| [`os/zerg/Miner.ts`](file:///c:/code/screeps/src/os/zerg/Miner.ts) | Static position: verify miner doesn't repath after reaching source container. Container repair: is the `CARRY` part check guarding the `repair()` call correctly? |
| [`os/zerg/Transporter.ts`](file:///c:/code/screeps/src/os/zerg/Transporter.ts) | Task-switching mid-trip: does transporter correctly abort a pickup and switch to transfer when a higher-priority need appears? LogisticsNetwork unregistration: is transporter's in-flight reservation cleared on death? |
| [`os/zerg/Worker.ts`](file:///c:/code/screeps/src/os/zerg/Worker.ts) | `AWAITING_SUPPLY` anchor: once anchored, does the worker refuse to move even if a new construction site becomes closer? Ensure `supplyAnchorPos` is cleared after resupply completes. |
| [`os/zerg/Upgrader.ts`](file:///c:/code/screeps/src/os/zerg/Upgrader.ts) | Slot assignment: does upgrader occupy its pre-assigned position before beginning `upgradeController`? Verify `range: 3` is enforced and upgrader doesn't drift to controller tile (wasted MOVE). |
| [`os/zerg/CombatZerg.ts`](file:///c:/code/screeps/src/os/zerg/CombatZerg.ts) | Pre-heal logic: does `heal(self)` fire before `attack()` or after? Verify rangedAttack + heal simultaneous intent is correctly ordered. Retreat threshold: is 60% HP consistent with §80 SK Guard spec? |
| [`utils/Algorithms.ts`](file:///c:/code/screeps/src/utils/Algorithms.ts) | Distance transform: edge case where entire room is walled (DT score = 0 for all tiles) — does bunker placement gracefully fail? Floodfill termination: ensure max-iteration guard prevents infinite loop in pathological terrain. `minCut` correctness: verify cut produces a closed perimeter (no diagonal gaps). |
| [`utils/RoomPosition.ts`](file:///c:/code/screeps/src/utils/RoomPosition.ts) | `getDirectionTo` extension: does it handle same-room vs cross-room correctly? Null-safety: check for `undefined` pos inputs. |

---

### System 4: Spawning & Bootstrapping

| File | Audit Focus |
|---|---|
| [`os/overlords/BootstrappingOverlord.ts`](file:///c:/code/screeps/src/os/overlords/BootstrappingOverlord.ts) | Pioneer body selector: is `selectBootstrapBody` using `room.energyAvailable` (not capacity) for MVC? Pioneer ID tracking: do the first two pioneers correctly get `pioneerId ≤ 2` for metabolic stabilization? Blackout detection: verify `CRITICAL_BLACKOUT` state check covers zero miners AND zero pioneers. |
| [`os/overlords/PioneerOverlord.ts`](file:///c:/code/screeps/src/os/overlords/PioneerOverlord.ts) | Task cycling: does pioneer correctly switch between harvest→upgrade vs harvest→spawn-fill based on spawn buffer? Decay protection: pioneers should never let spawn drop to 0 — verify `300-energy buffer` check fires before upgrade. |
| [`os/colony/Hatchery.ts`](file:///c:/code/screeps/src/os/colony/Hatchery.ts) | (also listed in System 2) — Prespawn formula: verify `spawnTicks + travelTicks` buffer is re-computed when source moves or new colony layout is placed. |
| [`os/overlords/ClaimerOverlord.ts`](file:///c:/code/screeps/src/os/overlords/ClaimerOverlord.ts) | TTL edge case: claimer reaches target room with fewer ticks remaining than needed to claim — should abandon and trigger respawn. Verify `claimController` return code is checked and memory updated on success. |
| [`os/overlords/ReserverOverlord.ts`](file:///c:/code/screeps/src/os/overlords/ReserverOverlord.ts) | Reservation refresh: does reserver trigger before `ticksToEnd < 500` (engine resets reservation if < 4,999 ticks)? InvaderCore check: reserver should abort if `Memory.remoteMining[room].reservation.username === 'Invader'`. |
| [`utils/CreepBody.ts`](file:///c:/code/screeps/src/utils/CreepBody.ts) | Body generation: `generateBody` for budget-capped bodies — does it correctly maximize WORK parts before CARRY/MOVE? Verify body part ordering (TOUGH first, HEAL last) for combat creeps; incorrect ordering reduces effective HP. |

---

### System 5: Logistics & Transport

| File | Audit Focus |
|---|---|
| [`os/overlords/TransporterOverlord.ts`](file:///c:/code/screeps/src/os/overlords/TransporterOverlord.ts) | Mobile container fallback: when structures are full and no storage exists, does the hauler correctly switch to `FIND_MY_CREEPS` filtered to builders/upgraders? Verify it doesn't search `FIND_MY_CREEPS` every tick per hauler (O(N²) risk). |
| [`os/overlords/FillerOverlord.ts`](file:///c:/code/screeps/src/os/overlords/FillerOverlord.ts) | Filler standing tile: does filler correctly yield its parking tile when non-filler creeps need to pass? Verify the static CostMatrix cost on filler tile is set and not re-set every tick unnecessarily. Extension fill order: Hamiltonian pre-computed list — is it invalidated when extensions are built/destroyed? |
| [`os/overlords/QueenOverlord.ts`](file:///c:/code/screeps/src/os/overlords/QueenOverlord.ts) | Transfer efficiency: queen should batch transfers — does it check `spawn.store.getFreeCapacity > 0` before calling `transfer()`? Intent gate: verify 0.2-CPU intent is not wasted on already-full targets. |
| [`os/overlords/MiningOverlord.ts`](file:///c:/code/screeps/src/os/overlords/MiningOverlord.ts) | Prespawn: is replacement miner spawned before current miner dies, accounting for travel time? Container not-built case: does miner fall back to drop mining and does hauler adapt? |
| [`os/overlords/RemoteMiningOverlord.ts`](file:///c:/code/screeps/src/os/overlords/RemoteMiningOverlord.ts) | Energy gate: `storage < 50,000` → suspend spawning. Is gate checked once per tick at overlord level or per-creep spawn request? InvaderCore detection: does `suspendRoom` correctly block both miner AND hauler spawning simultaneously? invaderGoal tracking: is `Memory.remoteMining[room].totalHarvested` incremented by the miner, not the hauler? |
| [`os/overlords/TerminalOverlord.ts`](file:///c:/code/screeps/src/os/overlords/TerminalOverlord.ts) | Terminal cooldown (10 ticks): does `send()` check `terminal.cooldown === 0`? Energy reserve: does terminal overlord keep minimum 10,000 energy before market operations? Send failure handling: `ERR_TIRED` — retry next tick or drop intent? |
| [`os/tasks/TransferTask.ts`](file:///c:/code/screeps/src/os/tasks/TransferTask.ts) | Target validity: if transfer target is undefined (structure destroyed mid-trip), task should return `DONE` not throw. CreepZerg unregistration from LogisticsNetwork on task completion. |
| [`os/tasks/WithdrawTask.ts`](file:///c:/code/screeps/src/os/tasks/WithdrawTask.ts) | Empty-source guard: if container/tombstone/ruin empties between dispatch and arrival, task should abort cleanly. `getFreeCapacity()` check: ensure withdraw amount is clamped to `min(available, creepFreeCapacity)`. |
| [`os/tasks/PickupTask.ts`](file:///c:/code/screeps/src/os/tasks/PickupTask.ts) | Dropped resource decay: does task abort if resource has < 10 energy remaining (not worth pickup cost)? Priority weighting: `amount / decayRate` scoring applied before LogisticsNetwork task assignment? |
| [`os/tasks/HarvestTask.ts`](file:///c:/code/screeps/src/os/tasks/HarvestTask.ts) | Full-store guard: miner with full store should repair container instead of harvesting (wasted intent). Source-depletion detection: `source.energy === 0` → pause harvest, don't burn intent. |

---

### System 6: Construction & Base Planning

| File | Audit Focus |
|---|---|
| [`os/infrastructure/BunkerLayout.ts`](file:///c:/code/screeps/src/os/infrastructure/BunkerLayout.ts) | Anchor derivation: reverse-anchor from first spawn — does `canBlueprintFit` correctly validate all RCL 8 stamp tiles fall within the 50×50 room boundary? Distance Transform edge case: rooms with large mineral deposits or sources that fragment open space. Stamp placement order: is road network placed after structures (not before), preventing accidental road-on-structure overwrites? |
| [`os/overlords/ConstructionOverlord.ts`](file:///c:/code/screeps/src/os/overlords/ConstructionOverlord.ts) | Build pacing: is the per-tick construction site count capped to avoid `ERR_FULL` (max 100 sites per player)? Newborn rampart decay: does the overlord immediately queue repair for newly placed ramparts (1 HP)? Wall-smashing pathfinding cost: is STRUCTURE_WALL given cost=255 in the build-path CostMatrix? Bunker layout change: does overlord flush cached site list when `BunkerLayout` produces a new anchor? |
| [`os/overlords/WorkerOverlord.ts`](file:///c:/code/screeps/src/os/overlords/WorkerOverlord.ts) | Repair priority order: Tier 1 (< 10k HP) → Tier 2 (< 50k) → Tier 3 (scaled) — is this enforced in a single sorted call or separate passes? `STATIC_BUILD` anchor: does worker release anchor if construction site is completed by another creep? Tower repair-vs-build decision: does worker skip repairing towers when hostile creeps are actively being attacked (tower has better ROI)? |
| [`os/tasks/BuildTask.ts`](file:///c:/code/screeps/src/os/tasks/BuildTask.ts) | Site-destroyed guard: if `ConstructionSite` is removed between task assignment and execution (e.g., built by another creep), task should return `DONE`. Energy-empty abort: `build()` when `creep.store[RESOURCE_ENERGY] === 0` wastes 0.2 CPU intent. |
| [`os/tasks/RepairTask.ts`](file:///c:/code/screeps/src/os/tasks/RepairTask.ts) | Full-HP guard: `repair()` on a structure already at `hitsMax` wastes intent. Verify RepairTask checks `structure.hits < structure.hitsMax` before calling. |
| [`os/tasks/DismantleTask.ts`](file:///c:/code/screeps/src/os/tasks/DismantleTask.ts) | InvaderCore guard: `dismantle(invaderCore)` returns `ERR_INVALID_TARGET` — ensure task validates target type and switches to `AttackTask` for cores. |
| [`utils/ParkingZones.ts`](file:///c:/code/screeps/src/utils/ParkingZones.ts) | Filler tile exclusion: `ParkingZones` must exclude the filler standing tile from valid parking positions for non-filler creeps. Invalid-position filter: positions on walls (cost=255) must be excluded. Refresh frequency: does zone map rebuild when new structures are placed? |
| [`utils/Algorithms.ts`](file:///c:/code/screeps/src/utils/Algorithms.ts) | (also in System 3) — `floodfill`: validate it never returns tiles outside 1-48 border (exit tiles). `distanceTransform`: ensure wall tiles are initialized to 0 before propagation (not undefined). |

---

### System 7: Defense & Combat

| File | Audit Focus |
|---|---|
| [`os/overlords/DefenseOverlord.ts`](file:///c:/code/screeps/src/os/overlords/DefenseOverlord.ts) | Heavy invader escalation: `invaderHPT ≥ towerDPT × 0.5` → GUARD spawn — is `getTowerDamageAt` called with actual hostile position vs room center? Tower targeting: HEAL > RANGED_ATTACK > ATTACK sort — does re-sort happen every tick (healers may die mid-fight)? HOLD FIRE logic: verify healers are correctly excluded from DPS calculation when computing whether tower fire is net-positive. |
| [`os/overlords/DestroyerOverlord.ts`](file:///c:/code/screeps/src/os/overlords/DestroyerOverlord.ts) | Squad synchronization: does destroyer wait for full squad at staging room before entering target? Double-spawn guard: does the overlord correctly count both in-transit and in-room creeps to avoid redundant spawns? |
| [`os/directives/GuardDirective.ts`](file:///c:/code/screeps/src/os/directives/GuardDirective.ts) | Safe Mode trigger: is `controller.activateSafeMode()` guarded by `safeModeCooldown === 0` AND `safeModeAvailable > 0` checks? Blackout + hostile = auto-trigger; verify this doesn't fire during friendly-only traffic (ally creep in room). |
| [`os/directives/AttackDirective.ts`](file:///c:/code/screeps/src/os/directives/AttackDirective.ts) | Target room vision requirement: `AttackDirective` needs a scout in target room — does it spawn a scout if room is dark? Verify directive is removed when room is fully cleared (no hostile structures remain). |
| [`os/zerg/CombatZerg.ts`](file:///c:/code/screeps/src/os/zerg/CombatZerg.ts) | (also System 3) — verify `rangedMassAttack()` is used in dense groups (≥ 3 hostiles within range 3) for higher per-tick DPS than `rangedAttack()`. Kite logic: ranged guard should move away from melee hostiles while attacking. |

---

### System 8: Directives & Colonization

| File | Audit Focus |
|---|---|
| [`os/directives/Directive.ts`](file:///c:/code/screeps/src/os/directives/Directive.ts) | Base class: `remove()` — does it clean up both the flag AND the associated memory key? Flag-not-found handling: if a flag is manually deleted by the player, does the directive gracefully self-destruct? Color-pair lookup: verify O(1) lookup table (§74 directive color system) is used instead of linear scan. |
| [`os/directives/ColonizeDirective.ts`](file:///c:/code/screeps/src/os/directives/ColonizeDirective.ts) | Phase detection: `!targetRoom?.find(FIND_MY_SPAWNS).length` — handles visibility loss (room goes dark mid-colonization)? Parent energy gate: parent colony should not send SUPPORT creeps if `storage < 200k`. Verify `AUTONOMY` phase correctly removes the directive and registers the new `ColonyProcess`. |
| [`os/directives/HarvestDirective.ts`](file:///c:/code/screeps/src/os/directives/HarvestDirective.ts) | InvaderCore check: does `HarvestDirective` read `Memory.remoteMining[room].invaderCore` and suspend when core is present? Reserver expiry: if `ticksToEnd < 500`, directive should immediately re-request a reserver without waiting for next `build()` cycle. |
| [`os/processes/ColonyProcess.ts`](file:///c:/code/screeps/src/os/processes/ColonyProcess.ts) | Colony death detection: if home room's spawn is destroyed, does `ColonyProcess` enter emergency mode (BootstrappingOverlord, suspend all others)? Verify `refresh()` correctly updates all child colony references each tick. |

---

### System 9: Upgrading & Controller Management

| File | Audit Focus |
|---|---|
| [`os/overlords/UpgradingOverlord.ts`](file:///c:/code/screeps/src/os/overlords/UpgradingOverlord.ts) | Absolute storage floor: `storage < 100,000` → spawn 0 upgraders (except downgrade emergency). Verify downgrade emergency check uses `controller.ticksToDowngrade < 5,000` not a fixed tick number. Slot assignment: each upgrader has a unique standing tile — verify slot count is capped to available valid positions. |
| [`os/tasks/UpgradeTask.ts`](file:///c:/code/screeps/src/os/tasks/UpgradeTask.ts) | Range check: `upgradeController` requires `range ≤ 3` — verify task moves to pre-assigned slot, not raw controller position. Energy-empty abort: same 0.2 CPU waste prevention as BuildTask. |
| [`os/overlords/ScoutOverlord.ts`](file:///c:/code/screeps/src/os/overlords/ScoutOverlord.ts) | Room visibility cache: `Memory.remoteMining[room].lastSeen` — does scout update this even if room has no interesting events? InvaderCore detection: `FIND_STRUCTURES → STRUCTURE_INVADER_CORE` — is this scan performed or does scout only cache controller state? Scout TTL: single-part `[MOVE]` scout lives 1,500 ticks — is spawn cadence aligned so there's no visibility gap? |

---

### System 10: Market, Terminal & Empire

| File | Audit Focus |
|---|---|
| [`os/overlords/TerminalOverlord.ts`](file:///c:/code/screeps/src/os/overlords/TerminalOverlord.ts) | (also System 5) — Market arbitrage: does `Game.market.calcTransactionCost()` get called before sending to verify energy cost is affordable? `ERR_NOT_ENOUGH_RESOURCES` on `send()` — is this handled or does it silently fail? |
| [`os/colony/LinkNetwork.ts`](file:///c:/code/screeps/src/os/colony/LinkNetwork.ts) | (also System 2) — Lost link handling: if a link structure is destroyed, does `LinkNetwork` remove it from the sender/receiver lists immediately? Energy threshold: only send if sender has `> 400` energy (avoid wasting link capacity on small transfers). |
| [`utils/RoomScorer.ts`](file:///c:/code/screeps/src/utils/RoomScorer.ts) | Two-source bonus: verify 2-source rooms receive a significant score premium (~2× value). SK room detection: rooms in sector center (mod 10 == 5 for both x and y) should be flagged as SK rooms and scored differently. Hostile neighbor penalty: adjacent rooms owned by unfriendly players should reduce score. |
| [`utils/Logger.ts`](file:///c:/code/screeps/src/utils/Logger.ts) | RawMemory circular buffer (§67): does `appendLog` correctly handle wrap-around without corrupting previous entries? Log level filtering: is `DEBUG` level suppressed in production (`Memory.debugMode === false`)? Color formatting: verify `<font color>` tags are only emitted in console context, not serialized to Memory. |
| [`os/processes/ProfilerProcess.ts`](file:///c:/code/screeps/src/os/processes/ProfilerProcess.ts) | Profiler overhead: `screeps-profiler` wraps every function — is it gated behind a flag and compiled out (`#if PROFILER_ENABLED`) in production builds? Verify profiler data is flushed to RawMemory segment, not main Memory, to avoid JSON bloat. |
| [`os/tasks/ReserveTask.ts`](file:///c:/code/screeps/src/os/tasks/ReserveTask.ts) | Return code: `reserveController` returns `ERR_INVALID_TARGET` if controller already owned — guard against claiming owned controller. InvaderCore abort: if controller.reservation.username becomes 'Invader' mid-task, abort immediately. |
| [`os/tasks/ITask.ts`](file:///c:/code/screeps/src/os/tasks/ITask.ts) | Interface completeness: all task implementations should fulfill `target`, `priority`, `isValidTask()`, `isValidTarget()`, `work()`. Verify `isValidTarget()` is called before `work()` in the TaskSupervisor loop. |
| [`types.d.ts`](file:///c:/code/screeps/src/types.d.ts) | Memory schema: check `Memory.creeps[name].supplyRequestActive`, `invaderCore`, `remoteMining`, `poiPaths`, `skRooms` fields are declared. Missing declarations cause silent `any` typing throughout the codebase. |

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- RCL 3 STRATEGIC PLATEAU PAPER — Almost entirely already covered:        -->
<!--  ✅ Remote mining §55 §83; Scouting §78; Min-cut Algorithms.ts         -->
<!--  ✅ Smart tower §60 §77; Task system §73; Path caching §74 §82         -->
<!--  ✅ Storage pivot §76; Bunker stamp BunkerLayout; §83 ignition window  -->
<!-- New (narrow gaps): §85 — single-CLAIM reserver body, neighbor RCL     -->
<!--   WorldState profiling, downgrade-timer claim-sniping, harassment PvP  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 85. Single-CLAIM Reserver, WorldState Profiling, Downgrade Sniping, and Harassment PvP
**RCL 3 Strategy Paper — Gaps Not Covered by §55/§78/§83**

> ✅ **PARTIALLY IMPLEMENTED** — `ReserverOverlord.getReserverBody()` already has 1-CLAIM fallback at low capacity and scales to 5-CLAIM at 3250e. `UPGRADER_STORAGE_FLOOR = 100_000` in `UpgradingOverlord`. WorldState profiling, downgrade sniping, and PvP harassment remain unimplemented (T3.10-T3.12).

### Single-CLAIM Reserver Body for RCL 3
Full 2-CLAIM reserver costs 1,300 energy (RCL 4 requirement). RCL 3 can afford a cheaper single-CLAIM version:
```ts
// RCL 3 reserver: [CLAIM, MOVE] = 650 energy, 1 part each
// Reservation rate: 1 part × 600 ticks/part/tick = adds 600 ticks of reservation per tick
// Net reservation gain: 600 - 1 (decay) = +599 ticks per tick spent reserving
// Travel time ~50 ticks → controller reserved within ~8 ticks of arrival
// Use until RCL 4 when [CLAIM×2, MOVE×2] (1,300E, +1200 ticks/tick) becomes affordable

const RESERVER_BODY_RCL3: BodyPartConstant[] = [CLAIM, MOVE];       // 650 energy
const RESERVER_BODY_RCL4: BodyPartConstant[] = [CLAIM, CLAIM, MOVE, MOVE]; // 1,300 energy

// In ReserverOverlord — select body tier based on colony RCL:
const reserverBody = colony.controller.level >= 4
    ? RESERVER_BODY_RCL4 : RESERVER_BODY_RCL3;
```

### Neighbor RCL WorldState Profiling
Scouts should record neighbor player data to support threat assessment and market planning:
```ts
// In ScoutOverlord — when entering any room:
if (Game.rooms[roomName]) {
    const room = Game.rooms[roomName];
    Memory.worldState[roomName] = {
        lastSeen: Game.time,
        owner: room.controller?.owner?.username ?? null,
        level: room.controller?.level ?? 0,
        reservation: room.controller?.reservation?.username ?? null,
        sourceCount: room.find(FIND_SOURCES).length,
        threatLevel:
            (room.controller?.level ?? 0) >= 6 ? 'HIGH' :   // Boosted attackers possible
            (room.controller?.level ?? 0) >= 3 ? 'MEDIUM' : // Basic combat
            'LOW'
    };
}

// Usage in ExpansionPlanner / RoomScorer:
const threats = Object.entries(Memory.worldState)
    .filter(([_, data]) => data.threatLevel === 'HIGH' && data.lastSeen < Game.time - 1000);
// Devalue expansion candidates adjacent to HIGH-threat neighbors
```

### Controller Downgrade Timer Claim-Sniping
An unclaimed controller downgrades when `ticksToDowngrade` reaches 0. Bot can time CLAIM to seize the room the tick it becomes neutral, preventing competitors from claiming it first:
```ts
// In ScoutOverlord — when owned controller is visible in target room:
if (ctrl?.owner && !ctrl.my) {
    const remainingTicks = ctrl.ticksToDowngrade ?? Infinity;
    Memory.worldState[roomName].ticksToNeutral = remainingTicks;
    Memory.worldState[roomName].neutralAt = Game.time + remainingTicks;

    // If downgrade is imminent (< claimer travel time + spawn time):
    const travelTime = getCachedTravelTime(colony.pos, roomName);
    const spawnTime = CLAIMER_BODY.length * CREEP_SPAWN_TIME; // 3 ticks per part
    if (remainingTicks < travelTime + spawnTime + 100 /* safety buffer */) {
        // Dispatch claimer now to arrive exactly when room goes neutral:
        colony.hatchery.requestCreep(CLAIMER_CONFIG, roomName, { priority: PRIORITY.HIGH });
    }
}
```

### Early PvP Harassment Protocol (RCL 3)
Disrupting competitor remote mining is a core mechanic — sending cheap attackers to kill remote haulers:
```ts
// Harasser body (RCL 3, 800E cap): [ATTACK×3, MOVE×3] = 480 energy — fits RCL 3 budget
// Or: [RANGED_ATTACK×2, MOVE×2] = 600 energy — safer, attacks from range 3

// Remote defense detection — in RemoteMiningOverlord:
const remoteCreeps = Game.rooms[remoteRoom]?.find(FIND_MY_CREEPS) ?? [];
const underAttack = remoteCreeps.some(c =>
    c.hits < c.hitsMax &&
    c.pos.findInRange(FIND_HOSTILE_CREEPS, 5).length > 0
);

if (underAttack) {
    // Evacuate civilians: tell miners and haulers to return home
    remoteCreeps.forEach(c => c.memory.evacuate = true);
    // Dispatch guard to remote room
    colony.hatchery.requestCreep(GUARD_CONFIG, remoteRoom);
    // Track attacker source room for potential counter-harassment:
    const attacker = Game.rooms[remoteRoom]?.find(FIND_HOSTILE_CREEPS)[0];
    if (attacker?.owner?.username) {
        Memory.worldState[remoteRoom].lastAttacker = attacker.owner.username;
        Memory.worldState[remoteRoom].lastAttackTick = Game.time;
    }
}
// Evacuate flag: in MiningOverlord/RemoteMiningOverlord — if creep.memory.evacuate,
// switch to travelTo(homeRoom) instead of source
```

> **Cross-references:** Single-CLAIM reserver body feeds into `ReserverOverlord.ts` (§84 System 4 audit). WorldState profiling extends `ScoutOverlord.ts` and `RoomScorer.ts`. Claim-sniping uses `ClaimerOverlord.ts` dispatch. Harassment evacuation complements §77 colonial bootstrap (parent withdrawal on `AUTONOMY`) and §60 GuardDirective trigger conditions.

---

## 86. Controller Signing, say State Visualization, and Inter-Player Handshakes
**Signaling Paper — signController / creep.say / RawMemory Protocols**

### signController Mechanics
```ts
// Any creep, any body, range 1 — no CLAIM part required
// Returns ERR_NOT_IN_RANGE if not adjacent; ERR_BUSY if spawning
creep.signController(controller, "⚔️ [AllianceName] Do Not Expand — @discord.gg/xyz");
// Max 100 chars. Sign persists until overwritten by ANY creep (friendly or hostile).

// Detect hostile resigning — in Colony.ts or DefenseOverlord refresh():
const sign = colony.controller.sign;
if (sign && sign.username !== MY_USERNAME && sign.username !== 'Screeps') {
    // Hostile scout signed our controller — escalate DefenseOverlord
    Logger.warning(`Controller resigned by ${sign.username}: "${sign.text}"`);
    // Re-sign to restore our message:
    colony.hatchery.requestCreep(SIGNER_CONFIG); // [MOVE] creep, travelTo controller
}

// SYSTEM signs — game engine uses username 'Screeps' to mark:
//   SIGN_NOVICE_AREA: room planned to become Novice wall zone — CLAIM before walls appear!
//   SIGN_RESPAWN_AREA: similar respawn zone warning
if (sign?.username === 'Screeps' && sign.text?.includes('SIGN_NOVICE_AREA')) {
    // Dispatch claimer immediately — novice walls form in ~hours, permanently blocking access
    colony.hatchery.requestCreep(CLAIMER_CONFIG, roomName, { priority: PRIORITY.CRITICAL });
}
```

### creep.say State-Machine Visualization
```ts
// 10-char limit: use emoji vocabulary for zero-cost visual debugging
// Private by default (second arg = false); public when second arg = true
const STATE_EMOJI: Record<string, string> = {
    HARVEST:        '⛏️',   // Mining
    TRANSFER:       '🚚',   // Hauling to target
    WITHDRAW:       '📦',   // Picking up from container/storage
    BUILD:          '🔨',   // Building construction site
    REPAIR:         '🔧',   // Repairing structure
    UPGRADE:        '⚡',   // Upgrading controller
    IDLE:           '💤',   // Nothing to do
    TRAVEL:         '🗺️',   // Inter-room movement
    AWAITING_SUPPLY:'⌛',   // Waiting for hauler (§73 AWAITING_SUPPLY state)
    STUCK:          '🚫',   // Stuck detection triggered
    ATTACK:         '⚔️',   // Combat
    HEAL:           '💊',   // Self-healing or healing ally
    ERROR:          '❌',   // Caught error state
};

// In Zerg.ts — call once per tick after determining state:
creep.say(STATE_EMOJI[this.state] ?? this.state.slice(0, 10));
// For error codes, say the numeric code: creep.say(`ERR:${returnCode}`)
// ERR_NOT_IN_RANGE = -9; shows as "ERR:-9" — immediately visible which API call failed
```

### Allied Rampart Handshake Protocol
```ts
// Scenario: ally needs to pass through our room; ramparts block non-owners
// Owner side: scan for ally say message before setting rampart public
const ALLY_LIST = ['AllyPlayer1', 'AllyPlayer2']; // Checked against defined alliance

// In Colony.ts or DefenseOverlord each tick:
const hostiles = room.find(FIND_HOSTILE_CREEPS);
for (const hostile of hostiles) {
    if (ALLY_LIST.includes(hostile.owner.username) && hostile.saying === 'OPEN') {
        // Ally requested passage — set ramparts to public for 5 ticks
        room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART })
            .forEach((r: StructureRampart) => r.setPublic(true));
        Memory.rooms[room.name].rampartPublicUntil = Game.time + 5;
    }
}
// Reset ramparts after timer expires:
if ((Memory.rooms[room.name].rampartPublicUntil ?? 0) < Game.time) {
    room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART })
        .forEach((r: StructureRampart) => r.setPublic(false));
}

// Ally side: broadcast "OPEN" as public say when entering near ramparts
if (allyCreep.room.name === transitRoom) {
    allyCreep.say('OPEN', true); // public = true — owner can read via hostile.saying
}
// ⚠️ 1-tick latency: owner reads the saying set in tick N-1, not current tick
// Ally must say 'OPEN' at least 1 tick before needing to move through
```

### 1-Tick saying Latency (Critical Protocol Detail)
```
Tick N:   hostile.say("ATTACK", true)    → server stores intent
Tick N+1: myScript reads hostile.saying  → "ATTACK" is now visible

Consequence: any reaction to a hostile's say message is always 1 tick late.
→ Never use say as a primary trigger for time-sensitive defense.
→ Use it for: confirmation of intent, state logging, alliance handshakes (non-urgent).
→ Primary defense triggers must use: hits, pos, bodyParts — available same tick.
```

### Advanced: Energy-Drop Encoding (Creative Protocol)
```ts
// Encode arbitrary data as dropped energy amounts (bypasses 100/10 char limits)
// ASCII: drop (charCode) energy → observer reads amount → reconstructs character
function encodeMessage(creep: Creep, message: string): void {
    for (let i = 0; i < message.length; i++) {
        // Drop each character as a separate energy pile (requires CARRY + energy)
        const charCode = message.charCodeAt(i);
        creep.drop(RESOURCE_ENERGY, charCode); // e.g., 65 = 'A'
        // ⚠️ Decay: dropped energy loses floor(amount/1000) HP/tick — messages vanish fast
        // ⚠️ CPU: observer must FIND_DROPPED_RESOURCES each tick — expensive at scale
        // ⚠️ Energy cost: each character consumes real energy
        // Use only for one-time signals in very specific scenarios
    }
}
// Practical alternative: use RawMemory public segments for multi-byte data
```

### RawMemory Public Segments for Alliance Data
```ts
// Publishing alliance data (threat maps, market offers, diplomatic status):
const ALLIANCE_SEGMENT_ID = 7; // Agreed segment # with allies

// Each tick: write data to segment and mark it public
RawMemory.segments[ALLIANCE_SEGMENT_ID] = JSON.stringify({
    allies: ALLY_LIST,
    threatMap: Memory.worldState,        // §85 WorldState profiling
    marketOffers: Memory.pendingTrades,
    timestamp: Game.time
});
RawMemory.setPublicSegments([ALLIANCE_SEGMENT_ID]);

// Reading ally's public segment (requires 1-tick handshake):
// Tick N:   RawMemory.setActiveForeignSegment('AllyUsername', ALLIANCE_SEGMENT_ID);
// Tick N+1: const allyData = JSON.parse(RawMemory.foreignSegment?.data ?? '{}');
if (RawMemory.foreignSegment?.username === 'AllyUsername') {
    const allyData = JSON.parse(RawMemory.foreignSegment.data);
    Memory.worldState = { ...Memory.worldState, ...allyData.threatMap };
}
```

> **Cross-references:** `saying` 1-tick latency is the formal spec for §75 Assimilator heartbeat (200E transfer read delay). SYSTEM signing (SIGN_NOVICE_AREA) feeds §85 downgrade-sniping claimer dispatch. RawMemory segment protocol extends §67 (RawMemory circular buffer) and §75 (public segments for Assimilator verification). Rampart handshake uses the same `setPublic()` gating referenced in §60 GuardDirective.

---
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- COMMAND-LAYER PAPER — Already covered:                                   -->
<!--  ✅ §69 screeps-profiler, RoomVisuals debug overlays                   -->
<!--  ✅ §74 directive color table, bucket limiter gate                     -->
<!--  ✅ §75 Assimilator SHA-256 key exchange                               -->
<!--  ✅ §67 RawMemory segments, Logger                                     -->
<!--  ✅ §82 staggered post-reset path inflation                            -->
<!-- New: §87 GCL/CPU formula, pixel farming, memory-queue admin,           -->
<!--       terminal market cost equation, 4 military modes (waves/trickle/  -->
<!--       tower-drain/controller-attack), private server admin utils       -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->

## 87. GCL/CPU Formula, Pixel Farming, Memory Queue Admin, Market Cost, and Military Modes
**Command-Layer Paper — Gaps Not Covered by §69/§74/§75**

### GCL ↔ CPU Assigned Formula
```
CPU_assigned = 10 × (GCL - 1) + 20

GCL 1: 20 CPU    GCL 5: 60 CPU    GCL 10: 110 CPU
GCL 20: 210 CPU  GCL 29: 300 CPU  (hard cap: 300 CPU at GCL 29)

// Practical implication for bucket limiter thresholds (§74):
// At GCL 3 (40 CPU), overlord suspension at bucket < 500 is aggressive.
// At GCL 10 (110 CPU), same threshold gives much more headroom.
// → Scale bucket limiter thresholds by Game.cpu.limit, not hardcoded values:
const BUCKET_SUSPEND_THRESHOLD  = Game.cpu.limit * 10;  // e.g. 40*10=400 at GCL 3
const BUCKET_CRITICAL_THRESHOLD = Game.cpu.limit * 5;   //               200
```

### Pixel Farming Automation
```ts
// Game.cpu.generatePixel() consumes 10,000 bucket units → creates 1 Pixel (tradeable)
// Run this in main.ts BEFORE any game logic so bucket check is pre-spend accurate:
if (typeof Game.cpu.generatePixel === 'function'
    && Game.cpu.bucket >= 10_000
    && !Memory.disablePixelFarming) {
    const result = Game.cpu.generatePixel();
    if (result === OK) Logger.info('Pixel generated — bucket reset to 0');
}

// Console toggle (attach to global for runtime control):
global.togglePixelFarming = () => {
    Memory.disablePixelFarming = !Memory.disablePixelFarming;
    console.log(`Pixel farming: ${Memory.disablePixelFarming ? 'OFF' : 'ON'}`);
};
// Use: `togglePixelFarming()` in console to pause during high-CPU events
```

### Memory Queue Admin Commands (TooAngel Pattern)
```ts
// Strategic overrides pushed to home-room memory queue:
// The room's Hatchery/Overlord polls memory.queue and fulfills entries as capacity allows
interface QueueEntry {
    role: 'autoattackmelee' | 'reserver' | 'signer' | 'sourcer' | 'guard';
    routing: { targetRoom: string; targetId?: string; signText?: string };
    priority?: number;
}

// Attach to global for console use:
global.q = {
    attack: (from: string, target: string) =>
        Game.rooms[from]?.memory.queue.push({
            role: 'autoattackmelee', routing: { targetRoom: target }
        }),
    reserve: (from: string, target: string) =>
        Game.rooms[from]?.memory.queue.push({
            role: 'reserver', routing: { targetRoom: target }
        }),
    sign: (from: string, target: string, text: string) =>
        Game.rooms[from]?.memory.queue.push({
            role: 'signer', routing: { targetRoom: target, signText: text }
        }),
    flushQueue: (roomName: string) => {
        Memory.rooms[roomName].queue = [];
        console.log(`Queue cleared for ${roomName}`);
    },
    listQueues: () => Object.entries(Memory.rooms)
        .filter(([_, m]) => m.queue?.length)
        .map(([r, m]) => `${r}: ${JSON.stringify(m.queue)}`)
        .join('\n')
};
// Usage: q.attack('W5N5', 'W5N6') — queues melee attacker from W5N5 toward W5N6
```

### Terminal Market Transfer Energy Cost Formula
```ts
// Energy cost of terminal.send() scales with distance (not free):
// Energy_cost = amount × (1 - e^(-distance/30))
// This is the ENERGY consumed from the sending terminal — not credits
function calcTransferEnergy(amount: number, fromRoom: string, toRoom: string): number {
    const dist = Game.map.getRoomLinearDistance(fromRoom, toRoom, true); // interRoomDistance
    return Math.ceil(amount * (1 - Math.exp(-dist / 30)));
}

// Practical examples:
// 1000 minerals, distance 5:  cost ≈ 154 energy (15.4%)
// 1000 minerals, distance 15: cost ≈ 394 energy (39.4%)
// 1000 minerals, distance 30: cost ≈ 632 energy (63.2%)
// → Local trades (dist < 5) are dramatically cheaper; trade hubs near allies matter

// In TerminalOverlord — block send if energy cost makes trade unprofitable:
const energyCost = calcTransferEnergy(amount, colony.room.name, targetRoom);
if (terminal.store[RESOURCE_ENERGY] < energyCost + TERMINAL_ENERGY_RESERVE) {
    Logger.warning(`Send aborted: insufficient energy (need ${energyCost + TERMINAL_ENERGY_RESERVE})`);
    return;
}
```

### 4 Military Tactical Modes
```ts
// Military engagement modes — selected via console or CombatIntel assessment:
const MilitaryMode = {
    // WAVES: rally all squad members at staging room → simultaneous push
    // Best against: weak towers, under-defended rooms
    // Risk: slow staging; all creeps commit together or not at all
    WAVES: 'WAVES',

    // TRICKLE: send creeps individually on continuous loop
    // Best against: high-energy towers (drain over time)
    // Benefit: constant pressure, min. total creep investment
    TRICKLE: 'TRICKLE',

    // TOWER_DRAIN: TOUGH-heavy + Healer tank pair absorbs tower fire until towers are empty
    // Best against: rooms with 2+ towers but no active defenders
    // Body: [TOUGH×25, HEAL×5, MOVE×20] paired with [HEAL×10, MOVE×10]
    // Math: 6 towers × 600 dmg = 3600 DPS; TOUGH reduces by 70% if boosted → 1080 DPS
    TOWER_DRAIN: 'TOWER_DRAIN',

    // CONTROLLER_ATTACK: creep with ATTACK/WORK targets Room Controller directly
    // Deals 100 dmg/tick per WORK part to controller via `attackController()`
    // Best against: high-RCL rooms you want to downgrade (e.g., RCL 8 → 7 = -7h of upgrades)
    // Note: controller has safemode; abort if safemode activates
    CONTROLLER_ATTACK: 'CONTROLLER_ATTACK',
};

// In DestroyerOverlord — mode selection:
const mode = CombatIntel.selectMode(targetRoom);
// WAVES if defenders === 0 and towers < 2
// TRICKLE if towers ≥ 3 and no active defenders (drain focus)
// TOWER_DRAIN if towers ≥ 3 and high HP defenders present
// CONTROLLER_ATTACK only after towers are empty (switch from TOWER_DRAIN)
```

### Private Server Admin Utils
```ts
// Access via: npx screeps cli  (connects to local server JS VM)
// These commands are server-side — never available on official servers

// Force RCL 8 on a room's controller:
storage.db['rooms.objects'].update(
    { type: 'controller', room: 'W5N5' },
    { $set: { level: 8, progress: 0, downgradeTime: 0 } }
);

// Refill all extensions in a room instantly:
storage.db['rooms.objects'].update(
    { type: 'extension', room: 'W5N5' },
    { $set: { store: { energy: 200 } } },
    { multi: true }
);

// Spawn bot opponent for combat testing:
bots.spawn('simplebot', 'W6N5', { username: 'TestBot', cpu: 20 });

// Create NPC Invader Core in remote room for §78/§79 testing:
storage.db['rooms.objects'].insert({
    type: 'invaderCore', room: 'W5N6',
    x: 25, y: 25, hits: 100000, hitsMax: 100000,
    store: {}, storeCapacityResource: {}
});

// Set a player's GCL for CPU budget testing:
storage.db.users.update(
    { username: 'YourUsername' },
    { $set: { gcl: 1000000000 } } // ~GCL 10
);
```

> **Cross-references:** GCL/CPU formula ties bucket limiter to §74 (scale thresholds by `Game.cpu.limit`). Pixel farming runs before §74 Kernel.run() in `main.ts`. Memory queue pattern extends §77 ColonizeDirective phase detection. Terminal cost formula integrates with §84 System 10 `TerminalOverlord.ts` audit. Military modes TOWER_DRAIN + CONTROLLER_ATTACK extend §77 heavy invader escalation and §60 GuardDirective. Private server admin directly supports §79 Cleaner FSM and §83 ignition-window testing.

---

## 88. Season 8 / Arena Season 2 — Actionable Codebase Changes (March 2026)
**6 concrete things to implement before March 1 Season 8 launch**

> ✅ **PARTIALLY IMPLEMENTED** v5.20 — `SEASON_MODE=false` + `SEASON_CPU_CAP=100` + `EFFECTIVE_CPU_CAP` added to `main.ts` with `season.enable()/status()` console API. `TerminalOverlord` gates all `Game.market.*` calls behind `!SEASON_MODE`. `RoomScorer.scoreRoom(seasonMode=true)` uses Level²×20 formula. **Remaining: flip `SEASON_MODE=true` before March 1; verify Season 8 spawn-per-room cap (T2.4).**

> ⚠️ Season 8 starts **March 1, 2026** — 6 days from now. Arena Season 2 started **February 1, 2026** (already live).

---

### 1. Season Mode Flag (touches: `main.ts`, `types.d.ts`, `Colony.ts`)
Gate all season-specific behavior behind a single constant:
```ts
// version.ts or main.ts:
export const SEASON_MODE = true;   // flip to false for Persistent World
export const SEASON_CPU_CAP = 100; // fixed regardless of GCL — never use Game.cpu.limit

// types.d.ts — add to Memory interface:
interface Memory {
    seasonMode: boolean;
    disableMarket: boolean;
    disablePixelFarming: boolean;
}
```

---

### 2. Fixed-100 CPU Budget (touches: `kernel/Kernel.ts`, `main.ts`)
In Season 8, CPU = **100 fixed**, does NOT scale with GCL. The §74/§87 bucket thresholds must use the hardcoded cap, not `Game.cpu.limit` (which would read 20 at GCL 1):
```ts
// In Kernel.ts / bucket limiter:
const cpuCap = (SEASON_MODE) ? SEASON_CPU_CAP : Game.cpu.limit;

// Scale thresholds off season-aware cap:
const BUCKET_SUSPEND_THRESHOLD  = cpuCap * 10; // 1000 in season (100*10)
const BUCKET_CRITICAL_THRESHOLD = cpuCap * 5;  // 500

// Pixel farming: disabled in season (wasting 10k bucket for a Pixel mid-season is wasteful)
const pixelEnabled = !SEASON_MODE && !Memory.disablePixelFarming;
if (pixelEnabled && Game.cpu.bucket >= 10_000) Game.cpu.generatePixel();
```

---

### 3. RoomScorer Apex-Rush Mode (touches: `utils/RoomScorer.ts`)
Persistent World scoring weights 2-source rooms and low-swamp terrain.
Season 8 scoring is `Level² points/tick/room` where Level = f(N-coordinate). The entire scoring function needs a seasonal override:
```ts
// Pyramid coordinate bands → sector level:
function getSectorLevel(roomName: string): number {
    const match = roomName.match(/[NS](\d+)/);
    if (!match) return 0;
    const n = parseInt(match[1]);
    if (n <= 19)  return 1;  //  1 pt/tick
    if (n <= 39)  return 2;  //  4 pts/tick
    if (n <= 59)  return 3;  //  9 pts/tick
    if (n <= 79)  return 4;  // 16 pts/tick
    if (n <= 99)  return 5;  // 25 pts/tick
    return 0;
}

export function scoreRoom(roomName: string, data: WorldStateEntry): number {
    if (SEASON_MODE) {
        const level = getSectorLevel(roomName);
        // Apex rooms overwhelmingly more valuable — weight heavily
        const apexBonus = level ** 2 * 1000; // 25,000 for L5 vs 1,000 for L1
        // Still penalize hostile neighbors and SK rooms in path:
        const hostilePenalty = (data.threatLevel === 'HIGH') ? -5000 : 0;
        return apexBonus + data.sourceCount * 100 + hostilePenalty;
    }
    // Standard persistent world scoring:
    return data.sourceCount * 500 + (data.mineralType ? 200 : 0) /* ... */;
}
```

---

### 4. TerminalOverlord Season Mode — Daisy-Chain, No Market (touches: `os/overlords/TerminalOverlord.ts`)
Season 8: **no global market** + **Terminals can only send to own terminals**. Two major behavioral changes:
```ts
// In TerminalOverlord.run():
if (Memory.seasonMode || SEASON_MODE) {
    // DISABLE: all market operations (createOrder, deal, sell, buy)
    // DISABLE: cross-player sends
    // ENABLE: intra-empire "daisy-chain" energy transport

    // Daisy-chain: if this colony has excess energy, push toward the apex colony:
    const apexColony = this.getApexColony(); // highest-level room we own
    if (apexColony && apexColony.room.name !== colony.room.name) {
        const surplusEnergy = terminal.store[RESOURCE_ENERGY] - TERMINAL_ENERGY_RESERVE;
        if (surplusEnergy > 1000) {
            const cost = calcTransferEnergy(surplusEnergy, colony.room.name, apexColony.room.name);
            if (terminal.store[RESOURCE_ENERGY] >= surplusEnergy + cost) {
                terminal.send(RESOURCE_ENERGY, surplusEnergy, apexColony.room.name);
            }
        }
    }
    return; // skip all market logic below
}
// Normal persistent world market logic...
```

---

### 5. Logger.ts — `console.logUnsafe` Migration (touches: `utils/Logger.ts`)
Season 8 / latest Node.js: `console.log` now **auto-strips HTML**. Raw HTML visual overlays (colors, badges) must use `console.logUnsafe`:
```ts
// Current pattern (HTML stripped in Season 8 runtime):
console.log(`<span style="color:red">[ERROR]</span> ${msg}`);

// Season 8: use console.logUnsafe for intentional HTML (accept XSS responsibility):
const logFn = (html: boolean) =>
    (typeof console.logUnsafe === 'function' && html)
        ? console.logUnsafe   // intentional HTML — caller is responsible for sanitization
        : console.log;        // auto-sanitized

// In Logger.ts wrapper:
export function logHTML(msg: string): void {
    // Sanitize user-provided content before passing to logUnsafe:
    const safe = msg.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    (console as any).logUnsafe?.(safe) ?? console.log(msg);
}
export function log(msg: string): void {
    console.log(msg); // auto-sanitized — safe for all runtimes
}
```

---

### 6. Arena Season 2 Readiness Checklist (for future port)
Not needed for World Season 8, but if targeting Arena Season 2 matches:
```
□ Remove all Memory.* usage — use module-level variables instead
□ Remove all Game.creeps iteration — maintain own Set<Creep>
□ Remove Date object usage — use Game.time only (Date is blocked in Arena)
□ Restructure as ES6 modules:  import { Kernel } from './Kernel'
□ Arena Tower reload logic: spawn "reloader" creep (CARRY×1, MOVE×1 = 100E)
  that loops: withdraw(container) → transfer(tower) every 10 ticks
  Towers: 10 energy cap, 10-tick cooldown, 1000 dmg at range 0, -50/tile falloff
□ Horde AI over quad: 50-energy scouts bait tower shots (10-tick tower lockout)
  before main force pushes — tower wastes 1000-dmg shot on 50E scout = net win
□ DO NOT port World-specific code: Hatchery, LogisticsNetwork, ColonyProcess
  (Arena has no RCL, no extensions, no GCL, no controller)
```

> **Cross-references:** Season CPU cap overrides §87 GCL formula (fixed 100 not GCL-based). Apex-rush RoomScorer overrides §85 WorldState profiling score weights. Daisy-chain TerminalOverlord overrides §87 terminal cost formula (still applies). Logger logUnsafe is new API surfaced in §86 signaling context. Arena horde AI is the swarm counter to §87 TOWER_DRAIN military mode.

---

## 89. Per-File CPU & Heap/Memory Efficiency Audit (All Systems)
**Companion to §84 — Performance Focus: FIND caching, PathFinder call reduction, O(N²) loops, Memory bloat, GlobalCache eviction**

> **Key antipatterns to hunt for:**
> - `FIND_*` called more than once per tick on the same room (cache in local var or via `$`)
> - `PathFinder.search` called without checking `GlobalCache` first
> - `Game.getObjectById(id)` called in a per-creep loop (cache result on tick boundary)
> - `Object.keys(Memory.creeps)` or `Object.entries(Memory.rooms)` in a hot loop (O(N))
> - Nested `find` inside a `forEach` loop (O(N²))
> - `JSON.stringify / JSON.parse` of large objects in the main loop
> - Dead keys accumulating in `Memory.creeps`, `Memory.rooms`, `Memory.remoteMining`
> - Heap objects (GlobalCache entries) with no TTL or eviction path

---

### System 1: Kernel & Boot — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `main.ts` | Is `Object.keys(Memory.creeps)` scanned to purge dead creeps every tick or on an interval? O(N) purge every tick fine; O(N) purge + O(N) GC inside same tick doubles cost. Cache `Game.creeps` reference to a local const — do not re-access `Game.creeps[name]` in two separate places within same tick. |
| `Kernel.ts` | Process queue iteration: is `runningProcesses` a pre-sorted array from last tick or re-sorted each tick? Re-sorting O(N log N) every tick wastes 0.5–2 CPU. Sort once on insert/priority-change only. |
| `GlobalCache.ts` | Unbounded growth risk: does cache have a max-entries guard (e.g., 500 keys)? Evict LRU entries when limit exceeded. Check: does `get()` trigger a cache-miss log every tick for the same key during post-reset inflation? |
| `GlobalManager.ts` | `warmUp()` run once per reset — safe. Verify it does NOT call any `FIND_*` on rooms not yet visible after reset. |
| `ErrorMapper.ts` | Source-map lookup: is the source-map parsed from a string every time or cached on heap after first parse? Parsing a 500KB source map every error call is catastrophic. Cache parsed map in `global.sourceMap`. |
| `PathInflationGuard.ts` | `BATCH_SIZE` too high → inflation spike same tick; too low → creeps path-less for many ticks. Profile: at 200 creeps and BATCH_SIZE=5, full inflation takes 40 ticks. Consider BATCH_SIZE = `Math.ceil(inflationQueue.length / 20)` to drain in ≤ 20 ticks regardless of queue size. |
| `SegmentManager.ts` | `setActiveSegments` is a 0.1 CPU intent — only call it when segments actually change. Cache `lastActiveSegments` and skip the call if identical to this tick's desired set. |

---

### System 2: Colony Lifecycle — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `Colony.ts` | `colony.room.find(FIND_MY_STRUCTURES)` — this is called by multiple overlords in the same tick. Cache ALL `FIND_*` results on Colony at the top of `refresh()` and expose as properties (`colony.structures`, `colony.spawns`, etc.). Single `FIND_*` call shared by all consumers = O(1) vs O(overlordCount). |
| `Hatchery.ts` | `estimateSpawnTime`: does it call `PathFinder.search` to compute travel time, or use cached distance? Recomputing the path for prespawn on every tick is up to 15 CPU/call. Cache result in `GlobalCache` keyed by `source_id:spawn_id`. |
| `LogisticsNetwork.ts` | `requestTask` scoring loop: is it iterating all offers for every requesting creep? O(offers × creeps) = O(N²). Pre-sort offers by priority once per tick; binary-search or index by resource type. Ledger: are reservation objects `{ amount, creepId }` accumulating without cleanup when creep dies mid-task? |
| `MiningSite.ts` | `source` retrieved via `Game.getObjectById` every tick? Cache on heap; sources never move. `container` ID should be stored in Memory once found and retrieved by ID, not re-scanned with `FIND_STRUCTURES` every tick. |
| `LinkNetwork.ts` | `FIND_MY_STRUCTURES` filtered to links: cache link arrays on colony at RCL change events only — links are static until built/destroyed. Checking `link.cooldown` is free (property read); only skip the `transferEnergy` call, not the cooldown read. |

---

### System 3: Traffic & Pathfinding — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `TrafficManager.ts` | `reconcileTraffic` iterates all registered moves: confirm the move-intent map is cleared at the start of each tick (`moveIntents.clear()`), not accumulated across ticks. Recursive shove: every shove chain call costs ~0.3 CPU. Profile average chain depth — if > 5, the room layout has a bottleneck worth fixing. |
| `Zerg.ts` | `travelTo` per-creep: if using serialized direction string, the per-tick cost is negligible. If falling back to `PathFinder.search`, log it — even occasional fallbacks in dense rooms accumulate. `creep.pos.findInRange(FIND_HOSTILE_CREEPS, 5)` called every tick for stuck detection: cache hostile positions on the room object, not per-creep. |
| `Algorithms.ts` | `distanceTransform` and `minCut`: these are expensive (O(2500) for a 50×50 room). They must **never** be called speculatively or in a per-tick path. Verify both are guarded by `GlobalCache.has(key)` before running. |
| `TrafficManager.ts` (CostMatrix) | Road-health matrix: rebuilding a full `PathFinder.CostMatrix` (2500 cells) costs ~0.5 CPU. The 100-tick periodic rebuild is correct — verify it is not triggered by the 20%-HP decay check running every tick (only set a flag every tick; rebuild only when flag + tick interval align). |

---

### System 4: Spawning & Bootstrapping — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `Hatchery.ts` | `spawnQueue` sort: sort only when a new request is pushed, not on every tick. Use insertion sort (O(N)) since queue is nearly sorted after each push. |
| `CreepBody.ts` | `generateBody` iterates potential body configurations: is there memoization on `(bodyType, energyAvailable)` pairs? Same body is requested many times per season. Cache result in `GlobalCache` keyed by `bodyType:energyAvailable`. |
| `BootstrappingOverlord.ts` | Post-blackout: overlord scans all creeps to count miners/pioneers every tick? Pre-cache counts on `Colony` — same scan used by multiple overlords. |
| `ReserverOverlord.ts` | `Game.getObjectById(controllerId)` every tick: IDs are stable — cache on heap per room. |

---

### System 5: Logistics & Transport — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `TransporterOverlord.ts` | `FIND_MY_CREEPS` filtered to builders/upgraders (mobile container fallback): this must be done once per tick on the Colony object, not once per transporter creep. At 10 transporters doing it individually = 10 identical FIND calls. |
| `LogisticsNetwork.ts` | Memory tombstone/ruin entries: these decay and vanish. Are object IDs validated with `Game.getObjectById` before being served as tasks, or only when the creep arrives and finds nothing? Validate at task-creation time to avoid dispatching creeps to dead targets. |
| `RemoteMiningOverlord.ts` | `Memory.remoteMining[room].totalHarvested` incremented every tick by miner? That's a Memory write every tick → contributes to JSON bloat. Batch: increment a local counter, flush to Memory every 10 ticks. |
| `PickupTask.ts` / `WithdrawTask.ts` | `Game.getObjectById(targetId)` called in `isValidTarget()` every tick the creep is en-route. Cache result for the tick; the same task may call `isValidTarget()` and `work()` in the same tick, triggering two identical ID lookups. |

---

### System 6: Construction & Base Planning — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `BunkerLayout.ts` | `distanceTransform` used for anchor placement: result must be cached in `GlobalCache` forever (room terrain never changes). Key: `dt:${roomName}`. If called again after a global reset without the cache, it recalculates unnecessarily. |
| `ConstructionOverlord.ts` | `FIND_CONSTRUCTION_SITES` called every tick to check remaining sites: cache count; only re-find when a new site is placed or a site completes (detect via `Game.constructionSites` key-count delta). |
| `WorkerOverlord.ts` | `FIND_STRUCTURES` filtered to ramparts for repair targeting: do not re-sort the entire rampart list every tick. Sort once per 10 ticks; emergency resorts only when a rampart HP is detected below Tier 1 threshold. |
| `ParkingZones.ts` | Zone map: rebuilt when? If rebuilt every tick, that's expensive. Must be rebuilt only on RCL change or structure placement event (check `colony.structures.length` delta). |

---

### System 7: Defense & Combat — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `DefenseOverlord.ts` | Tower targeting: `room.find(FIND_HOSTILE_CREEPS)` — this should be cached on Colony for the tick, not called again inside DefenseOverlord. Tower `attack()` intent: confirm it is gated to fire only once per tower per tick (tower can only attack once; extra calls waste intent CPU). |
| `CombatZerg.ts` | `creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3)` every tick for `rangedMassAttack` decision: expensive. Cache all hostile positions on the room object at start of tick, then do distance check against cached array (pure JS math, no API call). |
| `GuardDirective.ts` | `controller.activateSafeMode()`: this is a one-time call; verify it is not called in a loop or on every tick when conditions are met. Safe once per 20k-tick cooldown. |

---

### System 8: Directives & Colonization — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `Directive.ts` | `Game.flags` iteration to find active directives: if done O(directives × flags) instead of a cached map, it scales poorly. Build a `Map<string, Flag>` from `Game.flags` once per tick at the top of `main.ts`; pass it to all directives. |
| `ColonizeDirective.ts` | Phase check: `targetRoom?.find(FIND_MY_SPAWNS)` every tick — this is a full room scan. Cache `phase` in Memory; only re-evaluate when `Game.time % 100 === 0` or on known events (spawn built, creep arrived). |
| `HarvestDirective.ts` | `Memory.remoteMining[room]` accessed per directive per tick: destructure to a local `const remMem = Memory.remoteMining[room]` at the top of `run()` to avoid repeated property chain lookups (each `Memory.remoteMining[room].x` = 3 property traversals). |

---

### System 9: Upgrading & Controller — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `UpgradingOverlord.ts` | Slot calculation: `getValidSlots()` runs a room scan. Cache slot assignments in Memory keyed by `controller_id`; rebuild only when upgrader count changes or controller position changes (never). |
| `ScoutOverlord.ts` | `Memory.worldState` is written every time the scout enters a room. If scout enters the same room many ticks in a row (pathing), it re-writes identical data. Gate: only write if `Game.time - lastSeen > 50` or data has changed. |

---

### System 10: Market, Terminal & Empire — CPU/Memory

| File | CPU/Memory Audit |
|---|---|
| `TerminalOverlord.ts` | `Game.market.getAllOrders()` — never call this in the main loop without caching. Result is a large array (~1000+ entries); cache on heap with 100-tick TTL. |
| `Logger.ts` | `RawMemory.segments[LOG_SEGMENT]` is read + written every tick. Read is free (already fetched by engine); write triggers a serialization. Gate: only write when new log entries exist (`pendingLogs.length > 0`). |
| `RoomScorer.ts` | `Game.map.getRoomLinearDistance` called in score loop for all candidate rooms: this is a pure math operation (fast), but if called for hundreds of rooms × multiple scoring factors = 1000s of calls. Cache room distances in a `Map<string, number>` per scoring session. |
| `types.d.ts` | Every undeclared Memory field becomes `any` → TypeScript skips type narrowing → potential runtime `undefined` dereference. Review: `Memory.remoteMining`, `Memory.worldState`, `Memory.rooms[r].queue`, `Memory.poiPaths`, `Memory.skRooms` — all added this session and must be declared. |

> **Cross-references:** All `FIND_*` caching items tie to §74 ($ caching module pattern). `PathFinder.search` reduction ties to §65/§82 (POI shared cache). Memory bloat cleanup ties to §67 (RawMemory circular buffer). O(N²) logistics loop fix ties to §73 (Gale-Shapley matching). `GlobalCache` TTL ties to §74 ($ caching expiry). Season 8 context (fixed 100 CPU) from §88 makes all of these higher-priority than in persistent world.

---

## 90. Flavor & Polish: DCC Theming, Creep Decorations, and Underutilized API Audit

---

### A. Dungeon Crawler Carl — Themed Public Sign & say Messages

Controller signs (100 chars, always public) and public `say` (10 chars, visible to anyone with vision) give personality to your empire on the shard map. DCC-themed options for each role:

```ts
// ─── CONTROLLER SIGNS (100 chars, placed by [MOVE] signer creep) ───────────
const DCC_SIGNS = [
    // Territorial declaration:
    "⚔️ CARL WAS HERE. Floor's mine now. Don't touch the loot goblin. — Carl",
    // Alliance warning:
    "This dungeon belongs to Carl. He has a Cat. Leave or the Cat bites.",
    "DUNGEON LEVEL 63: Claimed by Carl. Boss fights welcome. NPC hordes: 0/10.",
    // Humorous threat (harvested rooms):
    "Emperor Bob says this is his room. Carl disagrees. Carl wins. Always.",
    // Post-battle sign (cleared hostile room):
    "Room cleared by Carl. Loot recycled. Donut consumed. You're welcome, shard.",
    // Philosophical (idle room):
    "A dungeon without a dungeon crawler is just a hallway. — Carl, probably.",
];

// Signer creep assignment — random from pool each spawn cycle:
const sign = DCC_SIGNS[Math.floor(Math.random() * DCC_SIGNS.length)];
// creep.signController(controller, sign);

// ─── PUBLIC say MESSAGES (10 chars max, public=true) — by role ──────────────
const DCC_SAY: Record<string, string> = {
    // Roles with public flair (second arg = true for shard visibility):
    MiningOverlord:      "⛏️ LOOT!",   // Mining
    TransporterOverlord: "🎒 CARRY",   // Hauling
    DefenseOverlord:     "⚔️ BOSS!",   // Combat
    BootstrappingOverlord:"🌅 FLOOR1", // Just spawned
    WorkerOverlord:      "🔨BUILD",    // Building
    ScoutOverlord:       "👀 SCOUTING",// Scouting (10 chars)
    GuardDirective:      "HOLD LINE", // Defense
    ColonizeDirective:   "NEW FLOOR!", // Colonizing
    // Error state — Carl is never without a quip:
    ERROR:               "NOT GOOD!",  // Error
};
// creep.say(DCC_SAY[overlordName] ?? "...", /* public= */ true);
```

---

### B. Creep Decorations (Cosmetic Skins)

Decorations are **not controlled via code** — applied through the game UI only. Full system:

```
HOW TO OBTAIN:
  • Craft: convert 500 Pixels → 1 random Decoration (in Inventory → Pixelize)
  • Buy: Steam Community Market or in-game market (pixel bundles)
  • Generate pixels: Game.cpu.generatePixel() — costs 5,000 bucket units → 1 pixel
    (note: some sources say 5,000, others say 10,000 — verify in current game version)

RARITY SYSTEM:
  Rarity 1-4: fixed appearance assigned randomly on craft
  Rarity 5:   custom color picker — you choose the exact skin color ← most valuable

APPLYING VIA UI:
  Inventory → Decorations → Activate
  Options:
    • All creeps (empire-wide — every creep gets the skin)
    • Name filter: apply only to creeps whose name matches a pattern
      → Name your creeps after DCC characters for themed squad visuals:
        "Carl_Miner_01", "Donut_Scout", "Emperor_Bob_Guard"
      → Filter: "Carl_" → miners look one way; "Emperor_Bob_" → guards look another

TRADING:
  Transfer decoration from Screeps Inventory → Steam Inventory → sell on Steam Market
  Transfer back: Steam → Screeps (to equip after buying from another player)

CODE INTEGRATION (indirect — naming strategy):
  Hatchery.ts: name creeps with role-prefix matching decoration filter
```

```ts
// Naming convention in Hatchery — enables UI decoration filtering:
function generateCreepName(role: string, colonyName: string): string {
    const prefix = {
        miner:       'Carl',         // Carl-the-miner theming
        transporter: 'Donut',        // The cat / donut runner
        guard:       'EmperorBob',   // The villain
        scout:       'Bitch',        // Carl's partner (show name redacted)
        worker:      'Mordecai',     // Side character
        pioneer:     'Crawler',      // Generic dungeon crawler
    }[role] ?? 'Creep';
    return `${prefix}_${colonyName}_${Game.time % 10000}`;
}
// Then in UI: filter "Carl_" → all miners get the Carl decoration skin
```

---

### C. Underutilized Official API Audit — Features Not Yet In Codebase

Research of official docs reveals several powerful APIs completely absent from current implementation:

#### `StructureObserver` — Long-Range Vision
```ts
// Provides vision into any room within 10 rooms of observer (no creep needed)
// Call every tick to maintain persistent vision; one call = one tick of vision
observer.observeRoom('W10N10'); // 0.2 CPU intent

// Use case: replace ScoutOverlord for empire-scale monitoring
// Implementation: ObserverProcess cycles through priority rooms round-robin:
const OBSERVER_CYCLE_INTERVAL = 3; // observe 1 room every N ticks (1 observer)
const roomsToWatch = [...Memory.worldState keys sorted by staleness];
const targetRoom = roomsToWatch[Math.floor(Game.time / OBSERVER_CYCLE_INTERVAL) % roomsToWatch.length];
if (observer) observer.observeRoom(targetRoom);
// → eliminates need for scout creeps in surveilled rooms; 0 spawn cost
```

#### `PowerCreep` — Immortal Ability Units (GPL required)
```ts
// PowerCreeps are immortal: when they die, they respawn at any PowerSpawn
// Require GPL (Global Power Level) — earned by attacking Power Banks
// Key powers relevant to current codebase:
//   OPERATE_EXTENSION: fills all extensions from storage in 1 action → replace QueenOverlord
//   OPERATE_SPAWN:     speeds up spawn by 2× for 1000 ticks → critical for Season 8 rush
//   OPERATE_TOWER:     doubles tower damage (600→1200 at optimal) for 100 ticks
//   GENERATE_OPS:      generates Ops resource (used to activate other powers)
//   OPERATE_STORAGE:   increases storage capacity to 2,000,000 (double)

// PowerCreep spawn + renewal:
powerCreep.spawn(powerSpawn);    // initial spawn at a PowerSpawn structure
powerCreep.renew(powerSpawn);    // restore TTL (otherwise decays in 5000 ticks without renewal)
powerCreep.usePower(PWR_OPERATE_EXTENSION, storage); // activate power on target
```

#### `InterShardMemory` — Cross-Shard Coordination
```ts
// Each shard can write up to 100KB string to its own slot; all shards can read all slots
// 1-tick write latency (same as RawMemory segments)
InterShardMemory.setLocal(JSON.stringify({
    colonies: Object.keys(Game.rooms).filter(r => Game.rooms[r].controller?.my),
    credits: Game.market.credits,
    timestamp: Game.time,
}));

const shard0Data = JSON.parse(InterShardMemory.getRemote('shard0') ?? '{}');
// Use for: cross-shard market arbitrage, coordinated expansion, global threat maps
```

#### `flag.memory` — Directive Persistence Without Memory Key
```ts
// flag.memory is shorthand for Memory.flags[flag.name]
// Survives global resets alongside Memory — useful for directive state
Game.flags['HarvestW5N6'].memory.phase = 'ACTIVE';
Game.flags['HarvestW5N6'].memory.containerBuilt = true;
// Current codebase stores directive state in Memory.rooms[r] — flag.memory
// is cleaner (auto-GC'd when flag is removed, no orphan Memory cleanup needed)
```

#### `RoomVisual` — Debug Overlay (not yet used in codebase per §69 gap)
```ts
// Draw overlays visible only to you (not opponents) — 0 CPU cost, 1-tick duration
room.visual.text(`⚡${colony.storage?.store[RESOURCE_ENERGY] ?? 0}`, 25, 25, {
    color: '#ffff00', font: 0.7
});
room.visual.rect(creep.pos.x - 0.5, creep.pos.y - 0.5, 1, 1, {
    fill: 'transparent', stroke: '#ff0000', strokeWidth: 0.1
});
// Full §69 coverage: add to ProfilerProcess or a dedicated VisualsProcess
```

#### `Market` Commodities — Passive Income Pipeline (RCL 7+)
```ts
// Factories (RCL 7) produce commodities from minerals via recipes
// Sold to NPC buy orders for credits — passive credit income
// factory.produce(RESOURCE_WIRE); // example T1 commodity
// Current TerminalOverlord handles energy trading only
// Add: CommodityProcess to manage factory queue and market sales
```

> **Cross-references:** Observer replaces ScoutOverlord (§84 System 9 audit). PowerCreep OPERATE_SPAWN ties to §88 Season 8 100-CPU budget pressure. InterShardMemory extends §86 RawMemory alliance segment protocol. `flag.memory` is the cleaner backing store for §74 directive color system. Pixel farming for decorations ties to §87/§88 `generatePixel()` implementation. DCC say theming extends §86 emoji state vocabulary; sign theming extends §86 signController pattern.

---

## 91. Recent Screeps Changes Audit — Last 6 Months (Aug 2024 → Feb 2026)
**Research date: 2026-02-23. Each change assessed for codebase impact.**

> ✅ **IMPLEMENTED** v5.17 — Logger HTML output fixed. `log.*()` methods now route through `console.logUnsafe` via `Logger._emit()`. `logHTML()` added for intentional HTML. `setLevelByName` feedback uses `_emit`. Colored level badges + muted grey tag in all log output.

---

### January 2026 — Critical RCE Hotfix: console.log HTML Sanitization

**What changed:** `console.log` now **auto-strips HTML entities** server-side to patch a critical Remote Code Execution vulnerability (malicious HTML injection via console). New `console.logUnsafe` added for intentional HTML output (XSS risk now shifts to the player).

**Codebase impact — HIGH (breaking change for Logger.ts):**
```ts
// ❌ BEFORE (HTML stripped silently in production — colored output is text-only now):
console.log(`<span style="color:red">[ERROR]</span> ${msg}`);

// ✅ AFTER — use logUnsafe for intentional HTML:
(console as any).logUnsafe?.(`<span style="color:red">[ERROR]</span> ${safe_msg}`)
    ?? console.log(`[ERROR] ${msg}`);

// ACTION: Review Logger.ts — any console.log with HTML tags is now broken.
// Migrate colored log output to console.logUnsafe with script-tag sanitization.
// Already documented in §88, but this is the trigger: it's LIVE, not upcoming.
```

---

### December 2025 — 2026 Roadmap Announced (Future Changes to Prepare For)

| Roadmap Item | Status | Codebase Prep Needed |
|---|---|---|
| **ES Module support** (import/export, folder structure) | Planned | Restructure from CommonJS-style rollup to native ES modules. Blocked on current build config. |
| **New Premium Shard** — 1-second tick rate, Access Key gated | Planned | All per-tick logic needs profiling for 1s tick budget. `Game.cpu.getUsed()` guards everywhere. |
| **Commander & Executor PowerCreep classes** | In development | No prep yet — wait for official API docs when released. |
| **Warp Containers** — new logistics mechanic | Planned | Unknown API. Monitor release; likely replaces or complements LinkNetwork. |
| **Official VS Code extension** — console, memory, editor | Planned | No action needed — pure tooling improvement. |
| **Node.js runtime update** (latest version in Persistent World) | Planned | `Date` object availability may change. Audit any `new Date()` usage — Arena already blocks it. |

---

### November 2025 — Minor Patch (No Detailed Notes)
No functional changes documented. Likely dependency updates or server-side infrastructure. No codebase action required.

---

### September–November 2024 — Season 7: Score-Resource Collection Mechanic

**What changed:** Season 7 introduced a **novel scoring mechanic** completely different from Season 8's room-ownership model: random "score resources" spawned across all rooms, and players had to physically collect and deliver them to **crossroad structures** (initially blocked by walls that required demolition).

**This mechanic is not in our codebase at all:**
```ts
// Season 7 mechanic (for reference / future seasons):
// 1. FIND_DROPPED_RESOURCES (or custom resource type) scattered in rooms
// 2. Special "score deposit" structure in crossroad rooms (highway intersections)
// 3. Wall-busting phase: WORK creeps dismantle walls blocking the deposit structure
// 4. Delivery phase: haul score resources to deposit → points accumulated

// Season 7 rules (same as Season 8 baseline — confirmed these are standard seasonal rules):
// - 100 CPU flat (no GCL scaling) ✅ §88 documents this
// - No market ✅ §88 documents this
// - Terminals: own-terminals only ✅ §88 documents this
// - GCL/GPL start at 1 ✅ always true for seasons

// Season 7 unique constraint NOT in Season 8:
// - Only 1 spawn per room regardless of RCL (Season 8 appears to allow normal spawn count)
// Action: verify Season 8 spawn limit before finalizing Hatchery logic
```

**Codebase action — Score-Resource Delivery Overlord (future seasons):**
```ts
// When a season uses score-resource delivery mechanic:
// ScoreCollectorOverlord: FIND score resources → carry to deposit structure
// WallBusterOverlord: detect blocking wall → send WORK creeps → dismantle()
// CrossroadScout: observe/scout crossroad rooms to locate deposit structures
// These are separate from §87 military CONTROLLER_ATTACK and §79 Source Keeper logic
```

---

### August 2024 — Season 7 Announced / Season Meta Analysis

Season 7's "upper areas rich, lower areas scarce" asymmetric world (⅔ of 2-source rooms in upper half) validated the **apex migration meta** that Season 8's Pyramid Map now formalizes with explicit scoring tiers. The source-density gradient created natural incentive to push toward specific coordinates — exactly what §88's `getSectorLevel()` function implements.

---

### Persistent World — No Material API Changes (Aug 2024 – Feb 2026)

Outside of the console sanitization hotfix, the **Persistent World API has not changed** in the last 6 months. All existing codebase functionality remains valid. Key non-changes confirmed:
- `PathFinder`, `Memory`, `RawMemory`, `FIND_*` constants: unchanged
- Structure APIs (Spawn, Tower, Link, Terminal, Factory): unchanged
- Creep body part costs and tick limits: unchanged
- CPU bucket mechanics: unchanged
- `Game.market` API: unchanged (market is disabled only in seasonal worlds)

---

### Summary: Action Items by Priority

| Priority | Change | Action | File(s) |
|---|---|---|---|
| 🔴 **IMMEDIATE** | RCE hotfix — console.log no longer outputs HTML | Migrate colored Logger output to `console.logUnsafe` with sanitization | `Logger.ts` |
| 🟡 **Before Season 8 (Mar 1)** | Verify Season 8 spawn-per-room limit (S7 was 1 spawn/room) | Check official S8 announcement for spawn cap; adjust `Hatchery` if needed | `Hatchery.ts` |
| 🟢 **Future** | ES module restructure when Premium Shard launches | No action yet — monitor release |  — |
| 🟢 **Future** | Commander/Executor PowerCreep classes | No action yet — wait for API docs | — |
| 🟢 **Future** | Warp Containers | No action yet — monitor release; likely extends `LinkNetwork.ts` | — |
| 🟢 **Future seasons** | Score-resource delivery mechanic (if reused) | ScoreCollectorOverlord + WallBusterOverlord scaffolding | new files |

> **Cross-references:** `console.logUnsafe` migration is the same change documented in §86/§88. Season 7 100-CPU flat / no-market / own-terminal rules confirm §88 Season Mode Flag is the correct generalization. Pyramid scoring derives from Season 7's source-density gradient insight. Score-resource WallBuster overlord would use the same `dismantle()` call as §79 Cleaner FSM.

---

## 92. Claude Report 2 — Live-Verified Bug Fixes

> ✅ **IMPLEMENTED** v5.17 — Bug F (`_traceCache`) confirmed already had 200-key clear guard. Bug G (`Transporter.ts`) deleted with its test file. Concern 2 (BunkerLayout road/tower overlap) confirmed non-issue — `addRoad()` checks `OCCUPIED` set which includes all tower positions.

> **Audit method:** Every file named in the report was read from disk before writing backlog entries.
> Many reported bugs are already fixed. Only confirmed-live issues appear below.

### Already Fixed — Do Not Implement

| Report ID | Claim | Actual Status |
|---|---|---|
| **Bug A** | TransporterOverlord missing `memory: { role: "transporter" }` | **FIXED** — `wishlistSpawns()` line 248 includes `memory: { role: "transporter" }` |
| **Bug B** | `WithdrawTask.isValid()` doesn't check for resources | **FIXED** — line 45-47 checks `store.getUsedCapacity(RESOURCE_ENERGY) > 0` |
| **Bug C** | `MiningSite.calculateDistance()` no incomplete-path handling | **FIXED** — line 242-244 has `returnPath.incomplete` linear-distance fallback with `distance = 10` minimum |
| **Bug D** | `ColonyProcess.colonies` static registry never cleaned | **FIXED** — `ColonyProcess` has no static registry; Colony stored on instance via `GlobalCache.rehydrate()` (auto-evicts with process) |
| **Bug E** | `TrafficManager.shove()` operator precedence | **MOOT** — `shove()` no longer exists; bipartite matching replaced it entirely |
| **Dead 3** | `HeapCache._kernelInstance` never read | Verify separately — not in scope of this section |
| **Dead 4** | `Process.shouldWake()` never called | Verify separately |
| **Dead 5** | `LogisticsNetwork.requestOutput()` dead code | **WRONG** — called at `MiningSite.ts:361` (`this.colony.logistics.requestOutput(this.containerId)`) |
| **Dead 2** | `CreepMemory.pid`, `targetId`, `homeRoom`, `working` unused | Harmless — `[key: string]: any` index sig makes them safe; leave for future use |

---

### Feature: Fix `ErrorMapper._traceCache` Unbounded Growth (Bug F)
**File:** [`kernel/ErrorMapper.ts`](file:///c:/code/screeps/src/kernel/ErrorMapper.ts) — line 43

**Confirmed live:** `_traceCache: Record<string, string> = {}` has no eviction.

```ts
// Current (unbounded):
const _traceCache: Record<string, string> = {};

// Fix: cap at 200 entries, evict oldest when full
const TRACE_CACHE_MAX = 200;
const _traceCache: Record<string, string> = {};
const _traceCacheKeys: string[] = []; // insertion-order LRU queue

function getCachedTrace(rawStack: string): string | undefined {
    return _traceCache[rawStack];
}
function setCachedTrace(rawStack: string, mapped: string): void {
    if (_traceCacheKeys.length >= TRACE_CACHE_MAX) {
        const evict = _traceCacheKeys.shift()!;
        delete _traceCache[evict];
    }
    _traceCache[rawStack] = mapped;
    _traceCacheKeys.push(rawStack);
}
// Replace direct _traceCache[stack] reads/writes with getCachedTrace/setCachedTrace
```

**Risk:** Low. Only matters during sustained error storms with unique stack traces (tick numbers, creep names in error messages). Prevents unbounded heap growth in prod.

---

### Feature: Fix `Colony.registerZerg()` — Always Creates Base `Zerg` (Bug G + Dead Code 1)
**Files:**
- [`os/colony/Colony.ts`](file:///c:/code/screeps/src/os/colony/Colony.ts) — `registerZerg()` line 163-170
- [`os/zerg/Transporter.ts`](file:///c:/code/screeps/src/os/zerg/Transporter.ts) — entire class never instantiated

**Confirmed live:** `registerZerg()` always calls `new Zerg(creep.name)`. `Transporter` class exists with `run()` override and `repairRoad()` method, but `new Transporter()` is never called anywhere. `TransporterOverlord` already inlines road repair at line 44-46 to compensate, so there's **no functional regression** — but the `Transporter` class is pure dead weight.

**Two-part fix:**

*Option A — Delete `Transporter.ts`, keep inline repair (simpler):*
```ts
// TransporterOverlord already does this inline (line 44-46) — Transporter.ts is redundant.
// Delete Transporter.ts. Zero behavior change.
```

*Option B — Wire up `Transporter` subclass properly (original design intent):*
```ts
// In Colony.registerZerg() — dispatch to typed subclass based on role:
registerZerg(creep: Creep): Zerg {
    let zerg = this.zergs.get(creep.name);
    if (!zerg) {
        const role = (creep.memory as any)?.role;
        // Instantiate the correct subclass so run() overrides fire correctly
        if (role === 'transporter') {
            const overlord = this.overlords.find(o => o instanceof TransporterOverlord);
            zerg = new Transporter(creep.name, overlord!);
        } else {
            zerg = new Zerg(creep.name);
        }
        this.zergs.set(creep.name, zerg);
    }
    return zerg;
}
// Then remove inline road repair from TransporterOverlord.run() (it's now in Transporter.run())
```

**Recommendation:** Option A unless the Transporter subclass will grow more logic (e.g., future road repair intelligence). Option B if you want the architecture to match the original design and plan to add per-role run() overrides for other roles like Miner, Worker, etc.

---

### Feature: Fix BunkerLayout Road/Tower Position Overlap (Concern 2)
**File:** [`os/infrastructure/BunkerLayout.ts`](file:///c:/code/screeps/src/os/infrastructure/BunkerLayout.ts)

**Claim:** Road corners `{ x:-1,y:-1 }, { x:1,y:-1 }, { x:-1,y:1 }, { x:1,y:1 }` overlap with tower positions. Need to verify against actual BunkerLayout constants:

```ts
// Verify: read the actual tower and road offset arrays from BunkerLayout.ts
// If towers = [{ x:-1,y:-1 }, ...] AND roads include same offsets:
// → createConstructionSite(STRUCTURE_ROAD) returns ERR_INVALID_TARGET silently
// → Wasted CPU every ConstructionOverlord tick on a site that can never be placed

// Fix: filter road positions against tower positions before placement:
const towerOffsets = new Set(BUNKER_TOWERS.map(t => `${t.x},${t.y}`));
const placeableRoads = BUNKER_ROADS.filter(r => !towerOffsets.has(`${r.x},${r.y}`));
// Use placeableRoads for construction site creation
```

> **Note:** This concern requires verifying the actual offset arrays in `BunkerLayout.ts` before implementing. The fix is trivial (Set intersection filter) but the bug claim needs coordinate verification first.

> **Cross-references:** Bug F ties to §89 System 1 `ErrorMapper.ts` CPU/memory audit (`_traceCache` unbounded). Bug G `Transporter` dead code ties to §84 System 3 audit (Zerg subclass instantiation). BunkerLayout concern ties to §84 System 6 audit (road/tower ERR_INVALID_TARGET CPU waste) and §83/§76 rampart repair tiering (tower placement is load-bearing).

---

## 93. Safe Mode Enhancements — Three Confirmed Gaps in `DefenseOverlord.ts`

> ✅ **IMPLEMENTED** v5.18 — All three gaps addressed in `DefenseOverlord.ts`: (1) NPC invaders with ATTACK/WORK now in breach check via `npcThreat` split. (2) Critical structure HP% trigger at 30% fires when hostiles present. (3) `shouldUseSafeMode()` guards both fire sites — conserves last charge against manageable NPC waves.

> **Audit:** Full `DefenseOverlord.ts` read. Current safe mode has two triggers:
> 1. **Blackout guard** (line 286-300): any attack-capable hostile during critical blackout → instant safe mode
> 2. **Pathfinding breach** (line 302-333): PathFinder can find route from spawn to hostile through walls → safe mode
>    - ⚠️ Filters `owner.username === "Invader"` — NPC invaders **cannot trigger** this path
>
> Three gaps confirmed below.

---

### Feature 1: Critical Structure HP% Trigger — Ranged Attacks Before Breach
**File:** [`os/overlords/DefenseOverlord.ts`](file:///c:/code/screeps/src/os/overlords/DefenseOverlord.ts) — add after line 333

Ranged attackers (RANGED_ATTACK creeps) can destroy storage, terminal, spawn, or towers from outside the wall ring without ever breaching ramparts. The pathfinding check never fires because walls+ramparts are intact. Storage with 500k energy is more valuable than a spawn — losing it is catastrophic.

```ts
// Add after the pathBreached block (line 333), before tower firing:
// ── Critical Structure HP% Trigger ──────────────────────────────────────
// If any critical structure drops below 30% HP during active combat, activate
// safe mode — even if walls are intact. Covers ranged attacks from outside.
const CRITICAL_STRUCTURES: StructureConstant[] = [
    STRUCTURE_SPAWN, STRUCTURE_STORAGE, STRUCTURE_TERMINAL, STRUCTURE_TOWER
];
const SAFE_MODE_HP_THRESHOLD = 0.30; // 30% HP remaining

const ctrl = room.controller;
if (!pathBreached && dangerousHostiles.length > 0 &&
    ctrl && ctrl.safeModeAvailable > 0 && !ctrl.safeMode && !ctrl.safeModeCooldown) {

    const criticalDamaged = room.find(FIND_MY_STRUCTURES).find(s =>
        CRITICAL_STRUCTURES.includes(s.structureType) &&
        s.hits / s.hitsMax < SAFE_MODE_HP_THRESHOLD
    );
    if (criticalDamaged) {
        ctrl.activateSafeMode();
        log.error(`CRITICAL STRUCTURE DAMAGE: ${criticalDamaged.structureType} at ${Math.round(criticalDamaged.hits/criticalDamaged.hitsMax*100)}% HP. Safe mode activated in ${room.name}!`);
    }
}
```

---

### Feature 2: Include NPC Invaders in Pathfinding Breach Check
**File:** [`os/overlords/DefenseOverlord.ts`](file:///c:/code/screeps/src/os/overlords/DefenseOverlord.ts) — line 306-311

Current code explicitly excludes `owner.username === "Invader"` from the `dangerousHostiles` filter used for the pathfinding breach check. NPC invaders CAN breach ramparts (WORK parts dismantle, ATTACK parts hit walls). If they get through, the spawn dies. The blackout guard only covers the already-critical-blackout case.

```ts
// Current (line 306-311) — excludes Invaders from pathfinding breach:
const dangerousHostiles = hostiles.filter(h =>
    h.owner.username !== "Invader" &&   // ← Gap: NPC invaders can breach too
    (h.getActiveBodyparts(ATTACK) > 0 ||
     h.getActiveBodyparts(RANGED_ATTACK) > 0 ||
     h.getActiveBodyparts(WORK) > 0)
);

// Fix — split into two threat classes:
// Player hostiles: always trigger safe mode on breach (they're targeting you)
const playerThreat = hostiles.filter(h =>
    h.owner.username !== "Invader" && h.owner.username !== "Source Keeper" &&
    (h.getActiveBodyparts(ATTACK) > 0 ||
     h.getActiveBodyparts(RANGED_ATTACK) > 0 ||
     h.getActiveBodyparts(WORK) > 0)
);

// NPC invaders: trigger safe mode on breach only if they have ATTACK/WORK
// (pure RANGED_ATTACK NPC invaders stay outside — usually fine with towers)
const npcThreat = hostiles.filter(h =>
    h.owner.username === "Invader" &&
    (h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(WORK) > 0)
);

const dangerousHostiles = [...playerThreat, ...npcThreat];
// pathfinding breach check then uses dangerousHostiles (unchanged below)
```

---

### Feature 3: Last-Charge Safe Mode Conservation
**File:** [`os/overlords/DefenseOverlord.ts`](file:///c:/code/screeps/src/os/overlords/DefenseOverlord.ts) — wrap both `activateSafeMode()` call sites

Safe mode charges are earned by attacking Power Banks (GPL) or buying them (expensive). At RCL 3-4 you typically have only the 1 starting charge. Burning it on an NPC invader wave that towers can handle, or on a skirmish that a single defender can resolve, wastes a 20,000-tick protection window.

```ts
// Helper: should we actually spend a safe mode charge right now?
function shouldUseSafeMode(
    ctrl: StructureController,
    room: Room,
    hostiles: Creep[],
    reason: 'blackout' | 'breach' | 'hp_threshold'
): boolean {
    if (ctrl.safeModeAvailable === 0) return false;
    if (ctrl.safeMode) return false;
    if (ctrl.safeModeCooldown) return false;

    // Conservation: if this is our last charge, don't use it on pure NPC waves
    // (towers + 1 defender can handle them; NPC waves leave in ≤1500 ticks)
    const isLastCharge = ctrl.safeModeAvailable === 1;
    const allNpc = hostiles.every(h =>
        h.owner.username === "Invader" || h.owner.username === "Source Keeper"
    );
    if (isLastCharge && allNpc && reason === 'breach') {
        // Only override conservation if: towers are dead (0 towers) OR it's a
        // critical blackout (no spawn → NPC wins even without breaking walls)
        const hasTowers = room.find(FIND_MY_STRUCTURES, {
            filter: (s: AnyOwnedStructure) => s.structureType === STRUCTURE_TOWER
        }).length > 0;
        if (hasTowers && !room.controller?.my || reason !== 'blackout') {
            log.warning(`Conserving last safe mode charge — NPC wave, towers still active.`);
            return false;
        }
    }

    return true;
}

// Both activateSafeMode() call sites then become:
if (shouldUseSafeMode(ctrl, room, hostiles, 'blackout')) {
    ctrl.activateSafeMode();
}
// and:
if (shouldUseSafeMode(room.controller!, room, dangerousHostiles, 'breach')) {
    room.controller!.activateSafeMode();
}
```

> **Cross-references:** Safe mode breach detection ties to §77/§78 InvaderCore defense (InvaderCore siege triggers same breach condition). Feature 2 NPC threat inclusion ties to §84 System 7 DefenseOverlord audit. Feature 3 last-charge conservation ties to §87 private server admin (can manually add safe mode charges for testing). Feature 1 HP% trigger ties to §76 rampart HP tiers (if ramparts fall to 30%, safe mode buys time to repair).
