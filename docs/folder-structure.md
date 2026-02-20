---
layout: default
title: Folder Structure
---

# Folder Structure

[← Home](index)

```
screeps/
├── docs/                   # ← You are here (GitHub Pages documentation)
├── research/               # Architecture research PDFs
├── src/
│   ├── main.ts             # Entry point — ErrorMapper-wrapped game loop
│   ├── version.ts          # SCRIPT_VERSION constant
│   ├── types.d.ts          # Global type declarations (_heap, Memory, etc.)
│   │
│   ├── kernel/             # ── Kernel Layer ──────────────────────────
│   │   ├── Kernel.ts       # Process scheduler, CPU governor, wake map
│   │   ├── Process.ts      # Abstract base class for all processes
│   │   ├── ProcessStatus.ts# ALIVE / SLEEP / DEAD constants
│   │   ├── GlobalCache.ts  # Heap-first state management
│   │   ├── GlobalManager.ts# Colony bootstrapping per tick
│   │   ├── ErrorMapper.ts  # Source-map error wrapping
│   │   └── memory/
│   │       └── SegmentManager.ts  # Raw Memory segment read/write
│   │
│   ├── os/                 # ── OS Layer ──────────────────────────────
│   │   ├── colony/         # Colony data containers
│   │   │   ├── Colony.ts           # Central room coordinator
│   │   │   ├── Hatchery.ts         # Spawn queue & emergency mode
│   │   │   ├── LogisticsNetwork.ts # Resource request/offer matching
│   │   │   ├── LinkNetwork.ts      # Inter-link energy transfers
│   │   │   └── MiningSite.ts       # Source + container/link infrastructure
│   │   │
│   │   ├── overlords/      # Task managers (one per role)
│   │   │   ├── Overlord.ts         # Abstract base with subreaper adoption
│   │   │   ├── MiningOverlord.ts   # Static source miners
│   │   │   ├── TransporterOverlord.ts # Haulers via LogisticsNetwork
│   │   │   ├── ConstructionOverlord.ts# Bunker plan → construction sites
│   │   │   ├── WorkerOverlord.ts   # Build + repair
│   │   │   ├── UpgradingOverlord.ts# Controller upgraders
│   │   │   ├── TerminalOverlord.ts # Market/terminal operations
│   │   │   ├── DefenseOverlord.ts  # Tower control & military
│   │   │   ├── DestroyerOverlord.ts# Offensive dismantlers
│   │   │   ├── RemoteMiningOverlord.ts # Remote room miners
│   │   │   ├── ReserverOverlord.ts # Remote room reservation
│   │   │   └── ScoutOverlord.ts    # Room visibility scouts
│   │   │
│   │   ├── directives/     # Flag-driven mission objectives
│   │   │   ├── Directive.ts        # Abstract base class
│   │   │   └── HarvestDirective.ts # Remote harvest orchestration
│   │   │
│   │   ├── tasks/          # Atomic, serializable actions
│   │   │   ├── ITask.ts            # Interface + TaskMemory + TaskSettings
│   │   │   ├── HarvestTask.ts      # Harvest a Source
│   │   │   ├── BuildTask.ts        # Build a ConstructionSite
│   │   │   ├── RepairTask.ts       # Repair a Structure
│   │   │   ├── UpgradeTask.ts      # Upgrade the Controller
│   │   │   ├── TransferTask.ts     # Transfer resources to a target
│   │   │   ├── WithdrawTask.ts     # Withdraw resources from a target
│   │   │   ├── PickupTask.ts       # Pick up dropped resources
│   │   │   └── ReserveTask.ts      # Reserve a remote controller
│   │   │
│   │   ├── zerg/           # Creep wrappers
│   │   │   ├── Zerg.ts             # Base wrapper (intent caching, movement)
│   │   │   ├── Miner.ts            # Miner specialization
│   │   │   ├── Transporter.ts      # Transporter specialization (legacy)
│   │   │   ├── CombatZerg.ts       # Combat specialization
│   │   │   ├── Upgrader.ts         # Upgrader stub
│   │   │   └── Worker.ts           # Worker stub
│   │   │
│   │   ├── infrastructure/ # Static layouts & traffic
│   │   │   ├── BunkerLayout.ts     # 13×13 bunker coordinate blueprint
│   │   │   └── TrafficManager.ts   # Priority-based movement resolution
│   │   │
│   │   └── processes/      # Concrete Process implementations
│   │       ├── ColonyProcess.ts    # Wraps Colony for Kernel scheduling
│   │       └── ProfilerProcess.ts  # CPU & scheduler monitoring
│   │
│   └── utils/              # ── Utilities ─────────────────────────────
│       ├── Logger.ts       # Leveled logging with emoji prefixes
│       ├── Algorithms.ts   # Min-cut, flood fill, etc.
│       ├── CreepBody.ts    # Body part template scaling
│       └── RoomPosition.ts # Position utilities
│
├── test/                   # Mocha + Chai test suite
├── dist/                   # Rollup build output
├── package.json            # Dependencies & scripts
├── rollup.config.mjs       # Bundle configuration
└── tsconfig.json           # TypeScript configuration
```

---

## Key Conventions

| Convention | Rule |
|---|---|
| **One class per file** | Every `.ts` file exports a single primary class or interface |
| **Lowercase kebab directories** | All folder names use lowercase (`colony/`, `overlords/`, `tasks/`) |
| **Type-only imports** | Use `import type` for cross-layer references to avoid circular deps |
| **Co-located tests** | Tests mirror `src/` structure under `test/` |

---

**Related:** [Architecture Overview](architecture) · [Main Loop](main-loop)
