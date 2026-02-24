// ============================================================================
// Main Loop — Entry point for the Screeps OS
// ============================================================================

import { ErrorMapper } from "./kernel/ErrorMapper";
import { GlobalCache } from "./kernel/GlobalCache";
import { Logger } from "./utils/Logger";
import { Kernel } from "./kernel/Kernel";
// MiningProcess deleted — ColonyProcess runs MiningOverlord directly
// UpgradeProcess deleted — UpgradingOverlord runs within Colony
import { ProfilerProcess } from "./os/processes/ProfilerProcess";
import { ColonyProcess } from "./os/processes/ColonyProcess";
import { SCRIPT_VERSION, SCRIPT_SUMMARY } from "./version";
import { TrafficManager } from "./os/infrastructure/TrafficManager";
import { GlobalManager } from "./kernel/GlobalManager";
import { SegmentManager } from "./kernel/memory/SegmentManager";
import { PathInflationGuard } from "./kernel/PathInflationGuard";

const log = new Logger("OS");

// -------------------------------------------------------------------------
// Season Mode — flip to true before each Season launch
// -------------------------------------------------------------------------
// Season rules differ from the persistent world:
//   • Fixed 100 CPU budget regardless of GCL (Game.cpu.limit returns 20 at GCL 1 — wrong)
//   • No market (Game.market calls throw errors)
//   • Score-resource collection mechanic instead of GCL/GPL
//   • Typically 1 spawn per room hard cap (verify per season announcement)
//
// All subsystems that read Game.cpu.limit or call Game.market should gate on
// SEASON_MODE to avoid incorrect bucket thresholds and market errors.
// -------------------------------------------------------------------------
export const SEASON_MODE = false;          // ← flip to true before season launch
export const SEASON_CPU_CAP = 100;         // Season fixed allocation (persistent = Game.cpu.limit)
export const EFFECTIVE_CPU_CAP = SEASON_MODE ? SEASON_CPU_CAP : Game.cpu.limit;

// Allow runtime toggle from the Screeps console for testing
(global as any).season = {
    enable: () => { (Memory as any).seasonModeOverride = true; return "Season mode ENABLED (takes effect next tick)"; },
    disable: () => { (Memory as any).seasonModeOverride = false; return "Season mode DISABLED"; },
    status: () => `SEASON_MODE=${SEASON_MODE} | EFFECTIVE_CPU_CAP=${EFFECTIVE_CPU_CAP}`,
};


// -------------------------------------------------------------------------
// Console Commands — exposed on global for the Screeps console
// -------------------------------------------------------------------------

(global as any).setLogLevel = (level: string): string => {
    Logger.setLevelByName(level);
    return `Log level set to: ${level}`;
};

/**
 * Force an error from deep inside a process-style call stack.
 * Used to verify source map resolution shows the correct .ts file + line.
 */
(global as any).testError = (): string => {
    function deepNestedCall(): never {
        throw new Error("TEST: Deliberate error from deeply nested code path");
    }
    function middleLayer(): never {
        return deepNestedCall();
    }
    try {
        middleLayer();
    } catch (e: unknown) {
        if (e instanceof Error) {
            const mapped = ErrorMapper.mapTrace(e.stack ?? e.message);
            log.error(`[TEST ERROR] ${mapped}`);
            return mapped;
        }
    }
    return "No error caught";
};

/**
 * Print the persistent error log sorted by most-recently-seen.
 * Run from the Screeps console: showErrors()
 */
(global as any).showErrors = (): string => {
    const entries = ErrorMapper.getErrorLog();
    if (entries.length === 0) {
        return "No errors logged.";
    }
    const lines = entries.map((e, i) => {
        const recency = e.count > 1 ? ` ×${e.count}, last tick ${e.lastTick}` : ` tick ${e.firstTick}`;
        return `[${i + 1}] ${e.message}${recency} (bucket ${e.bucket})\n${e.mappedStack}`;
    });
    return lines.join("\n\n");
};

/**
 * Clear the persistent error log.
 * Run from the Screeps console: clearErrors()
 */
(global as any).clearErrors = (): string => {
    ErrorMapper.clearErrorLog();
    return "Error log cleared.";
};

/**
 * Full bot reset — wipes Memory, heap, and forces a fresh bootstrap.
 * Run from the Screeps console: resetBot()
 */
