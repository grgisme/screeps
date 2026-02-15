# Global Systems

Beyond individual rooms, the bot manages global resources like CPU, Bucket, and Memory to ensure long-term stability and performance.

## CPU Management (`manager.cpu`)
The bot adapts its behavior based on the current **CPU Bucket**:
- **Burst Mode**: When the bucket is high (e.g., 10,000), it increases upgrading output and generates Pixels.
- **Recovery Mode**: When the bucket is low, it halts non-essential tasks (scouting, non-critical building) to prioritize spawning and harvesting.
- **Pathing Buffer**: Pathfinding is throttled if the current tick's CPU usage exceeds 50% of the limit, ensuring critical logic doesn't time out.

## Memory Sanity Guard (`manager.memory`)
To prevent "ghost" creeps or logic failures due to global resets:
- **Periodic Checks**: Every 50 ticks, it validates all active creeps.
- **Auto-Legacy Recovery**: If a creep's role is missing from memory, the bot deduces its role from its body parts and name prefix to restore functionality.

## Market Management
The **Market Manager** handles automated trading:
- **Selling Excess**: Sells surplus resources (like excess energy or minerals) when prices are favorable.
- **Buying Essentials**: Purchases energy for expansion rooms or critical defense moments.
