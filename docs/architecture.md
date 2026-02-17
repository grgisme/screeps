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
┌─────────────────────────────────────────────────┐
│                    Kernel                        │
│  ProcessTable: Map<PID, Process>                │
│  Scheduler: priority sort → for-of → try/catch │
│  Guards: CPU ceiling (90%), Bucket floor (500)  │
│  Profiling: per-process CPU deltas via getUsed  │
│  Serialization: Memory.kernel ↔ processTable    │
└─────────────────────────────────────────────────┘
         │
         ▼
┌──────────┐ ┌──────────────┐ ┌───────────────┐
│ Profiler │ │ MiningProc   │ │ UpgradeProc   │
│ pri: 0   │ │ pri: 10      │ │ pri: 20       │
│ CPU stats│ │ 1 per source │ │ 1 per room    │
│ 20-tick  │ │ spawns miners│ │ spawns upgrdrs│
└──────────┘ └──────────────┘ └───────────────┘
         │           │                │
         ▼           ▼                ▼
┌─────────────────────────────────────────────────┐
│                    Zerg                          │
│  Creep wrapper with heap-cached pathing         │
│  TTL: 15 ticks │ Key: "name:x:y:room"          │
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
│   ├── MiningProcess.ts       # Source harvesting overlord
│   ├── UpgradeProcess.ts      # Controller upgrade overlord
│   └── ProfilerProcess.ts     # CPU usage monitor (priority 0)
├── utils/
│   ├── ErrorMapper.ts         # Source-map stack trace mapping
│   ├── GlobalCache.ts         # Heap-first state + reset detection
│   └── Logger.ts              # Structured logging with levels
└── zerg/
    └── Zerg.ts                # Creep wrapper + path cache
```
