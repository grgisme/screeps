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

## Recent Advancements (v1.0.14)

## Documentation Map