# Screeps OS Architecture

This document describes the internal architecture of the Screeps bot's Operating System.

## Overview

```
┌─────────────────────────────────────────────────┐
│                   main.ts loop                  │
│  1. Clean dead Memory.creeps                    │
│  2. Detect global reset → rehydrate Kernel      │
│  3. Ensure ProfilerProcess exists               │
│  4. kernel.run()  (priority scheduler)          │
│  5. kernel.serialize() → Memory.kernel          │
└─────────────────────────────────────────────────┘
         │
         ▼
```
┌─────────────────────────────────────────────────┐
│                    Kernel                        │
│  ProcessTable: Map<PID, Process>                │
└─────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────┐      ┌─────────────────────────┐
│  ColonyProcess    │      │  Legacy Processes       │
│  (1 per Room)     │      │  (Mining/Upgrade)       │
└───────────────────┘      └─────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│                    Colony                        │
│  Hub for Overlords & State                      │
└─────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐  ┌──────────────────┐
│ MiningOverlord   │  │ ConstructOverlord│
└──────────────────┘  └──────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────────────────────────────────────┐
│                    Zerg                          │
│  Creep wrapper with heap-cached pathing         │
└─────────────────────────────────────────────────┘
```

## Diagnostics Layer

### ErrorMapper (source-map)

Uses `source-map` v0.6.x to parse the inline source map embedded in the Rollup bundle. On any uncaught error:

1. Lazily initializes a `SourceMapConsumer` from the base64 inline map
2. Rewrites stack frames from `main.js:XXX` to `src/kernel/Kernel.ts:42`
3. Outputs color-coded HTML to the Screeps console
4. The Kernel also uses `ErrorMapper.mapTrace()` for per-process crash traces

### Logger

Structured logging with 4 levels:

| Level | Value | Color | Use |
|---|---|---|---|
| DEBUG | 0 | Grey | Detailed trace output |
| INFO | 1 | Green | Normal operational messages |
| WARNING | 2 | Orange | Issues that need attention |
| ERROR | 3 | Red | Critical failures |

- Default level: **INFO**
- Persisted in `Memory.logLevel` (survives resets)
- Change at runtime: `setLogLevel('debug')` in Screeps console

### ProfilerProcess (Priority 0)

- Runs **before** all other processes every tick
- Reads CPU deltas recorded by the Kernel scheduler
- Accumulates per-process CPU usage over a rolling 20-tick window
- Outputs a formatted report: "Top CPU Consumers: [name] - [X]ms"
- Heap-only state (not serialized to Memory)

## Kernel Lifecycle

### Global Reset Detection

1. `GlobalCache.isGlobalReset()` checks `_heap._initialized`
2. Records `Memory.kernel.lastGlobalReset = Game.time`  
3. If reset → `rehydrateKernel()` deserializes from Memory + caches on heap
4. Otherwise → loads cached kernel from heap

### Scheduler with CPU Profiling

```
sorted = processTable sorted by priority (ascending)
cpuProfile = new Map()
for each process in sorted:
    if CPU ≥ limit * 0.9 → break
    if bucket < 500 → break
    if process.isAlive():
        cpuBefore = getUsed()
        try: process.run()
        catch: mapTrace(error), process.terminate()
        cpuAfter = getUsed()
        cpuProfile[processName] += (cpuAfter - cpuBefore)
sweep dead processes
```

## Memory Contract

| Data | Storage | Reason |
|---|---|---|
| Process instances | `_heap` | Avoid serialization every tick |
| Path cache | `_heap._pathCache` | Paths are transient |
| Process descriptors | `Memory.kernel` | Survive global resets |
| Creep role + PID | `Memory.creeps` | Survive global resets |
| Log level | `Memory.logLevel` | Persist across resets |
| Last reset tick | `Memory.kernel.lastGlobalReset` | Diagnostics |
| IDs 0-99 | `RawMemory.segments` | Managed by SegmentManager |

## Infrastructure Layer

### Raw Memory Management (`SegmentManager`)
-   Manages access to the 100 available raw memory segments.
-   Enforces the 10-active-segment limit per tick.
-   Provides an interface to Request, Read, and Save segments.

### Traffic Management (`TrafficManager`)
*(Experimental)*
-   Implements a priority-based movement resolution system.
-   Resolves conflicts when multiple creeps try to move to the same square or swap positions.
-   **Shove Logic**: Higher priority creeps can "shove" lower priority or idle creeps out of the way.
-   *Note: Currently separate from the main `Zerg.travelTo` logic.*

## Build Configuration

### TypeScript Strictness (tsconfig.json + tsconfig.build.json)

| Flag | Value | Purpose |
|---|---|---|
| `strict` | `true` | Enables all strict checks |
| `noUnusedLocals` | `true` | Catch dead code |
| `noUnusedParameters` | `true` | Catch forgotten params |
| `noFallthroughCasesInSwitch` | `true` | Prevent switch bugs |
| `forceConsistentCasingInFileNames` | `true` | Cross-platform safety |

### Rollup (rollup.config.mjs)

- **Source map**: Inline (`sourcemap: 'inline'`) — embedded in `main.js` for ErrorMapper
- **Tree-shaking**: Aggressive (`moduleSideEffects: false`, `propertyReadSideEffects: false`)
- **External**: `lodash` excluded from bundle

## File Structure

```
src/
├── main.ts                    # Loop entry point + console commands
├── version.ts                 # Auto-managed version
├── types.d.ts                 # Global type declarations
├── kernel/
│   ├── Kernel.ts              # Scheduler + profiling + process table
│   ├── Process.ts             # Abstract process base
│   └── ProcessStatus.ts       # Runtime status constants
├── processes/
│   ├── overlords/             # Colony Task Managers
│   │   ├── MiningOverlord.ts  # Source harvesting
│   │   └── ConstructionOverlord.ts # Base building
│   ├── MiningProcess.ts       # (Legacy) Standalone miner
│   ├── UpgradeProcess.ts      # (Legacy) Standalone upgrader
│   └── ProfilerProcess.ts     # CPU usage monitor (priority 0)
├── utils/
│   ├── ErrorMapper.ts         # Source-map stack trace mapping
│   ├── GlobalCache.ts         # Heap-first state + reset detection
│   ├── Algorithms.ts          # Distance Transform & geometries
│   └── Logger.ts              # Structured logging with levels
├── core/
│   ├── GlobalManager.ts       # Warm start / Colony rehydration
│   └── memory/
│       └── SegmentManager.ts  # RawMemory segment management
├── os/infrastructure/
│   ├── BunkerLayout.ts        # Base layout templates
│   └── TrafficManager.ts      # (Experimental) Priority-based movement
├── os/logistics/
│   └── LogisticsNetwork.ts    # Centralized resource broker
└── zerg/
    └── Zerg.ts                # Creep wrapper + path cache
```

### New Modules (Automated Planning)

- **RoomPlannerProcess**: `src/os/processes/RoomPlannerProcess.ts`
- **ConstructionOverlord**: `src/processes/overlords/ConstructionOverlord.ts`
- **BunkerLayout**: `src/os/infrastructure/BunkerLayout.ts`