(global as any).resetBot = (): string => {
    // Nuke Memory
    for (const key in Memory) {
        delete (Memory as any)[key];
    }
    // Nuke heap
    GlobalCache.clear();
    (global as any)._heap = undefined;
    return "🔄 Bot reset complete. Fresh bootstrap will run next tick.";
};

/**
 * Force the orphan adoption cycle to run immediately on all colonies.
 * Normally runs every 50 ticks automatically.
 * Usage: adoptOrphans()
 */
(global as any).adoptOrphans = (): string => {
    const kernel = (global as any).__kernel;
    if (!kernel) return "❌ Kernel not on global — wait one tick and try again.";
    const procs = kernel.getProcessesByName("colony") as any[];
    if (procs.length === 0) return "❌ No colony processes found.";
    let total = 0;
    for (const proc of procs) {
        const colony = proc.colony;
        if (colony) {
            (colony as any).adoptOrphans();
            total++;
        }
    }
    return `✅ Adoption cycle forced on ${total} colony/colonies.`;
};


/**
 * Dump diagnostic info for a named creep.
 *
 * Usage from the Screeps console:
 *   inspectCreep("bootstrap_hauler_W22S38_123456")
 *
 * Reports: position • body • store • overlord • task • path cache •
 *          stuck/oscillation counters • fatigue • nearby sources •
 *          logistics reservations • pending TrafficManager intent.
 */
