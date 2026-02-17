# Screeps Bot Handbook

Welcome to the internal documentation for the Screeps bot. This guide provides a high-level, plain-English explanation of how the bot thinks, prioritizes tasks, and manages resources.

## Strategy Overview
The bot operates on a **Kernel OS** architecture, using a multi-process scheduler to manage priorities and a hierarchical **Overlord** system for room management.

### Core Principles
1.  **Process Isolation**: The Kernel ensures logic failures in one module don't crash the entire bot.
2.  **Survival First**: Maintaining a minimum of one harvester to recover from a full wipe.
3.  **Hierarchical Ownership**: Each Colony (room) has dedicated Overlords for Mining, Infrastructure, and Defense.
4.  **Traffic Management**: Advanced path caching and priority-based shoving to reduce congestion.
5.  **Strategic Planning**: Automated bunker layouts based on Distance Transform logic.

## Recent Advancements (v1.0.13)
- **Kernel OS Core**: Implemented a robust process scheduler with priority-based execution.
- **Overlord Overhaul**: Transitioned from global managers to localized Overlords for better scalability.
- **TrafficManager**: Centralized movement logic with path caching and creep shoving.
- **RoomPlanner (v2.0)**: New automated bunker placement using distance transform for optimal anchor selection.

## Documentation Map

### 🛠️ [Overlords](core/kernel.md)
*High-level room and global orchestration.*
- **[Kernel & OS Architecture](core/kernel.md)**: The heart of the bot.
- **[Spawn Management](managers/spawn.md)**: Priority queues and body scaling.
- **[Infrastructure & Planning](managers/planning.md)**: Bunker layouts and RCL roadmaps.
- **[Defense & Military](managers/defense.md)**: Towers, defenders, and safe mode.
- **[Logistics & Energy](managers/logistics.md)**: Resource distribution and withdrawal rules.
- **[Global Systems](managers/global.md)**: Memory hygiene and Console Tools.

### 👥 [Creep Roles](roles/mining.md)
*Specific behavioral logic for individual units.*
- **[Mining](roles/mining.md)**: Static vs. dynamic harvesting logic.
- **[Hauling](roles/hauling.md)**: Energy transport and logistics.
- **[Workers](roles/workers.md)**: Building, Upgrading, and Repairing.

### 🧠 [Core & Internal](core/performance.md)
*Under-the-hood technical guides.*
- **[Performance & CPU](core/performance.md)**: Optimization strategies.
- **[CPU Lessons](internal/cpu_lessons.md)**: Deep dives into Screeps CPU mechanics.
