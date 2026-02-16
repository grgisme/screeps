# Kernel OS & Overlord Architecture

The bot has transitioned to a multi-process execution environment governed by a **Kernel** and a hierarchical **Overlord** system. This architecture ensures high stability, modularity, and priority-driven CPU management.

## 🧠 The Kernel
The Kernel is the heart of the OS. It manages the lifecycle of **Processes** and coordinates their execution through the **Scheduler**.

### Key Responsibilities:
1.  **Context Persistency**: Processes save their state to `heap.persistent` or `Memory` between ticks, allowing complex multi-tick operations.
2.  **Scheduler**: Runs processes in order of their **PRIORITY** (CRITICAL, HIGH, NORMAL, LOW, DEFERRED). It can yield low-priority tasks if CPU is scarce.
3.  **Process Isolation**: If one process crashes, the Kernel catches the error and keeps the rest of the bot running.

### Common Processes:
| Process | Priority | Purpose |
| :--- | :--- | :--- |
| `colonies` | HIGH | Runs all Colony and Overlord logic. |
| `mining` | HIGH | Executes Harvester and Miner creep roles. |
| `defense` | CRITICAL | Manages towers and safe modes. |
| `traffic` | LOW | Handles visual debugging and path GC. |

## 🏰 The Overlord Pattern
Instead of monolithic managers, the bot uses **Overlords** tied to specific **Colonies** (rooms).

### What is an Overlord?
An Overlord represents a "department" within a room. It identifies requirements and directs creeps (like a foreman).

- **[Mining Overlord](../roles/mining.md)**: Ensures sources have assigned miners and containers.
- **[Infrastructure Overlord](../managers/planning.md)**: Identifies construction needs from the RoomPlanner and assigns builders.
- **Defense Overlord**: Coordinates tower fires and rampart maintenance.

## 🚦 Traffic Control
All movement is now centralized through the **TrafficManager**. 
- **Shove Algorithm**: High-priority creeps can "shove" lower-priority creeps out of their path.
- **Path Caching**: Paths are cached in volatile Heap to save PathFinder CPU.

---
[⬅️ Back to Index](../index.md)
