---
layout: default
title: Zerg (Creep Wrapper)
---

# Zerg — Creep Wrapper

[← Home](index)

**Zerg** (`src/os/zerg/Zerg.ts`) is the base wrapper around the native `Creep` object. It provides a consistent API for task execution, intent caching, and movement while remaining fully heap-safe.

---

## Heap-Safe Design

Zerg stores only the `creepName` string and resolves the live `Creep` via a getter:

```typescript
class Zerg {
    private creepName: string;

    get creep(): Creep | undefined {
        return Game.creeps[this.creepName];
    }
}
```

All other properties (`pos`, `room`, `memory`, `store`, `fatigue`, `ticksToLive`) are also getters that delegate to `this.creep`.

---

## Intent Caching

Screeps limits each creep to **one action per pipeline per tick**. Zerg enforces this:

| Pipeline | Actions | Flag |
|---|---|---|
| **Work** | `harvest`, `build`, `repair`, `upgradeController`, `dismantle` | `hasWorkIntent` |
| **Harvest** | `harvest` (also sets Work pipeline) | `hasHarvestIntent` |
| **Transfer** | `transfer`, `withdraw`, `drop`, `pickup` | `hasTransferIntent` |
| **Attack** | `attack` | `hasAttackIntent` |
| **Heal** | `heal` | `hasHealIntent` |
| **Ranged** | `rangedAttack`, `rangedMassAttack`, `rangedHeal` | `hasRangedIntent` |

A creep CAN `heal()` + `rangedAttack()` in the same tick because they're on separate pipelines.

Each action method checks its pipeline flag before issuing the intent:

```typescript
harvest(target: Source): ScreepsReturnCode {
    if (this.hasWorkIntent || this.hasHarvestIntent) return ERR_BUSY;
    const result = this.creep!.harvest(target);
    if (result === OK) {
        this.hasWorkIntent = true;
        this.hasHarvestIntent = true;
    }
    return result;
}
```

---

## Task Execution

Each tick, `Zerg.run()` performs:

1. **Reset intent flags** (new tick = fresh actions)
2. **Deserialize task** if needed (after global reset, reconstruct from `CreepMemory.task`)
3. **Validate task** — check `isValid()`, clear if target is gone
4. **Execute task** — call `task.run(this)`, clear if returns `true` (complete)

### Task Serialization

```typescript
setTask(task: ITask | null): void {
    this.task = task;
    if (task) {
        (this.memory as any).task = task.serialize();
    } else {
        delete (this.memory as any).task;
    }
}
```

Tasks survive global resets because their serialized form is stored in `CreepMemory`.

---

## Movement

Zerg delegates movement to the `TrafficManager` for collision resolution:

```typescript
// Inside task execution, when creep needs to move:
TrafficManager.register(this, direction, priority);
```

Path caching via `GlobalCache.getPathCache()` avoids recalculating paths every tick.

---

## Subclasses

| Class | Purpose |
|---|---|
| `Miner` | Static miner with container/link awareness |
| `CombatZerg` | Combat specialization stub |
| `Transporter` | Transporter specialization (legacy, being replaced with base Zerg) |
| `Upgrader` | Upgrader stub |
| `Worker` | Worker stub |

Most subclasses are thin stubs — the base `Zerg` class handles the vast majority of behavior. The IoC pattern means Overlords assign tasks; Zergs execute them blindly.

---

**Related:** [Tasks](tasks) · [Overlords](overlords) · [Traffic Manager](traffic-manager) · [Design Patterns](design-patterns)
