# Mining Strategy

The bot utilizes two distinct methods for harvesting energy, transitioning from a mobile workforce to a static infrastructure.

## Harvesters
- **Harvesters**: Basic [WORK, CARRY, MOVE] creeps for early game or recovery.

---
[⬅️ Back to Index](../index.md)
The **Harvester** is the "jack-of-all-trades" creep. It is used in RCL 1 or when a room is recovering from a full wipe.
- **Behavior**: Travels to a source, harvests energy into its own store, and walks back to deliver it to the Spawn or Extension.
- **Body**: Equal parts [WORK, CARRY, MOVE].

## Static Miners (MiningOverlord)
The **Mining Overlord** manages high-efficiency energy extraction.
- **Source Exclusivity**: Each source is assigned exactly one miner creep, preventing pathing overlap and "ghost" harvesting.
- **Static Placement**: Miners occupy the container tile adjacent to a source.
- **Mining Rate**: Bodies are scaled (5x WORK) to deplete a 3000-energy source exactly within its 300-tick regeneration window.

## Source Choice & Reservations
Mining slots are reserved in the **MiningOverlord**'s memory. When a miner spawns, it is pre-assigned to a specific source ID, ensuring zero confusion or "ping-ponging" behavior between sources.
