# AI Assistant Guide: CPU Optimization Lessons

This document serves as a reference for future AI assistants working on this codebase. It captures the high-performance patterns discovered during the v2.2 optimization sweep.

## Critical Bottlenecks to Watch For
1.  **Nested Global Loops**: Never iterate over `Game.creeps` or `Game.rooms` inside a per-creep or per-room logic block. This creates O(N^2) complexity that kills CPU in large empires.
2.  **`Room.find` with Filters**: `room.find(FIND_STRUCTURES, {filter: ...})` is significantly slower than `room.find(FIND_STRUCTURES).filter(...)`. Always use the latter if the list is cached.
3.  **Pathfinding Gating**: `PathFinder.search` is one of the most expensive operations in the API. Ensure it is only called when a creep is out of range AND has no valid `_path` string in memory.

## Recommended Patterns

### Use the `micro` Utility
Always use `micro.find(room, type)` instead of `room.find(type)`. The cache handles tick-resets automatically.

### Energy Targeting
Use `utilsTargeting.findUnreserved` for all energy pickups. It uses the `micro` reservation cache to ensure creeps don't swarm the same pile of energy, preventing wasted movement.

### Intent Buffering
When modifying roles, check for range BEFORE calling an action:
```typescript
if (creep.pos.getRangeTo(target) <= 1) {
    creep.harvest(target);
} else {
    pathing.run(creep, target.pos, 1);
}
```
This avoids the 0.2 CPU intent cost for `harvest` returning `ERR_NOT_IN_RANGE`.

## Future Improvements
- **Local CostMatrix Injection**: When pathing, consider injecting the positions of other creeps into the CostMatrix ONLY when the creep is stuck, otherwise use a static road-priority CM to save CPU.
- **Heap Caching**: Consider moving the per-tick cache to a global `heap` object (persistent across ticks but reset on global reset) to avoid even the first `room.find` call after a reset until memory is parsed.
