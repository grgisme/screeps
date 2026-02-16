# Energy Logistics

The bot uses a sophisticated, goal-driven logistics system to ensure that energy is distributed efficiently without starving the spawn's ability to recover.

## The Energy Allocation Queue
Instead of using simple percentage-based thresholds, the bot uses an **Energy Allocation Queue** (`manager.queue`).

1.  **Goal Setting**: The Spawn Manager calculates the exact energy needed for the next high-priority creep (e.g., 550 energy for a heavy miner).
2.  **Surplus Detection**: Any energy currently in Spawns or Extensions that exceeds this goal is considered "Surplus".
3.  **Worker Access**: Builders and Upgraders are permitted to withdraw energy from the Spawn pool only when Surplus is detected.

## Energy Priority (Withdrawal)
When a creep needs energy, it follows this priority list:
1.  **Dropped Resources**: High priority to prevent decay.
2.  **Tombstones**: Salvaging energy from dead creeps.
3.  **Storage**: The primary "bank" of the room.
4.  **Containers**: Specifically those not adjacent to sources (local buffers).
5.  **Surplus Pool**: Spawns/Extensions (only if the Energy Goal is met).
6.  **Harvesting**: The final fallback if no stored energy is available.

## Hauling Logic
Haulers prioritize picking up energy from **Source Containers** (where miners drop it) and delivering it to:
1.  **Spawns & Extensions**: Primary goal.
2.  **Towers**: If they are low on ammo.
3.  **Storage/Containers**: For long-term logistics.

---
[⬅️ Back to Index](../index.md)
