---
layout: default
title: Bunker Layout
---

# Bunker Layout

[← Home](index)

The **BunkerLayout** (`src/os/infrastructure/BunkerLayout.ts`) defines a static 13×13 base blueprint using relative coordinates from a central anchor point. The `ConstructionOverlord` reads this layout and places construction sites filtered by RCL.

---

## Coordinate System

All positions are **relative offsets** from the anchor `(0, 0)`, ranging from `-6` to `+6`:

```typescript
static getPos(anchor: RoomPosition, coord: BuildingCoord): RoomPosition {
    return new RoomPosition(
        anchor.x + coord.x,
        anchor.y + coord.y,
        anchor.roomName
    );
}
```

The anchor is stored in `ColonyMemory.anchor` and typically set to the center of the bunker.

---

## Structure Placement

### Core (Inner Ring)

```
        S₃
      T  ·  T
   S₁  St  Te  S₂
      T  L  T
        ·
```

| Symbol | Structure | Position |
|---|---|---|
| `Te` | Terminal | `(0, 0)` — center |
| `St` | Storage | `(0, -1)` |
| `L` | Link (hub) | `(0, 1)` |
| `S₁,S₂,S₃` | Spawns | `(-1,0)`, `(1,0)`, `(0,-2)` |
| `T` | Towers (×6) | Corners `(±1, ±1)` + `(0, ±3)` |

### Extensions (60 total)

Placed in expanding rings:
1. **Inner ring** — 12 positions around the core
2. **X-shape arms** — 12 positions at corners
3. **Cardinal fills** — 12 positions along axes
4. **Outer fills** — 8 positions at radius 5

### Roads

- **Cross** — Cardinal directions at radius 5
- **Diagonals** — `(±2,±2)`, `(±3,±3)`, `(±4,±4)`
- **Ring roads** — Checkerboard access paths at radius 3

### Ramparts

- **Core protection** — Terminal, storage, spawns
- **13×13 outer shell** — Full perimeter at radius 6 (prevents `massAttack` piercing)

Generated programmatically:
```typescript
[STRUCTURE_RAMPART]: (() => {
    const ramparts = [/* core */];
    for (let i = -6; i <= 6; i++) {
        ramparts.push({ x: i, y: -6 }, { x: i, y: 6 });
        if (i > -6 && i < 6) {
            ramparts.push({ x: -6, y: i }, { x: 6, y: i });
        }
    }
    return ramparts;
})()
```

---

## How Construction Works

The `ConstructionOverlord` reads `BunkerLayout.structures`, filters by what the current RCL allows, and places construction sites for any missing structures. It runs periodically (not every tick) to avoid CPU spikes.

---

**Related:** [Colony](colony) · [Overlords](overlords) · [Architecture](architecture)
