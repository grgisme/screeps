---
layout: default
title: Home
---

# Screeps OS — Documentation

A fully autonomous AI bot for [Screeps](https://screeps.com/), built on a custom operating system kernel with process scheduling, priority-based load shedding, and a modular colony management layer.

---

## Table of Contents

### Architecture
- [Architecture Overview](architecture) — Layered design, data flow, and design philosophy
- [Folder Structure](folder-structure) — Annotated source tree
- [Main Loop & Boot Sequence](main-loop) — Step-by-step tick walkthrough

### Kernel
- [Kernel & Scheduler](kernel) — Process scheduling, CPU governor, load shedding
- [Process Model](processes) — Lifecycle, sleep/wake, serialization, coroutines
- [GlobalCache & Memory](global-cache) — Heap-first storage, rehydration, global reset detection

### Colony (OS Layer)
- [Colony System](colony) — Central room coordinator
- [Hatchery & Spawning](hatchery) — Priority spawn queue, emergency mode
- [Logistics Network](logistics) — Resource request/offer matching
- [Link Network](link-network) — Inter-link energy transfers

### Execution (OS Layer)
- [Overlords](overlords) — Task managers and creep roles
- [Directives](directives) — Flag-driven mission objectives
- [Zerg (Creep Wrapper)](zerg) — Heap-safe creep abstraction
- [Task System](tasks) — Atomic, serializable actions

### Infrastructure
- [Bunker Layout](bunker-layout) — 13×13 base blueprint
- [Traffic Manager](traffic-manager) — Priority-based movement resolution

### Reference
- [Design Patterns](design-patterns) — V8 safety, IoC, intent caching, and more

---

> **Tip:** Use the links above to navigate. Every page links back here and cross-references related systems.
