# Screeps OS Architecture

This document describes the internal architecture of the Screeps bot's Operating System.

## Overview

```
┌─────────────────────────────────────────────────┐
│                   main.ts loop                  │
│  1. Clean dead Memory.creeps                    │
│  2. Detect global reset → rehydrate Kernel      │
│  3. kernel.run()  (priority scheduler)          │
│  4. kernel.serialize() → Memory.kernel          │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│                    Kernel                        │
│  ProcessTable: Map<PID, Process>                │
│  Scheduler: priority sort → for-of → try/catch │
│  Guards: CPU ceiling (90%), Bucket floor (500)  │
│  Serialization: Memory.kernel ↔ processTable    │
└─────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐  ┌───────────────────┐
│  MiningProcess   │  │  UpgradeProcess   │
│  priority: 10    │  │  priority: 20     │
│  1 per source    │  │  1 per room       │
│  spawns miners   │  │  spawns upgraders │
│  harvest→deliver │  │  withdraw→upgrade │
└──────────────────┘  └───────────────────┘
         │                     │
         ▼                     ▼
┌─────────────────────────────────────────────────┐
│                    Zerg                          │
│  Creep wrapper with heap-cached pathing         │
│  TTL: 15 ticks │ Key: "name:x:y:room"          │
│  Serialized via Room.serializePath              │
└─────────────────────────────────────────────────┘
```

## Kernel Lifecycle

### Global Reset Detection

Screeps resets the global object unpredictably. On each tick:

1. `GlobalCache.isGlobalReset()` checks a sentinel (`_heap._initialized`)
2. If reset detected → `Kernel.deserialize()` rebuilds from `Memory.kernel`
3. Otherwise → `Kernel.loadFromHeap()` retrieves the cached instance

### Scheduler Algorithm

```
sorted = processTable sorted by priority (ascending)
for each process in sorted:
    if CPU ≥ limit * 0.9 → break
    if bucket < 500 → break
    if process.isAlive():
        try: process.run()
        catch: process.terminate(), log error
sweep dead processes from table
```

### Process Factory Registry

After a global reset, processes must be reconstructed from their serialized descriptors. Each process type registers a factory function:

```typescript
Kernel.registerProcess("mining", (pid, priority, parentPID, data) => {
    return new MiningProcess(pid, priority, parentPID,
        data.sourceId as Id<Source>, data.roomName as string);
});
```

## Process Model

### Abstract Process

| Property | Type | Description |
|---|---|---|
| `pid` | `number` | Unique process identifier |
| `priority` | `number` | Lower = executed first |
| `parentPID` | `number \| null` | Parent process (for hierarchy) |
| `status` | `ProcessStatusType` | ALIVE (0), SLEEP (1), DEAD (2) |

Methods: `run()` (abstract), `suspend()`, `resume()`, `terminate()`, `serialize()`, `deserialize()`

### Overlord Pattern

Processes own and direct creeps — creeps don't decide for themselves:

1. **refreshCreeps()** — scan `Game.creeps` for creeps assigned to this PID
2. **requestSpawns()** — if below target count, request a spawn
3. **runCreep()** — issue commands (harvest, transfer, upgrade) via Zerg wrapper

## Memory Contract

### Heap-First Philosophy

| Data | Storage | Reason |
|---|---|---|
| Process instances | `_heap` (global) | Avoid serialization every tick |
| Path cache | `_heap._pathCache` | Paths are transient |
| Creep assignments | Process heap fields | Rebuilt from `Game.creeps` scan |
| Process descriptors | `Memory.kernel` | Must survive global resets |
| Creep role + PID | `Memory.creeps` | Must survive global resets |

### CreepMemory (minimal)

```typescript
interface CreepMemory {
    role: string;       // which process type spawned this
    pid: number;        // owning process PID
    targetId?: string;  // optional target (source ID, etc.)
    homeRoom?: string;  // room assignment
}
```

## Zerg (Creep Wrapper)

### Path Caching

- **Storage**: `_heap._pathCache` (Map)
- **Key format**: `"creepName:x:y:roomName"`
- **Serialization**: `Room.serializePath()` / `Room.deserializePath()`
- **TTL**: 15 ticks (re-path after expiry)
- **Fallback**: If `moveByPath` fails, falls back to `moveTo`

### Lazy Resolution

Zerg can be constructed with just a creep name. The actual `Creep` object is resolved lazily from `Game.creeps` on first access, enabling construction before the game loop populates creep references.

## ErrorMapper

Wraps the game loop in `try/catch` and logs errors with styled HTML for the Screeps console. Designed to support source-map-based stack trace translation when a source map consumer is available.

## File Structure

```
src/
├── main.ts                    # Loop entry point
├── version.ts                 # Auto-managed version
├── types.d.ts                 # Global type declarations
├── kernel/
│   ├── Kernel.ts              # Scheduler + process table
│   ├── Process.ts             # Abstract process base
│   └── ProcessStatus.ts       # Runtime status constants
├── processes/
│   ├── MiningProcess.ts       # Source harvesting overlord
│   └── UpgradeProcess.ts      # Controller upgrade overlord
├── utils/
│   ├── ErrorMapper.ts         # Error wrapping + mapping
│   └── GlobalCache.ts         # Heap-first state management
└── zerg/
    └── Zerg.ts                # Creep wrapper + path cache
```
