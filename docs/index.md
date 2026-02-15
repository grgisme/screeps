# Screeps Bot Handbook

Welcome to the internal documentation for the Screeps bot. This guide provides a high-level, plain-English explanation of how the bot thinks, prioritizes tasks, and manages resources.

## Strategy Overview
The bot operates on a **Priority-First** basis, ensuring survival before optimization.

### Core Principles
1.  **Survival First**: Maintaining a minimum of one harvester to recover from a full wipe.
2.  **Infrastructure Priority**: Building containers and extensions to move from "Walking" to "Static Mining".
3.  **Adaptive CPU Usage**: Dialing back low-priority tasks (like scouting or massive upgrading) when the CPU bucket is low.
4.  **Resilient Memory**: Periodic sanity checks to recover lost or corrupted creep states.

## Navigation
- **[Managers](managers/spawn.md)**: High-level systems that run once per room or globally.
- **[Roles](roles/mining.md)**: Specific behavior logic for each creep type.
