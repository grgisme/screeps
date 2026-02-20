---
layout: default
title: Design Patterns
---

# Design Patterns & Best Practices

[← Home](index)

This page catalogs the key design patterns used throughout the bot. Understanding these patterns is essential for contributing or extending the codebase.

---

## 1. V8 Getter Pattern (Memory Leak Prevention)

**Problem:** Screeps runs on V8. `Game.rooms`, `Game.creeps`, and all game objects are recreated every tick. If a heap-persisted object (Colony, Overlord, Zerg) stores a reference to a live game object, V8 cannot garbage-collect the *entire previous tick's game state*, causing a fatal memory leak.

**Solution:** Never store live game objects. Store string IDs, resolve via getters:

```typescript
// ✅ Correct
private creepName: string;
get creep(): Creep | undefined {
    return Game.creeps[this.creepName];
}

// ❌ Fatal memory leak
this.creep = Game.creeps['Alice'];
```

**Used in:** Colony, Zerg, Hatchery, LinkNetwork, MiningSite — every heap-persisted class.

---

## 2. Inversion of Control (IoC)

**Problem:** Tightly coupling creep behavior to role classes creates rigid, hard-to-maintain code.

**Solution:** Separate *what to do* from *how to do it*:

| Layer | Responsibility |
|---|---|
| **Overlord** | Decides which task to assign |
| **Task** | Knows how to perform one atomic action |
| **Zerg** | Executes whatever task it's given, blindly |

Overlords are the "brain"; Zergs are the "hands". Tasks are the instructions.

---

## 3. Subreaper Orphan Adoption

**Problem:** After a global reset, Overlords lose all creep references (heap wiped).

**Solution:** Creeps store `memory._overlord = "miner"` at spawn time. Overlords reconstruct their creep list each tick by filtering `colony.creeps`:

```typescript
get zergs(): Zerg[] {
    return this.colony.creeps
        .filter(c => c.memory._overlord === this.processId)
        .map(c => this.colony.registerZerg(c));
}
```

No serialization needed — creep memory survives resets.

---

## 4. Intent Caching

**Problem:** Screeps silently ignores duplicate actions on the same pipeline, wasting CPU.

**Solution:** Zerg tracks boolean flags per pipeline (`hasWorkIntent`, `hasTransferIntent`, etc.) and rejects duplicate calls with `ERR_BUSY`. Flags reset at the start of each tick.

**Pipelines:** Work, Harvest, Transfer, Attack, Heal, Ranged — see [Zerg](zerg).

---

## 5. Serialization for Global Resets

**Problem:** Screeps can wipe the global heap at any time, destroying all runtime state.

**Solution:** A multi-layered persistence strategy:

| Layer | What Survives | How |
|---|---|---|
| **Kernel** | Process table | `Memory.kernel.processTable` |
| **Tasks** | Current task per creep | `CreepMemory.task` (TaskMemory) |
| **GlobalCache** | Arbitrary objects | `Memory.heap[key]` via rehydrate |
| **Overlords** | Creep ownership | `CreepMemory._overlord` (subreaper) |
| **Colony** | Anchor, RCL | `Memory.colonies[name]` |

---

## 6. Temporal Throttling

**Problem:** Multiple periodic operations running on the same tick cause CPU spikes.

**Solution:** Offset periodic work to different ticks:

```typescript
// Memory cleanup: tick offset 3
if (Game.time % 100 === 3) { /* prune dead creeps */ }

// Heap report: tick offset 47
if (Game.time % 100 === 47) { /* log heap stats */ }

// Link refresh: every 50 ticks
if (Game.time % 50 !== 0 && this.sourceLinkIds.length > 0) return;
```

---

## 7. Spawn Commitment Handshake

**Problem:** Between `spawnCreep()` returning OK and the creep actually existing, the system might double-spawn.

**Solution:** 3-phase handshake via `GlobalCache`:

| Phase | Trigger | State |
|---|---|---|
| **Commit** | `spawnCreep() === OK` | Name added to `pendingSpawns` |
| **Spawning** | Creep exists, `spawning === true` | Still in set |
| **Alive** | Creep exists, `spawning === false` | Removed from set |

---

## 8. Virtual Capacity Ledgers

**Problem:** Multiple actors (spawns, link transfers, haulers) can try to use the same resource in the same tick.

**Solution:** Track "virtual" remaining amounts that decrement as resources are claimed:

```typescript
// Hatchery: prevent two spawns spending the same energy
let virtualEnergyAvailable = room.energyAvailable;
virtualEnergyAvailable -= bodyCost;

// LinkNetwork: prevent two sources overfilling the hub
let virtualHubFreeCapacity = hubLink.store.getFreeCapacity(RESOURCE_ENERGY);
virtualHubFreeCapacity -= amountToSend;

// LogisticsNetwork: reservation ledger prevents multiple haulers targeting same pile
```

---

## 9. Stateless Ledger Rebuild

**Problem:** Reservation systems accumulate stale entries from dead creeps.

**Solution:** Rebuild the entire ledger from scratch each tick by scanning active Zerg tasks:

```typescript
rebuildLedger(): void {
    this.incomingReservations.clear();
    this.outgoingReservations.clear();
    for (const zerg of this.colony.zergs.values()) {
        // Reconstruct from current task assignments
    }
}
```

No cleanup logic needed — stale entries simply don't get reconstructed.

---

**Related:** [Architecture](architecture) · [Kernel](kernel) · [Zerg](zerg) · [Processes](processes)
