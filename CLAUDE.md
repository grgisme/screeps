# CLAUDE.md — AI Assistant Guide for Screeps Bot

This document helps AI assistants understand the codebase structure, conventions, and workflows for this Screeps bot project. Read it before making changes.

---

## Project Overview

This is a **TypeScript bot for [Screeps](https://screeps.com/)** — a real-time strategy MMO where you write JavaScript/TypeScript to control units called "creeps". The bot implements a custom OS-style kernel with process scheduling, resource management, and colony automation.

**Current version:** 4.11 (see `src/version.ts`)

---

## Quick Reference

| Task | Command |
|------|---------|
| Run tests | `npm test` |
| Build once | `npm run build` |
| Watch mode | `npm run watch` |
| Build & upload to Screeps | `npm run upload` |
| Full release (version bump + build + upload + git) | `npm run sync` |

---

## Architecture: 3-Layer Design

```
Kernel Layer    (src/kernel/)   — Scheduler, CPU governor, process lifecycle
OS Layer        (src/os/)       — Colony, overlords, directives, tasks, creep wrappers
Infrastructure  (src/os/infrastructure/) — Bunker layout, traffic management
```

### Layer responsibilities

**Kernel (`src/kernel/`)**
- `Kernel.ts` — Bucketed priority scheduler, 3-tier CPU governor (NORMAL/SAFE/EMERGENCY), O(1) wake map
- `Process.ts` — Abstract base class for all processes; implements sleep/wake/run contracts
- `GlobalCache.ts` — Heap-first state management; serializes to `Memory.heap`; detects global resets
- `GlobalManager.ts` — Bootstraps one `ColonyProcess` per room each tick
- `ErrorMapper.ts` — Resolves source-map stack traces from the bundled output
- `memory/SegmentManager.ts` — Manages raw memory segments

**OS Layer (`src/os/`)**
- `colony/Colony.ts` — Central room coordinator: owns overlords, directives, creep roster, logistics, links
- `colony/Hatchery.ts` — Spawn queue, priority logic, emergency mode, body-part scaling
- `colony/LogisticsNetwork.ts` — Resource request/offer matching with virtual reservation ledgers
- `colony/LinkNetwork.ts` — Energy transfers between links; hub topology
- `colony/MiningSite.ts` — Tracks a source + associated infrastructure
- `overlords/Overlord.ts` — Abstract base for all task managers; handles subreaper orphan adoption
- `overlords/*.ts` — 12 concrete overlord roles (Mining, Transporter, Worker, Upgrading, Construction, Defense, Destroyer, RemoteMining, Reserver, Scout, Filler, Bootstrapping, Terminal)
- `directives/Directive.ts` — Abstract base for flag-driven mission objectives
- `tasks/ITask.ts` + 8 implementations — Atomic, serializable creep actions
- `zerg/Zerg.ts` — Creep wrapper with intent caching and movement
- `zerg/*.ts` — Role-specialized Zerg subclasses (Miner, Transporter, CombatZerg, Upgrader, Worker)

**Infrastructure (`src/os/infrastructure/`)**
- `BunkerLayout.ts` — 13×13 base blueprint with coordinate system
- `TrafficManager.ts` — Priority-based movement resolution; runs after all processes

---

## Directory Structure

```
src/
├── main.ts                     # Game loop entry point
├── version.ts                  # SCRIPT_VERSION, SCRIPT_SUMMARY constants
├── types.d.ts                  # Global type declarations
├── kernel/                     # OS kernel
│   ├── Kernel.ts
│   ├── Process.ts
│   ├── ProcessStatus.ts        # ALIVE, SLEEP, DEAD constants
│   ├── GlobalCache.ts
│   ├── GlobalManager.ts
│   ├── ErrorMapper.ts
│   └── memory/SegmentManager.ts
├── os/
│   ├── colony/                 # Room-level coordination
│   ├── overlords/              # 12 creep role managers
│   ├── directives/             # Flag-driven missions
│   ├── tasks/                  # 9 atomic task types
│   ├── zerg/                   # Creep wrappers
│   ├── infrastructure/         # Layout + traffic
│   └── processes/              # ColonyProcess, ProfilerProcess
└── utils/
    ├── Logger.ts               # Leveled logging with emoji prefixes
    ├── Algorithms.ts           # Min-cut, flood fill, pathfinding helpers
    ├── CreepBody.ts            # Body-part template scaling
    └── RoomPosition.ts         # Position utilities

test/                           # Mocha + Chai unit tests (mirrors src/)
docs/                           # 19-page GitHub Pages documentation
dist/                           # Rollup build output (gitignored)
```

---

## Game Loop (`src/main.ts`)

Every Screeps tick executes `loop()` in this order:

1. Clean up memory for dead creeps
2. Detect global reset; restore Kernel from `Memory.kernel`
3. Prune stale colony entries
4. `GlobalManager.run()` — bootstrap one ColonyProcess per room
5. Ensure ProfilerProcess is registered
6. `kernel.run()` — scheduler executes all alive processes by priority
7. Print foundation status on first tick after reset
8. `TrafficManager.run()` — resolve all pending movement intents
9. Commit state (heap, memory, segments)
10. Log heap usage report

---

## Key Design Patterns

### 1. V8 Getter Pattern (critical — always follow this)
Never store live `Game` objects in heap-persisted class properties. Access them via getters to avoid V8 memory leaks across ticks:

```typescript
// WRONG — stale reference after tick boundary
this.creep = Game.creeps['worker1'];

// CORRECT — fresh lookup each tick
private _creepName: string;
get creep(): Creep | undefined {
    return Game.creeps[this._creepName];
}
```

### 2. Inversion of Control
- **Overlord** (brain) — decides which task to assign
- **Task** (instruction) — encapsulates a single atomic action
- **Zerg** (hand) — executes whatever task it holds, blind to strategy

### 3. Subreaper Orphan Adoption
Creeps store `memory._overlord = overlordId` at spawn time. Overlords reconstruct their creep roster each tick by filtering `colony.creeps` — no serialization of live object references.

### 4. Intent Caching
`Zerg` tracks per-pipeline boolean flags (`hasWorkIntent`, `hasTransferIntent`, etc.) to prevent duplicate Screeps API calls within a tick. Duplicate calls are silently ignored by the engine.

### 5. Multi-layer Serialization (global reset resilience)

| Data | Persisted to |
|------|-------------|
| Process table | `Memory.kernel.processTable` |
| Creep tasks | `CreepMemory.task` |
| Arbitrary objects | `Memory.heap[key]` via GlobalCache |
| Creep → overlord mapping | `CreepMemory._overlord` |
| Colony state | `Memory.colonies[name]` |

### 6. Temporal Throttling
Spread expensive periodic work across ticks to avoid CPU spikes:

```typescript
if (Game.time % 100 === 3)  { /* cleanup */     }
if (Game.time % 100 === 47) { /* heap report */  }
```

### 7. Spawn Commitment Handshake
Three-phase tracking via `GlobalCache.pendingSpawns` prevents double-spawning:
1. **Commit** — `spawnCreep()` returns OK → name added to pending set
2. **Spawning** — creep exists but `spawning === true` → still in set
3. **Alive** — creep exists and `spawning === false` → removed from set

### 8. Virtual Capacity Ledgers
Avoid double-spending shared resources by tracking virtual availability:

```typescript
let virtualEnergy = room.energyAvailable;
for (const request of spawnQueue) {
    if (virtualEnergy >= request.cost) {
        virtualEnergy -= request.cost; // claim without spending
        commit(request);
    }
}
```

### 9. Stateless Ledger Rebuild
Logistics reservation ledgers are rebuilt from scratch each tick by scanning active Zerg tasks — no stale-entry cleanup required.

---

## TypeScript Conventions

- **Strict mode** throughout: no implicit `any`, no unused variables, complete return types
- **One class per file**, named to match the file (e.g., `Colony.ts` exports `Colony`)
- **Decorators enabled** (`experimentalDecorators`, `emitDecoratorMetadata`)
- **`import type`** for type-only cross-layer imports to prevent circular dependencies
- **Source maps** embedded in bundle for `ErrorMapper` stack trace resolution
- **No `console.log`** — use `Logger` from `src/utils/Logger.ts` with appropriate log level

### Logger usage

```typescript
import { Logger } from '../utils/Logger';

Logger.debug('Detailed trace info');
Logger.info('Normal operational message');
Logger.warning('Non-fatal issue');
Logger.error('Something went wrong');
```

---

## Testing

**Framework:** Mocha + Chai (BDD-style)

**Run tests:** `npm test`

**Test location:** `test/` — mirrors `src/` structure

**Mock setup:** `test/mock.setup.ts` provides simulated Screeps globals (`Game`, `Memory`, `RoomPosition`, `PathFinder`, Screeps constants).

When writing tests:
- Import mocks via `mock.setup.ts` before importing source modules
- Use `sinon` stubs if you need to spy on Screeps API calls
- Rebuild the mock `Game` state before each test case

---

## Build System

**Bundler:** Rollup
**Entry:** `src/main.ts`
**Output:** `dist/main.js` (CommonJS) + `dist/main.js.map`

Key Rollup plugins:
- `@rollup/plugin-typescript` — compiles TypeScript
- `@rollup/plugin-node-resolve` — resolves `node_modules`
- `@rollup/plugin-commonjs` — CJS interop
- `rollup-plugin-clear` — clears `dist/` before build

The build produces a **single CommonJS file** because Screeps's runtime only accepts one JS file per account.

---

## Deployment

### Prerequisites
Create `.screeps.json` in the project root (gitignored):

```json
{
  "email": "your@email.com",
  "password": "your_password",
  "branch": "default",
  "ptr": false
}
```

### Deploy commands

```bash
npm run upload   # Build and upload to Screeps
npm run sync     # Full release: bump version, build, upload, commit to git
```

`sync.js` reads `src/version.ts`, increments the patch version, updates the file, runs `npm run build`, calls `upload.js`, then makes a git commit.

---

## Console Commands (in-game)

These functions are exposed globally and callable from the Screeps web console:

```javascript
setLogLevel("debug")   // "debug" | "info" | "warning" | "error"
resetBot()             // Wipe Memory + heap and force full bootstrap
testError()            // Trigger a deep error to verify source-map resolution
```

---

## Process Scheduling

The `Kernel` runs a bucketed priority queue. Priorities are numeric (lower = higher priority). The CPU governor adjusts how many buckets are processed based on `Game.cpu.bucket`:

| Mode | Condition | Behavior |
|------|-----------|----------|
| NORMAL | bucket > threshold | Run all priority buckets |
| SAFE | bucket moderate | Skip low-priority buckets |
| EMERGENCY | bucket critical | Run only essential processes |

Processes can call `this.sleep(ticks)` to suspend and `this.wake()` to resume. The kernel's O(1) wake map efficiently handles tick-based wakeups.

---

## Adding a New Overlord

1. Create `src/os/overlords/MyRoleOverlord.ts`, extend `Overlord`
2. Implement `run()`: assign tasks to `this.zerg`, request spawns via `this.wishlist()`
3. Register the overlord in `Colony.ts` initialization
4. Add corresponding `Zerg` subclass in `src/os/zerg/` if specialized behavior is needed
5. Write tests in `test/os/Overlord.test.ts` or a new file

---

## Adding a New Task

1. Create `src/os/tasks/MyTask.ts`, implement `ITask` interface
2. Implement `isValid()`, `run()`, and serialization (`serialize()`/`deserialize()`)
3. Register the task type in the task deserializer map (see existing tasks for pattern)
4. Add tests in `test/os/`

---

## Adding a New Process

1. Create `src/os/processes/MyProcess.ts`, extend `Process`
2. Implement `run()` (or a generator-based coroutine)
3. Register in `GlobalManager.ts` or at the appropriate bootstrap point
4. Define a stable priority constant

---

## Common Pitfalls

- **Storing `Game` objects in Memory or heap** — always use name/id strings + getters
- **Calling the same Screeps API action twice per tick** — check `hasXxxIntent` flags on Zerg
- **Forgetting temporal throttling** — expensive scans every tick will hit the CPU bucket hard
- **Not handling global resets** — always restore state from `Memory` on tick 1 after reset
- **Circular imports** — use `import type` for type-only cross-layer dependencies

---

## Documentation

Full architecture documentation lives in `docs/` and is published to GitHub Pages:

- `docs/architecture.md` — system design and data flow
- `docs/kernel.md` — scheduler, CPU governor, process lifecycle
- `docs/design-patterns.md` — 9 key patterns with code examples
- `docs/colony.md` — colony coordinator and initialization
- `docs/overlords.md` — task managers and creep adoption
- `docs/tasks.md` — task interface and atomicity guarantees
- `docs/zerg.md` — creep wrappers, intent caching, movement
- `docs/logistics.md` — resource request/offer matching
- `docs/bunker-layout.md` — 13×13 base blueprint
- `docs/traffic-manager.md` — movement resolution algorithm
- `docs/global-cache.md` — heap-first storage and rehydration
- `docs/main-loop.md` — tick lifecycle walkthrough

---

## Dependencies Summary

| Package | Role |
|---------|------|
| `typescript` | Compiler |
| `rollup` + plugins | Bundler |
| `@types/screeps` | Screeps API type definitions |
| `screeps-api` | Upload client |
| `screeps-profiler` | CPU profiling |
| `mocha` + `chai` | Test runner + assertions |
| `ts-node` | TypeScript runtime for tests |
| `source-map` | Stack trace resolution |
| `dotenv` | Local environment variables |
