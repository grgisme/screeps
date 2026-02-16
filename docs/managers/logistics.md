# Energy Logistics

The bot uses a sophisticated, goal-driven logistics system to ensure that energy is distributed efficiently without starving the spawn's ability to recover.

# Energy Logistics

The bot uses a decentralized, goal-driven logistics system managed by the **Colony** architecture to ensure efficient energy distribution.

## Energy Priority (Withdrawal)
When a creep (Builder, Upgrader, etc.) needs energy, it searches in this order:
1.  **Dropped Resources**: Immediate pickup to prevent decay.
2.  **Tombstones & Ruins**: Salvaging resources from history.
3.  **Storage**: The primary "bank" of the room.
4.  **Local Containers**: Buffers placed near sources or the controller.
5.  **Surplus Pool (Spawns/Extensions)**: Only used when the room has reached its immediate energy goal.
6.  **Harvesting (Fallback)**: Desperate measure if no storage exists.

## Mining & Hauling Pipeline
- **Miners**: Use Source Exclusivity logic to occupy a single source and fill an adjacent container.
- **Haulers**: Monitor these containers and prioritize delivery to:
    1.  **Spawns & Extensions**: Maintain room spawning capacity.
    2.  **Towers**: Ensure defensive readiness.
    3.  **Storage**: Centralizing surplus energy for industrial tasks.

## Energy Throttling
In the new architecture, the **Kernel** can throttle low-priority processes (like massive upgrading) if the room's energy levels drop below critical thresholds, ensuring that primary survival (Mining/Defense) always has resources.

---
[⬅️ Back to Index](../index.md)
