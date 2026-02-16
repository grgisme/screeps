# CPU Optimization Strategies

In Screeps, CPU is more valuable than energy. This document outlines the strategies implemented in this bot to minimize CPU usage while maximizing utility.

## The "Golden Rules" of Efficiency
1.  **Cache Constantly**: If you find an object, remember it. If you calculate a path, save it.
2.  **Room-Level Scoping**: Avoid global loops (like `Game.creeps`) whenever possible. Processes should be scoped to a single room.
3.  **Intent Pre-checks**: Only call actions (`harvest`, `withdraw`, `move`) if they have a high probability of returning `OK`. Every intent call that isn't `ERR_NOT_IN_RANGE` costs 0.2 CPU.
4.  **Distance Gating**: Use `findClosestByRange` (Chebyshev distance) for initial filters before committing to `findClosestByPath`.
- **Road Efficiency (v2.14)**: The pathing engine strictly prioritizes built roads and road construction sites (Cost 1) over plain terrain (Cost 2) and swamps (Cost 10). This ensures maximum move speed and minimum fatigue for all creeps.
- **Global resets** (avoid them by avoiding top-level code that is expensive).

---
[⬅️ Back to Index](../index.md)

## Implementation Details

### Centralized Per-Tick Caching (`MicroOptimizations.ts`)
The bot uses a centralized cache that resets every tick.
- **The Problem**: Multiple role managers (Builder, Upgrader, Hauler) often call `room.find(FIND_STRUCTURES)` in the same tick. Without caching, the server recalculates this list for every caller.
- **The Solution**: `micro.find(room, type)` stores the result in a map keyed by `roomName` and `findType`. Subsequent callers in the same tick receive the cached array instantly.

### Reservation Maps
Instead of every creep looping through all global creeps to see who has "reserved" a container, `micro.getRoomReservations(room)` calculates all intents in a single pass at the start of the room's execution.

### Terrain Analysis Caching
Terrain scanning involves iterating through 2,500 coordinates (50x50). 
- **Optimization**: This is done once per room when first scouted. The resulting scores are stored in `Memory.intel`. On subsequent visits, the bot reads the stored score instead of re-scanning.

### 🚦 TrafficManager & Path Caching
The movement engine has been fully centralized to minimize PathFinder calls.
- **Directional Compression**: Paths are stored as strings of numbers (e.g., "12348") in the volatile Heap.
- **Shove Algorithm**: High-priority creeps (like high-RCL miners) will automatically swap positions with lower-priority creeps (like haulers) to avoid deadlocks.
- **Visual Debugging**: The `Traffic.visuals(true)` tool provides per-tick overlays of cached paths for monitoring congestion.

### Adaptive Stalling
- **Stuck Detection**: If a creep doesn't move for 3-5 ticks while on a path, it triggers an emergency re-path with increased `maxOps`.
- **Bucket Aware**: PathFinder intensity scales automatically with your `Game.cpu.bucket`.

## Results
By reducing the "Background CPU" (the overhead of just running the managers), the bot can support significantly more creeps per room without triggering CPU exhaust errors.
