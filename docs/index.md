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

## Architecture

See [architecture.md](architecture.md) for the full OS architecture documentation, including:
- Kernel lifecycle and priority scheduler
- Process model and serialization
- Heap-first memory contract
- Zerg creep wrapper with path caching

## Module Map

| Module | Path | Description |
|---|---|---|
| **Kernel** | `src/kernel/Kernel.ts` | Process scheduler with CPU/bucket guards |
| **Process** | `src/kernel/Process.ts` | Abstract base class for all processes |
| **ProcessStatus** | `src/kernel/ProcessStatus.ts` | Runtime status constants (ALIVE/SLEEP/DEAD) |
| **MiningProcess** | `src/processes/MiningProcess.ts` | Overlord for source harvesting |
| **UpgradeProcess** | `src/processes/UpgradeProcess.ts` | Overlord for controller upgrading |
| **Zerg** | `src/zerg/Zerg.ts` | Creep wrapper with heap-cached pathing |
| **GlobalCache** | `src/utils/GlobalCache.ts` | Heap-first state management |
| **ErrorMapper** | `src/utils/ErrorMapper.ts` | Stack trace mapping for debugging |
| **Main Loop** | `src/main.ts` | Entry point: init, run, serialize |

## Recent Advancements (v1.0.15)

- Complete OS rewrite with Kernel + Process architecture
- Heap-first memory design minimizing `Memory` serialization
- Priority scheduler with CPU ceiling (90%) and bucket floor (500)
- Error isolation per process
- Zerg creep wrapper with path caching (15-tick TTL)

## Documentation Map
- [Architecture Reference](architecture.md) — Full OS design documentation