# Defense & Military

Security is paramount. The **Defense Manager** and **Defense Roles** ensure the room remains safe from invaders and structure decay.

## Room Defense
6.  **Tower Management**: Towers prioritize attacking the weakest hostile creep in the room. If no hostiles are present, they repair critical structures or heal friendly creeps.
7.  **Emergency Defense Priority (v2.5)**: If hostiles are detected, the **Spawn Manager** pivots to a "War Economy." It prioritizes spawning a `defender` immediately after critical harvesters are secured, pausing non-essential infrastructure.
8.  **Controller Proximity Targeting**: Defenders are optimized to seek out and engage hostiles camping near the Room Controller (Range 3), preventing claim-blocking or controller harassment.
9.  **Safe Mode**: The room will trigger Safe Mode automatically if the controller or critical structures are under heavy threat.

## Maintenance & Repairs
Builders take on the role of maintenance crews when not building new structures:
- **Decay Prevention**: Roads and Containers are repaired once they drop below a health threshold.
- **Wall/Rampart Strengthening**: In later stages, idle builders dedicate energy to reinforcing defensive barriers.

## Scouting & Intel
The **Scout** role and **Intel Manager** work together to map the neighborhood:
- **Scan Rooms**: Record room state (owner, level, sources) into global memory.
- **Identify Targets**: Mark potential expansion rooms for the Remote Manager.
- **Signs**: Scouts leave "Dungeon Crawler Carl" themed quotes on neutral or hostile controllers to assert dominance.

---
[⬅️ Back to Index](../index.md)
