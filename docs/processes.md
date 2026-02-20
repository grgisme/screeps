---
layout: default
title: Process Model
---

# Process Model

[← Home](index)

Every unit of work in the Screeps OS is modeled as a **Process** (`src/kernel/Process.ts`). Concrete subclasses implement `run()` to perform their per-tick logic.

---

## Abstract Base Class

```typescript
abstract class Process {
    pid: number;              // Assigned by Kernel
    priority: number;         // Lower = higher priority
    parentPID: number | null;
    status: ProcessStatusType; // ALIVE | SLEEP | DEAD
    processId: string;        // Stable, purpose-derived ID
    sleepUntil: number | null;
    thread?: Generator;       // Active coroutine
    kernel?: Kernel;          // Back-reference (injected via DI)

    abstract readonly processName: string;
    abstract run(): void | Generator<void, void, unknown>;
}
```

---

## Status Constants

| Status | Value | Meaning |
|---|---|---|
| `ALIVE` | 0 | Process runs each tick |
| `SLEEP` | 1 | Scheduler skips it; can be timed or indefinite |
| `DEAD` | 2 | Marked for removal on next sweep |

---

## Lifecycle Methods

| Method | Behavior |
|---|---|
| `suspend()` | Set status to SLEEP (indefinite) |
| `resume()` | Set status to ALIVE, clear `sleepUntil` |
| `sleep(ticks)` | Set `sleepUntil = Game.time + ticks`, register in Kernel's wake map |
| `terminate()` | Set status to DEAD |
| `isAlive()` | Returns `true` when status is ALIVE |
| `shouldWake()` | Returns `true` when sleeping and `Game.time >= sleepUntil` |

---

## Generator Coroutines

`run()` may return a `Generator` to split expensive work across ticks:

```typescript
*run(): Generator<void, void, unknown> {
    // Tick 1: expensive computation
    doPartOne();
    yield;
    // Tick 2: continue
    doPartTwo();
    yield;
    // Tick 3: finish
    doPartThree();
}
```

The Kernel stores the generator as `process.thread` and calls `.next()` each subsequent tick. When the generator completes (`done === true`), the thread is cleared and `run()` is called fresh next tick.

---

## Serialization

Processes survive global resets via a two-method protocol:

```typescript
// Save: called during Kernel.serialize()
serialize(): Record<string, unknown> {
    return { colonyName: this.colonyName };
}

// Restore: called during Kernel.deserialize()
deserialize(data: Record<string, unknown>): void {
    // Restore fields from saved data
}
```

The Kernel produces `ProcessDescriptor` objects containing:

```typescript
interface ProcessDescriptor {
    pid: number;
    priority: number;
    parentPID: number | null;
    processName: string;    // Maps to a registered ProcessFactory
    processId: string;
    status: ProcessStatusType;
    sleepUntil?: number;
    data: Record<string, unknown>;
}
```

---

## V8 Memory Leak Prevention

> **⚠️ GETTER PATTERN RULE:** Never store live Game objects (`Creep`, `Room`, `Structure`) as class properties on heap-persisted Process instances. The V8 VM creates new objects every tick; storing old references prevents GC of the entire previous tick's game state.

**Correct:**
```typescript
private _creepName: string;
get creep(): Creep | undefined {
    return Game.creeps[this._creepName];
}
```

**Wrong:**
```typescript
this.creep = Game.creeps['Alice']; // Memory leak!
```

---

## Concrete Processes

| Process | Priority | Purpose |
|---|---|---|
| `ColonyProcess` | 0 (critical) | Wraps a Colony — calls `refresh()` + `run()` each tick |
| `ProfilerProcess` | 0 (critical) | Tracks CPU usage and scheduler stats, reports every 20 ticks |

---

**Related:** [Kernel](kernel) · [Colony](colony) · [GlobalCache](global-cache)