(global as any).inspectCreep = (name: string): string => {
    const creep = Game.creeps[name];
    if (!creep) {
        // Check if it's dead but still in Memory
        const mem = Memory.creeps?.[name];
        if (mem) return `❌ Creep "${name}" is dead (Memory still exists: ${JSON.stringify(mem)})`;
        return `❌ Creep "${name}" not found in Game.creeps or Memory.`;
    }

    const lines: string[] = [];
    lines.push(`═══════════════════ inspectCreep("${name}") ═══════════════════`);

    // ── 1. Identity & Position ─────────────────────────────────────────────
    lines.push(`📍 POS:     (${creep.pos.x},${creep.pos.y}) in ${creep.pos.roomName} | TTL: ${creep.ticksToLive ?? "spawning"}`);
    lines.push(`💀 BODY:    ${creep.body.map(p => p.type[0].toUpperCase()).join('')}`);
    lines.push(`📦 STORE:   energy=${creep.store.getUsedCapacity(RESOURCE_ENERGY)}/${creep.store.getCapacity(RESOURCE_ENERGY)} | fatigue=${creep.fatigue}`);

    // ── 2. Memory snap ────────────────────────────────────────────────────
    const mem = creep.memory as any;
    lines.push(`🧠 MEMORY:  role=${mem.role ?? "?"} | colony=${mem.colony ?? "?"} | overlord=${mem._overlord ?? "none"} | collecting=${mem.collecting ?? "?"}`);

    // ── 3. Task ───────────────────────────────────────────────────────────
    if (mem.task) {
        const t = mem.task;
        const targetObj = t.targetId ? Game.getObjectById(t.targetId) : null;
        const targetDesc = targetObj
            ? `${(targetObj as any).structureType ?? (targetObj as any).resourceType ?? "obj"} @ (${(targetObj as any).pos?.x},${(targetObj as any).pos?.y})`
            : `id=${t.targetId ?? "none"} (MISSING — target may be dead)`;
        lines.push(`📋 TASK:    ${t.name} → ${targetDesc}`);
    } else {
        lines.push(`📋 TASK:    none`);
    }

    // ── 4. Zerg heap state (path, stuck, oscillation) ────────────────────
    // Colony.zergs is a Map — find the right colony from Memory
    const colonyName: string = mem.colony;
    let zerg: any = null;
    if (colonyName) {
        // Kernel processes aren't on global, but ColonyProcess saves colony on heap via GlobalCache
        // Colonies register Zergs lazily — look up if already registered
        const colonyProcesses = (global as any).__kernel?.getProcessesByName?.("colony") ?? [];
        for (const proc of colonyProcesses) {
            if ((proc as any).colonyName === colonyName) {
                const colony = (proc as any).colony;
                if (colony) zerg = colony.zergs?.get(name);
                break;
            }
        }
    }

    if (zerg) {
        const path = zerg._path;
        lines.push(`🛣️  PATH:    ${path
            ? `step=${path.step}/${path.path.length} ttl=${path.ticksToLive} target=${path.target}`
            : "no cached path"
            }`);
        lines.push(`😵 STUCK:   stuckCount=${zerg._stuckCount} | oscillationCount=${zerg._oscillationCount}`);
        lines.push(`🚧 BLOCKED: blockedPos=${zerg._blockedPos ? `(${zerg._blockedPos.x},${zerg._blockedPos.y})` : "none"}`);
        lines.push(`📜 HIST:    posHistory=${JSON.stringify(zerg._posHistory ?? [])}`);
    } else {
        lines.push(`🛣️  PATH:    Zerg not in heap (global reset wipe? colony="${colonyName ?? "unknown"}")`);
    }

    // ── 5. Surroundings — nearby sources ─────────────────────────────────
    const nearSources = creep.pos.findInRange(FIND_SOURCES, 5) as Source[];
    const nearActive = creep.pos.findInRange(FIND_SOURCES_ACTIVE, 5) as Source[];
    lines.push(`⛏️  SOURCES: ${nearSources.length} in range 5 (${nearActive.length} active) — ${nearSources.map(s => `(${s.pos.x},${s.pos.y}) E=${s.energy}/${s.energyCapacity}`).join(" | ") || "none"
        }`);

    // ── 6. Logistics state ────────────────────────────────────────────────
    if (colonyName) {
        const colonyProcesses2 = (global as any).__kernel?.getProcessesByName?.("colony") ?? [];
        for (const proc of colonyProcesses2) {
            if ((proc as any).colonyName === colonyName) {
                const colony = (proc as any).colony;
                if (colony?.logistics) {
                    const net = colony.logistics;
                    const inRes = net.incomingReservations?.get(name) ?? 0;
                    const outRes = net.outgoingReservations?.get(name) ?? 0;
                    const offerIds: string[] = net.offerIds ?? [];
                    const requests: any[] = net.requesters ?? [];
                    lines.push(`📊 LOGISTICS: self-incoming=${inRes} self-outgoing=${outRes}`);

                    // Show each offer with raw and effective amounts
                    if (offerIds.length === 0) {
                        lines.push(`   OFFERS:   none registered`);
                    } else {
                        for (const oid of offerIds) {
                            const obj = Game.getObjectById(oid as Id<any>);
                            const raw = obj ? (('store' in obj ? (obj as any).store[RESOURCE_ENERGY] : ('amount' in obj ? (obj as any).amount : 0))) : "MISSING";
                            const eff = typeof raw === "number" ? (raw + (net.incomingReservations?.get(oid) ?? 0) - (net.outgoingReservations?.get(oid) ?? 0)) : "?";
                            const type = obj ? (('structureType' in obj) ? (obj as any).structureType : ('amount' in obj ? "drop" : "tomb/ruin")) : "dead";
                            lines.push(`   OFFER:    ${type} raw=${raw} eff=${eff} [${oid.slice(-6)}]`);
                        }
                    }
                    // Show requests summary
                    if (requests.length === 0) {
                        lines.push(`   REQUESTS: none registered`);
                    } else {
                        for (const r of requests) {
                            const incoming = net.incomingReservations?.get(r.targetId) ?? 0;
                            const deficit = r.amount - incoming;
                            lines.push(`   REQUEST:  pri=${r.priority} deficit=${deficit}/${r.amount} [${r.targetId.slice(-6)}]`);
                        }
                    }
                }
                break;
            }
        }
    } else {
        lines.push(`📊 LOGISTICS: colony not in heap`);
    }

    // ── 7. TrafficManager — pending move intent ───────────────────────────
    const DIR_NAMES: Record<number, string> = {
        1: "TOP", 2: "TOP_RIGHT", 3: "RIGHT", 4: "BOTTOM_RIGHT",
        5: "BOTTOM", 6: "BOTTOM_LEFT", 7: "LEFT", 8: "TOP_LEFT"
    };
    const intents: any[] = (TrafficManager as any).intents ?? [];
    const myIntent = intents.find((i: any) => i.zerg?.name === name);
    if (myIntent) {
        lines.push(`🚦 TRAFFIC: dir=${DIR_NAMES[myIntent.direction] ?? myIntent.direction} priority=${myIntent.priority}`);
    } else {
        lines.push(`🚦 TRAFFIC: no pending move intent (already resolved this tick or idle)`);
    }

    lines.push(`═══════════════════════════════════════════════════════════════`);
    const report = lines.join("\n");
    console.log(report);
    return report;
};



