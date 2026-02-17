# Mining Architecture

The mining system is designed to be modular, predictive, and CPU-efficient. It separates the concerns of site management (`MiningSite`), creep coordination (`MiningOverlord`), and individual creep behavior (`Miner`).

## Core Components

### 1. MiningSite
**Location**: `src/os/colony/MiningSite.ts`

The `MiningSite` represents a source and its immediate surroundings. It is responsible for:
-   **Static Analysis**: Calculating the distance to the colony's storage/spawn and identifying the optimal container position upon instantiation.
-   **Metrics**: Calculating the required hauling power (`calculateHaulingPowerNeeded`) based on the distance and source capacity (Reserve/Owned vs Neutral).
-   **Structure Caching**: Caching references to the Source, Container, and Link.

### 2. MiningOverlord
**Location**: `src/os/processes/economy/MiningOverlord.ts`

The `MiningOverlord` manages the mining operations for the colony. It:
-   **Initialization**: Instantiates a `MiningSite` for every source in the room.
-   **Creep Assignment**: Maps existing `Miner` and `Hauler` creeps to their respective sites.
-   **Spawning**:
    -   **Miners**: Ensures 1 Miner exists per site (Priority: 100).
    -   **Haulers**: Dynamic spawning. Calculates total hauling capacity needed vs current capacity. Requests "Hauler" creeps (Priority: 50) if deficit exists.
    -   **Body Scaling**: Uses the `Hatchery` (via `CreepBody.grow`) to scale creep bodies to the room's energy capacity.

### 3. Miner (Zerg)
**Location**: `src/os/zerg/Miner.ts`

The `Miner` is a specialized Zerg that:
-   Travels to the cached `containerPos`.
-   Harvests the source.
-   Transfers energy to the `Link` (if present and applicable).
-   Repairs the container if needed (and if it has WORK parts/energy).

## Integration

-   **Colony**: `Colony.ts` initializes the `MiningOverlord` in `initOverlords`.
-   **Hatchery**: `Hatchery` handles the actual spawning, including body generation and queue management.
-   **Logistics**: Haulers (currently simple generic creeps) transport energy. Future improvements will integrate them more tightly with the `TransporterOverlord` or dedicated logistics.

## Configuration

-   **Standard Miner Body**: `[WORK, WORK, WORK, WORK, WORK, MOVE]` (5 WORK = 10 energy/tick).
-   **Standard Hauler Template**: `[CARRY, MOVE]`. Scaled by Hatchery.

## Testing

Unit tests are provided in:
-   `test/os/colony/MiningSite.test.ts`: Verifies distance power math.
-   `test/os/processes/economy/MiningOverlord.test.ts`: Verifies spawn request logic.
