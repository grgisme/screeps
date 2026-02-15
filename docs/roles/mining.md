# Mining Strategy

The bot utilizes two distinct methods for harvesting energy, transitioning from a mobile workforce to a static infrastructure.

## Harvesters (Early Game / Recovery)
The **Harvester** is the "jack-of-all-trades" creep. It is used in RCL 1 or when a room is recovering from a full wipe.
- **Behavior**: Travels to a source, harvests energy into its own store, and walks back to deliver it to the Spawn or Extension.
- **Body**: Equal parts [WORK, CARRY, MOVE].

## Static Miners (Mid & Late Game)
Once a **Structure Container** is built adjacent to a source, the bot switches to **Static Miners**.
- **Behavior**: Sits directly on top of the container and mines until the source is depleted. It never leaves its spot.
- **Efficiency**: Since it doesn't need to walk, it can dedicate all its energy to `WORK` parts (standard: 5x WORK, 1x MOVE).
- **Logistics**: Relies entirely on **Haulers** to move the energy from the container to the base.

## Source Choice
Creeps use a **Reservation System** to ensure they don't crowd the same source. When multiple sources are available, they will pick the one with the most available "slots" or the one that isn't already being mined by a heavy miner.