// -------------------------------------------------------------------------
// Register ALL process factories (must happen before deserialization)
// Fix #5: Colony registration moved here alongside the others.
// All factories MUST be registered before rehydrateKernel() or
// Kernel.deserialize() can reconstruct processes after a global reset.
// -------------------------------------------------------------------------

// MiningProcess factory removed — mining is now managed by MiningOverlord via Colony

// UpgradeProcess factory removed — upgrading is now managed by UpgradingOverlord via Colony


Kernel.registerProcess(
    "profiler",
    (pid, priority, parentPID, _data) => {
        return new ProfilerProcess(pid, priority, parentPID);
    }
);

Kernel.registerProcess(
    "colony",
    (pid, priority, parentPID, data) => {
        return new ColonyProcess(pid, priority, parentPID, data.colonyName as string);
    }
);

// -------------------------------------------------------------------------
// Foundation Status Report — printed on every global reset
// Fix #1: Removed require("main.js.map") + JSON.stringify CPU bomb.
// Fix #4: Called AFTER kernel.run() so SchedulerMode is accurate.
// -------------------------------------------------------------------------

function printFoundationStatus(kernel: Kernel): void {
    const sourceMapActive = ErrorMapper.isActive();
    const priorityLevels = kernel.getPriorityLevels();
    const mode = kernel.getSchedulerMode();

    const statusLines = [
        `═══════════════════════════════════════════`,
        `  FOUNDATION STATUS (v${SCRIPT_VERSION})`,
        `═══════════════════════════════════════════`,
        `  Source Mapping:  ${sourceMapActive ? "✅ Active" : "❌ Inactive"}`,
        `  Scheduler:       ${priorityLevels.length} priority levels ${JSON.stringify(priorityLevels)}`,
        `  Processes:       ${kernel.processCount} running`,
        `  Bucket:          ${Game.cpu.bucket} / 10000`,
        `  Mode:            ${mode}`,
        `═══════════════════════════════════════════`,
    ];

    log.info(
        statusLines.join("\n")
    );
}

// -------------------------------------------------------------------------
// Rehydration — restore Kernel from Memory after global reset
// -------------------------------------------------------------------------

function rehydrateKernel(): Kernel {
    log.warning(
        `Rehydrating kernel (v${SCRIPT_VERSION}: ${SCRIPT_SUMMARY})`
    );
    const kernel = Kernel.deserialize();
    kernel.saveToHeap();
    log.info(`Rehydrated ${kernel.processCount} processes from Memory`);
    return kernel;
}

// Fix #3: Deleted handleKernelPanic() entirely.
// The Kernel's 3-tier load shedding already skips all non-critical processes
// in EMERGENCY mode. Skipped processes issue zero intents, so their creeps
// naturally sit still at 0.0 CPU. Manually iterating 100+ creeps to call
// creep.say() during a bucket crisis would actively worsen the death spiral.

// -------------------------------------------------------------------------
// Main Loop
// -------------------------------------------------------------------------

