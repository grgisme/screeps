# Base Planning & Construction

# Infrastructure & Planning

The **Infrastructure Overlord** coordinates the construction of all structures, utilizing the **RoomPlanner** to evolve the base from a simple campfire into a fortified bunker.

## 📐 RoomPlanner (v2.0)
The RoomPlanner uses a **Distance Transform** algorithm to identify the most efficient location for your base.

1.  **Anchor Selection**: It identifies the "Deepest" spot in the room (farthest from walls) to serve as the **Bunker Anchor**.
2.  **Distance Transform (DT)**: Calculates a score for every tile based on its distance from natural barriers.
3.  **Bunker Stamp**: Applies a pre-defined 7x7 bunker template at the anchor, ensuring optimal placement of extensions, towers, and storage.

- **`Planner.visualize(roomName)`**: Renders the DT heatmap and the planned bunker layout on your screen.
- **`Planner.plan(roomName)`**: Lists exactly what structures are missing at the current RCL.

## Structure Roadmap

| RCL | Goal | Overlord Logic |
| :--- | :--- | :--- |
| **1-2** | Bootstrap | Placing paths to Sources and the Controller. Extensions checkboard around Anchor. |
| **3** | Fortification | First Tower placement and core Rampart security. |
| **4** | Central Storage | Storage placed exactly at the Anchor (DT peak) for logistics efficiency. |
| **5-8** | Industrialization | Expanding the bunker footprint and fortifying the perimeter. |

## Dynamic Flow Awareness
The Infrastructure Overlord ensures that your core lanes are never blocked. It cross-references the RoomPlanner's "Ideal Lanes" against current construction sites to ensure maximum throughput for Haulers.

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
