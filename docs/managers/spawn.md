# Spawn Management

The **Spawn Manager** is the brain of the room's economy. It determines which creeps are needed and how to scale them based on available energy.

## Spawn Priority
The manager evaluates the room every tick and follows this strict hierarchy:

1.  **Critical Recovery**: If 0 creeps exist, immediately spawn a basic harvester.
2.  **Static Miners**: If containers exist at sources, spawn heavy miners (5x WORK) to maximize harvesting.
3.  **Haulers**: If miners exist, spawn haulers to transport energy from mines to the base.
4.  **Upgraders**: Maintain at least one upgrader to keep the controller from decaying.
5.  **Builders**: Spawn only if there are active construction sites.

## Scaling Logic
Creep bodies are calculated dynamically using the `bodyBuilder` utility:
- **Harvesters**: Balanced [WORK, CARRY, MOVE].
- **Miners**: 5x WORK, 1x MOVE (Optimized for static mining).
- **Haulers**: 1:1 ratio of [CARRY, MOVE].

## Rebalancing
If there's an excess of one role (e.g., too many harvesters after static mining is set up), the manager will automatically "retrain" them into haulers or upgraders to maintain efficiency.
