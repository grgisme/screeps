# Colony Management System

The **Colony Management System** is the core organization structure for the bot, replacing standalone processes for room-level activities. It implements a hierarchical ownership model: `Colony` -> `Overlord` -> `Zerg`.

## Hierarchy

```mermaid
graph TD
    Kernel -->|Runs| ColonyProcess
    ColonyProcess -->|Manages| Colony
    Colony -->|Contains| Overlords
    Colony -->|Contains| Zergs
    
    subgraph Overlords
    MO[MiningOverlord]
    CO[ConstructionOverlord]
    UO[UpgradeOverlord (Planned)]
    end
    
    Overlords -->|Command| Zergs[Zergs (Creeps)]
```

## Components

### 1. Colony (`src/os/Colony.ts`)
A `Colony` represents a room owned by the bot. It acts as the central hub for state, memory, and high-level decision making for that room.

- **Responsibilities**:
    -   **State Management**: Tracks RCL changes, energy levels, and threats.
    -   **Overlord Registry**: Instantiates and runs all Overlords (Mining, Construction, etc.).
    -   **Zerg Registry**: Wraps Game.creeps into `Zerg` objects and provides lookups.
    -   **Visualization**: Provides tools like `showPlan()` to visualize the room functionality.

### 2. ColonyProcess (`src/os/processes/ColonyProcess.ts`)
The `ColonyProcess` is the "glue" between the Kernel and the Colony. 

- **Role**: 
    -   It is a kernel `Process` that wraps the `Colony`.
    -   It ensures the `Colony.run()` method is called every tick.
    -   It handles the persistence of the Colony's PID.

### 2.5. LogisticsNetwork (`src/os/logistics/LogisticsNetwork.ts`)
The `LogisticsNetwork` acts as a centralized broker for resource transport within the Colony.

- **Role**:
    -   **Registry**: Maintains transient lists of `providers` (supply), `requesters` (demand), and `buffers` (storage).
    -   **Matching**: Pairs `providers` to `requesters` based on priority and distance to minimize travel time.
    -   **State**: Tracks incoming and outgoing resource reservations using a ledger system to prevent "Energy Racing" (double-booking).
    -   **Buffer Management**: Automatically utilizes Storage as a provider when in surplus.

### 3. Overlords (`src/processes/overlords/*.ts`)
An **Overlord** is a specialized manager for a specific aspect of the Colony. It automates testing, creeping, and tasks.

-   **MiningOverlord**: Manages direct harvesting from a source. Spawns miners and ensures the source is saturated.
-   **ConstructionOverlord**: Manages the automated building of the base layout.
-   **BaseOverlord**: (Abstract) Base class providing utility methods for spawning and creep management.

### 4. Zerg (`src/zerg/Zerg.ts`)
`Zerg` is a wrapper around the standard `Creep` object. It adds:

-   **Intelligent Pathing**: Caches paths to reduce CPU usage (`travelTo`).
-   **Task Management**: Can be assigned high-level tasks (e.g., "Harvest this source") which it executes automatically.
-   **Status Tracking**: Simplifies checking if a creep is spawning, idle, or working.

## Execution Flow

1.  **Main Loop**: Kernel runs `ColonyProcess`.
2.  **ColonyProcess**: Calls `colony.run()`.
3.  **Colony**:
    -   Calls `init()` on all Overlords (pre-run checks, spawn requests).
    -   Calls `run()` on all Overlords (assign tasks).
    -   Calls `run()` on all Zergs (execute tasks/movement).

## Legacy vs. Colony Architecture

The codebase contains some standalone processes (e.g., `MiningProcess.ts`) from an earlier architecture.
-   **New Code**: Should use the `Overlord` pattern within a `Colony`.
-   **Legacy Code**: `MiningProcess`, `UpgradeProcess`. These are effective but less integrated. The goal is to migrate these logic blocks into Overlords.
