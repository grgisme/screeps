# Logistics & Hauling

**Haulers** are the circulatory system of the room, moving energy from production points to consumption points.

## Role: Hauler
The Hauler is a purely logistical creep (no `WORK` parts).
- **Primary Task**: Pick up energy from Source Containers or dropped piles.
- **Secondary Task**: Fill Spawns and Extensions to enable spawning.
- **Tertiary Task**: Fill Towers and Storage.
- **Body Scaling**: 1:1 ratio of [CARRY, MOVE] for maximum efficiency on roads.

---
[⬅️ Back to Index](../index.md)

## Pickup Priorities
When looking for energy, a Hauler evaluates targets in this order:
1.  **Dropped Resources**: High priority to prevent "evaporation" losses.
2.  **Tombstones**: Salvaging energy from fallen creeps.
3.  **Source Containers**: Relieving the static miners.

## Delivery Priorities
A Hauler delivers energy where it's needed most:
1.  **Spawns & Extensions**: Keep the room's production alive.
2.  **Towers**: Ensure the room can defend itself.
3.  **Storage**: Buffer for later use.
4.  **Upgrader/Builder Containers**: Local buffers for workers.
