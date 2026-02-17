# Automated Infrastructure Planning

The Screeps bot includes an advanced automated planning system designed to autonomously manage base layout and construction. This system removes the need for manual flag placement or hardcoded coordinates.

## Core Components

The planning system consists of four main components:

1.  **Distance Transform (Algorithm)**
2.  **Room Planner (Process)**
3.  **Bunker Layout (Template)**
4.  **Construction Overlord (Execution)**

### 1. Distance Transform (`src/utils/Algorithms.ts`)

The **Distance Transform** algorithm calculates the distance from every tile in the room to the nearest wall. This creates a "height map" where higher values represent larger open spaces.

- **Process**:
    1.  Initializes a `CostMatrix` where walls are 0 and open terrain is 255.
    2.  Performs a two-pass sweep (forward and backward) to calculate distances.
    3.  The resulting matrix is used to find a position with a distance value $\ge 6$, ensuring a 13x13 area (radius 6) fits without hitting walls.

### 2. Room Planner (`src/os/processes/RoomPlannerProcess.ts`)

The **Room Planner** is a process that runs when a new colony is established.

- **Logic**:
    1.  Checks if an `anchor` is already set in `Colony.memory`.
    2.  If not, runs the **Distance Transform** on the room.
    3.  Selects the position with the highest distance value (breaking ties with a heuristic if needed).
    4.  Saves the `anchor` coordinates to memory.
    -   Once the anchor is set, the planner goes to sleep to save CPU.

### 3. Bunker Layout (`src/os/infrastructure/BunkerLayout.ts`)

The **Bunker Layout** defines the standard 13x13 base design relative to the anchor point (0,0).

- **Structure**:
    -   **Center**: Terminal, Link, Storage.
    -   **Inner Ring**: Spawns and critical infrastructure.
    -   **Outer Rings**: Extensions, Labs, and Towers.
    -   **Roads**: A cross and diamond pattern connecting all components.
-   **Extensibility**: The layout is defined as a static map of relative coordinates, making it easy to adjust the design.

### 4. Construction Overlord (`src/processes/overlords/ConstructionOverlord.ts`)

The **Construction Overlord** executes the plan. It runs periodically (every 100 ticks) or when the Room Controller Level (RCL) changes.

- **Duties**:
    1.  **Bunker Check**: Iterates through the `BunkerLayout` and places construction sites if:
        -   The structure is missing.
        -   The structure count allowed by the current RCL has not been met.
    2.  **Road Generation**:
        -   Automatically paths and places roads from the **Anchor** to:
            -   Controller
            -   Sources
-   **Visualization**: Use `Colony.showPlan()` in the console to preview the layout in-game.

## Usage

The system is fully autonomous. 
- **New Rooms**: When you claim a room, the Room Planner will automatically select a location.
- **RCL Upgrades**: As your room levels up, the Construction Overlord will automatically place new extensions, towers, and other structures.
- **Manual Override**: You can manually adjust the `anchor` in `Memory.colonies[roomName].anchor` if you prefer a different location, but the automated selection is generally optimal.