export const loop = ErrorMapper.wrapLoop(() => {
    // --- 1. Clean dead creep memory ---
    // Offset to tick 3 to prevent synchronized spikes (Temporal Throttling)
    // Guard: Memory.creeps may be undefined after resetBot() nukes Memory.
    if (Game.time % 100 === 3 && Memory.creeps) {
        // Fetch the pending spawns registry (populated by Hatchery on spawnCreep OK)
        const pendingSpawns = GlobalCache.get<Set<string>>("pendingSpawns") ?? new Set<string>();

        for (const name in Memory.creeps) {
            // Guard: Do not delete if the creep is currently in-utero
            if (!Game.creeps[name] && !pendingSpawns.has(name)) {
                delete Memory.creeps[name];
            }
        }
    }

    // --- 2. Kernel init / restore ---
    const isReset = GlobalCache.isGlobalReset();
    let kernel: Kernel;

    if (isReset) {
        kernel = rehydrateKernel();
    } else {
        const cached = Kernel.loadFromHeap();
        if (cached) {
            kernel = cached;
        } else {
            log.warning("Kernel not in heap — deserializing from Memory");
            kernel = rehydrateKernel();
        }
    }

    // --- 3. Prune stale colony processes (handles respawn) ---
    pruneStaleColonies(kernel);

    // Expose kernel for console debug tools (inspectCreep etc.)
    (global as any).__kernel = kernel;

    // --- 4. Global Manager — spawn colony processes for owned rooms ---
    GlobalManager.init(kernel);

    // --- 5. Ensure profiler process exists ---
    ensureProfiler(kernel);

    // --- 5b. Staggered Path Inflation Guard ---
    // Must run BEFORE kernel.run() so the per-tick budget is ready when
    // Zerg.travelTo() calls canInflate(). On reset ticks, informs the guard
    // so it opens the ramp window.
    PathInflationGuard.tick(isReset);

    // --- 6. Run the scheduler ---
    kernel.run();

    // --- 7. Foundation Status AFTER kernel.run() ---
    // Fix #4: Moved after kernel.run() so SchedulerMode, processCount,
    // and priority levels reflect the actual state of this tick.
    if (isReset) {
        printFoundationStatus(kernel);
    }

    // --- 8. Run Traffic Manager (Intent Resolution Order) ---
    // Must run AFTER kernel.run() so all process move intents are queued
    // before TrafficManager resolves conflicts and executes moves.
    // Wrapped in try/catch to guarantee the persistence layer (step 9)
    // always executes. A freak pathing bug must never prevent state saves.
    try {
        TrafficManager.run();
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const mapped = ErrorMapper.mapTrace(err.stack ?? err.message);
        log.error(`TrafficManager crashed (non-fatal):\n${mapped}`);
        ErrorMapper.persistError(err);
    }

    // --- 9. Persist state (Heap-First) ---
    kernel.serialize();

    // Commit all heap-first managers
    GlobalCache.commit();    // Flush dirty heap objects to Memory.heap
    GlobalManager.run();
    SegmentManager.commit(); // Set active segments for next tick

    // --- 10. Memory Usage Report (Console) ---
    // Offset by 47 ticks to avoid collision with Memory cleanup
    if (Game.time % 100 === 47) {
        const heap = Game.cpu.getHeapStatistics?.();
        const heapUsed = heap ? (heap.used_heap_size / 1024 / 1024).toFixed(2) : "N/A";
        const bucket = Game.cpu.bucket;
        log.info(`⚙️ [System] Heap: ${heapUsed} MB | Bucket: ${bucket}`);
    }
});

// -------------------------------------------------------------------------
// Prune Stale Colonies — detect respawn and remove dead colony processes
// Fix #2: Removed dead reference to ColonyProcess.colonies[colonyName].
// -------------------------------------------------------------------------

function pruneStaleColonies(kernel: Kernel): void {
    const colonyProcs = kernel.getProcessesByName("colony");
    let pruned = 0;

    for (const proc of colonyProcs) {
        const colonyName = (proc as ColonyProcess).colonyName;
        const room = Game.rooms[colonyName];

        // In Screeps, owning a controller grants permanent visibility.
        // If the room is undefined, we absolutely do not own it anymore
        // (e.g., we respawned in a new sector). Aggressively prune.
        if (!room || !room.controller || !room.controller.my) {
            log.warning(`Pruning stale colony process for ${colonyName} (no longer owned)`);
            kernel.removeProcess(proc.pid);

            // Purge the Colony data object from the Heap Cache
            GlobalCache.delete(`ColonyObj:${colonyName}`);

            pruned++;
        }
    }

    if (pruned > 0) {
        log.info(`Pruned ${pruned} stale colony processes`);
    }
}

// -------------------------------------------------------------------------
// Ensure the profiler process is always running
// -------------------------------------------------------------------------

function ensureProfiler(kernel: Kernel): void {
    if (kernel.hasProcessId("profiler:global")) {
        return;
    }

    const proc = new ProfilerProcess(0, 0, null);
    kernel.addProcess(proc);
    log.info(`→ ProfilerProcess (PID ${proc.pid}, priority 0)`);
}
