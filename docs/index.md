# Screeps Bot Handbook

Welcome to the internal documentation for the Screeps bot. This guide provides a high-level, plain-English explanation of how the bot thinks, prioritizes tasks, and manages resources.

## Strategy Overview
The bot operates on a **Priority-First** basis, ensuring survival before optimization.

### Core Principles
1.  **Survival First**: Maintaining a minimum of one harvester to recover from a full wipe.
2.  **Infrastructure Priority**: Building containers and extensions to move from "Walking" to "Static Mining".
3.  **Adaptive CPU Usage**: Dialing back low-priority tasks (like scouting or massive upgrading) when the CPU bucket is low.
4.  **Resilient Memory**: Periodic sanity checks to prevent "ghost" creeps or logic failures.
5.  **Strategic Planning**: Automated bunker layouts for long-term scalability.
6.  **Reporting & Tools**: Command-line oversight through `Status()`, `Plan()`, and periodic auto-logs.

## Recent Advancements (v2.5 - v2.10)
-   **War Economy**: Emergency defense priorities and controller camping protection.
-   **Memory Hygiene**: Automated stale room memory cleanup to maintain low CPU overhead.
-   **Efficient Infrastructure**: Distance-based builder prioritization for logical base growth.

## Documentation Map

### 🛠️ [Managers](managers/spawn.md)
*High-level room and global orchestration.*
- **[Spawn Management](managers/spawn.md)**: Priority queues and body scaling.
- **[Base Planning](managers/planning.md)**: Bunker layouts and RCL roadmaps.
- **[Defense & Military](managers/defense.md)**: Towers, defenders, and safe mode.
- **[Logistics & Market](managers/logistics.md)**: Resource balancing and trading.
- **[Global Systems](managers/global.md)**: CPU, Memory hygiene, and Console Tools.

### 👥 [Creep Roles](roles/mining.md)
*Specific behavioral logic for individual units.*
- **[Mining](roles/mining.md)**: Static vs. dynamic harvesting logic.
- **[Hauling](roles/hauling.md)**: Energy transport and logistics.
- **[Workers](roles/workers.md)**: Building, Upgrading, and Repairing.

### 🧠 [Core & Internal](core/performance.md)
*Under-the-hood technical guides.*
- **[Performance & CPU](core/performance.md)**: Optimization strategies.
- **[CPU Lessons](internal/cpu_lessons.md)**: Deep dives into Screeps CPU mechanics.
