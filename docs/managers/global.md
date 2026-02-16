# Global Systems

Beyond individual rooms, the bot manages global resources like CPU, Bucket, and Memory to ensure long-term stability and performance.

## CPU Management (`manager.cpu`)
The bot adapts its behavior based on the current **CPU Bucket**:
- **Burst Mode**: When the bucket is high (e.g., 10,000), it increases upgrading output and generates Pixels.
- **Recovery Mode**: When the bucket is low, it halts non-essential tasks (scouting, non-critical building) to prioritize spawning and harvesting.
- **Pathing Buffer**: Pathfinding is throttled if the current tick's CPU usage exceeds 50% of the limit, ensuring critical logic doesn't time out.

- **Auto-Legacy Recovery**: If a creep's role is missing from memory, the bot deduces its role from its body parts and name prefix to restore functionality.
- **Stale Room Purge (v2.9)**: Every 50 ticks, the bot scans `Memory.rooms`. If it find a room that the bot no longer owns, hasn't reserved, and has no creeps within, the memory for that room is deleted to prevent bloat.

## Console Tools (v2.7/v2.8)
A suite of commands attached to the global scope for manual oversight:
- **`Status()`**: Prints a detailed priority report for all owned rooms.
- **`Plan()`**: Visualizes the "Bunker Layout" for the current room (or the primary room if no argument is provided).
- **`Replan()`**: Wipes construction memory for a room and forces the Building Manager to re-evaluate structural priorities next tick.
- **`Sim()`**: Triggers simulation-specific debug modes.

## Market Management
The **Market Manager** handles automated trading:
- **Selling Excess**: Sells surplus resources (like excess energy or minerals) when prices are favorable.
- **Buying Essentials**: Purchases energy for expansion rooms or critical defense moments.

---
[⬅️ Back to Index](../index.md)
