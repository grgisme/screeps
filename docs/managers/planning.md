# Base Planning & Construction

The **Building Manager** handles the automated placement of all structures, evolving the base from a simple campfire into a fortified bunker.

## The Bunker Center
All major infrastructure revolves around a **Bunker Center**.
- **Phase 1 (Bootstrap, RCL 1-3)**: The center is established at a clear 3x3 spot within range 5 of the initial Spawn.
- **Phase 2 (Fortress, RCL 4+)**: The manager re-evaluates the entire room for a 5x5 clear area to facilitate a grander endgame layout.
- **Manual Control**: Placing a flag named `CENTER` will force the bunker center to that exact position.

## Structure Roadmap by RCL

| RCL | Structure | Priority & Placement Logic |
| :--- | :--- | :--- |
| **1** | Roads | **Skeleton**: Direct paths from Spawn to Sources and the Controller. |
| **2** | Extensions | Placed in a **Checkerboard Spiral** around the Bunker Center. |
| **2** | Containers | **Source Containers**: Placed 1 tile away from each Source to facilitate static mining. |
| **3** | Tower | Placed at an offset (1,1) from the Bunker Center for maximum coverage. |
| **3** | Ramparts | **Spawn & Tower Protection**: Placed immediately to secure the base core. |
| **3** | Containers | **Controller Container**: Placed 2 tiles away from the Controller for Upgraders. |
| **4** | Storage | Placed exactly at the **Bunker Center**. |
| **4** | Ramparts | Placed protectively over the Storage and future critical nodes. |

## Dynamic Path Awareness (v2.11)
The Building Manager now performs a **Pathing Pass** before placing extensions. It identifies the "Ideal Lanes" between your Sources and the Bunker Hub (Spawn/Tower) and blacklists those tiles for structure placement. This ensures that even at max extensions, your core energy transport remains unblocked.
- **`Plan()`**: Draws the yellow spiral and bunker dots on the map for your preview.
- **`Replan()`**: Wipes the current plan and forces a re-scan of the room (e.g., if you want to shift the bunker after clearing terrain).

## Construction Priority
Builders use a weighted priority system to decide what to build first:
1. **Spawn** (Critical Recovery)
2. **Extensions** (Energy Scaling)
3. **Containers** (Logistics)
4. **Storage**
5. **Towers** (Defense)
6. **Roads** (Mobility)

*Note: In "War Mode", Towers and Ramparts jump to the top of the list.*

---
[⬅️ Back to Index](../index.md)
