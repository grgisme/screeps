# Builders & Upgraders

Builders and Upgraders are the room's "Civil Engineers," responsible for expanding infrastructure and increasing Controller levels.

## Role: Builder
Builders focus on construction and maintenance.
- **Construction**: Actively build sites in the room. They follow a specific structure priority (Spawn -> Extensions -> Towers -> Everything else).
- **Threat Imminent Priority (v2.11)**: If a Tower site exists and SafeMode < 2000, builders pivot exclusively to the Tower.
- **Center-Out Build Order (v2.10)**: Within the same structure type, builders prioritize sites closest to the room's energy hub (Storage or Spawn). This minimizes distance traveled and ensures central infrastructure is finished first.
- **Maintenance**: If no construction sites exist, they repair roads, containers, and ramparts.
- **Tower Maintenance**: Builders will fill Towers with energy if they are empty or low, especially immediately after construction.
- **Efficiency: Superior Target Locking (v2.13)**: Builders now "lock on" to their current project more aggressively. They will only switch targets if the current one is completed or if a strictly higher-priority site (like a Tower during an attack) is found. This eliminates jitter when moving between sites of equal priority.

## Role: Upgrader
Upgraders focus exclusively on the Room Controller.
- **Behavior**: Takes energy from the "Surplus Pool" or local containers and pumps it into the controller.
- **White-Collar Workers**: Unlike harvesters, upgraders should never harvest from a source directly unless the room is in a state of emergency.

## Resource Access
Both roles utilize the **Surplus Pool** from Spawns/Extensions. They will only "tap into the bank" if:
1.  The Spawn Manager identifies energy above its current goal.
2.  The Spawn is not currently busy spawning a critical creep.
3.  The room energy is at 90%+ capacity (fallback check).

---
[⬅️ Back to Index](../index.md)
