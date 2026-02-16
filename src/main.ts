/**
 * main.ts - Entry point for the Screeps bot.
 *
 * This file instantiates the Kernel, registers all process factories,
 * and delegates the game loop to kernel.run() inside ErrorMapper + profiler.
 *
 * All legacy manager/role logic is wrapped in lightweight Process subclasses
 * and executed by the Scheduler in priority order.
 */
import { managerSpawn } from "./manager.spawn";
import { roleHarvester } from "./role.harvester";
import { roleUpgrader } from "./role.upgrader";
import { roleBuilder } from "./role.builder";
import { reporting } from "./reporting";
import { managerDefense } from "./manager.defense";
import { roleHauler } from "./role.hauler";
import { roleScout } from "./role.scout";
import { managerRemote } from "./manager.remote";
import { managerMarket } from "./manager.market";
import { roleDefender } from "./role.defender";
import { roleReserver } from "./role.reserver";
import { roleClaimer } from "./role.claimer";
import { toolsSimulation } from "./tools.simulation";
import { toolsInspector } from "./tools.inspector";
import { managerMemory } from "./manager.memory";
import { SCRIPT_VERSION, SCRIPT_SUMMARY } from "./version";
import { ErrorMapper } from "./utils.errorMapper";
import { prototypesLoaded } from "./prototypes/roomPosition";
import { Kernel } from "./os/Kernel";
import { Process, ProcessEntry, PRIORITY } from "./os/Process";
import { SegmentManagerProcess } from "./os/SegmentManager";
import { heap } from "./os/Heap";
import { initColonies, getAllColonies } from "./colony/Colony";
import { trafficManager } from "./movement/TrafficManager";
import { roomPlanner } from "./planning/RoomPlanner";
import * as profiler from "screeps-profiler";

// ─── ENABLE PROFILER & PROTOTYPES ──────────────────────────────────
profiler.enable();
const _proto = prototypesLoaded;

// ─── PROCESS WRAPPERS ──────────────────────────────────────────────
// Each wrapper adapts an existing manager/role module into a Process subclass.

/** Runs a callback function for each owned room */
function forEachOwnedRoom(fn: (room: Room) => void): void {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (room.controller && room.controller.my) {
            fn(room);
        }
    }
}

/** Run a role function for each creep matching the given role(s) */
function forEachCreepWithRole(roles: string[], fn: (creep: Creep) => void): void {
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (roles.includes(creep.memory.role)) {
            fn(creep);
        }
    }
}

// --- Creep Recovery Process (runs once on boot) ---
class CreepRecoveryProcess extends Process {
    private hasRun = false;
    constructor() { super('creep-recovery', 'creep-recovery', PRIORITY.CRITICAL); }
    run(): void {
        if (this.hasRun) { this.suspend(999999); return; }
        console.log(`\n\n>>> 🚨 NEW CODE LOADED / GLOBAL RESET (Tick ${Game.time}) [v${SCRIPT_VERSION} - ${SCRIPT_SUMMARY}] 🚨 <<<\n\n`);

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const workParts = creep.getActiveBodyparts(WORK);
            const carryParts = creep.getActiveBodyparts(CARRY);
            const moveParts = creep.getActiveBodyparts(MOVE);

            let oldRole = creep.memory.role;
            let newRole = oldRole;

            if (workParts >= 5) {
                newRole = 'miner';
            } else if (workParts > 0 && carryParts > 0) {
                if (oldRole === 'miner' || !oldRole) newRole = 'harvester';
            } else if (carryParts > 0 && workParts === 0) {
                if (oldRole !== 'hauler') newRole = 'hauler';
            }

            if (!creep.memory.role) {
                const mem = creep.memory as any;
                if (mem.type === 'Miner' || creep.name.startsWith('Miner')) {
                    newRole = 'miner';
                } else if (workParts > 0) {
                    newRole = 'harvester';
                } else {
                    newRole = 'hauler';
                }
            }

            if (newRole !== oldRole) {
                creep.memory.role = newRole;
                creep.memory.working = false;
                delete creep.memory.targetId;
                console.log(`♻️ RECLASSIFIED: ${creep.name} (${oldRole} -> ${newRole}) [W${workParts}C${carryParts}M${moveParts}]`);
            }
        }
        this.hasRun = true;
        this.suspend(999999); // Only runs once
    }
    init(entry?: ProcessEntry): void { super.init(entry); this.hasRun = false; }
    toString(): string { return '🔧 Creep Recovery'; }
}

// --- Memory Cleanup Process ---
class MemoryCleanupProcess extends Process {
    constructor() { super('memory-cleanup', 'memory-cleanup', PRIORITY.LOW); }
    run(): void { managerMemory.run(); }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🧹 Memory Cleanup'; }
}

// --- Defense Process (CRITICAL — always runs) ---
class DefenseProcess extends Process {
    constructor() { super('defense', 'defense', PRIORITY.CRITICAL); }
    run(): void { forEachOwnedRoom(room => managerDefense.run(room)); }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🛡️ Defense'; }
}

// --- Spawn Management Process ---
class SpawnProcess extends Process {
    constructor() { super('spawn', 'spawn', PRIORITY.HIGH); }
    run(): void { forEachOwnedRoom(room => managerSpawn.run(room)); }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🏭 Spawn Manager'; }
}

// --- Mining Process (Harvesters + Miners) ---
class MiningProcess extends Process {
    constructor() { super('mining', 'mining', PRIORITY.HIGH); }
    run(): void {
        forEachCreepWithRole(['harvester', 'miner'], creep => roleHarvester.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '⛏️ Mining'; }
}

// --- Logistics Process (Haulers) ---
class LogisticsProcess extends Process {
    constructor() { super('logistics', 'logistics', PRIORITY.HIGH); }
    run(): void {
        forEachCreepWithRole(['hauler'], creep => roleHauler.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🚚 Logistics'; }
}

// --- Building Process ---
class BuildingProcess extends Process {
    constructor() { super('building', 'building', PRIORITY.NORMAL); }
    run(): void {
        forEachCreepWithRole(['builder'], creep => roleBuilder.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🏗️ Building'; }
}

// --- Upgrade Process ---
class UpgradeProcess extends Process {
    constructor() { super('upgrade', 'upgrade', PRIORITY.NORMAL); }
    run(): void {
        forEachCreepWithRole(['upgrader'], creep => roleUpgrader.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '📈 Upgrading'; }
}

// --- Market Process ---
class MarketProcess extends Process {
    constructor() { super('market', 'market', PRIORITY.LOW); }
    run(): void { forEachOwnedRoom(room => managerMarket.run(room)); }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '💰 Market'; }
}

// --- Reporting Process ---
class ReportingProcess extends Process {
    constructor() { super('reporting', 'reporting', PRIORITY.LOW); }
    run(): void { forEachOwnedRoom(room => reporting.run(room)); }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '📊 Reporting'; }
}

// --- Remote/Expansion Process ---
class ExpansionProcess extends Process {
    constructor() { super('expansion', 'expansion', PRIORITY.DEFERRED); }
    run(): void {
        const ownedRooms: Room[] = [];
        forEachOwnedRoom(room => ownedRooms.push(room));
        if (ownedRooms.length > 0) managerRemote.run(ownedRooms);
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🌍 Expansion'; }
}

// --- Scout Process ---
class ScoutProcess extends Process {
    constructor() { super('scouting', 'scouting', PRIORITY.DEFERRED); }
    run(): void {
        forEachCreepWithRole(['scout'], creep => roleScout.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🔭 Scouting'; }
}

// --- Defender Creep Process ---
class DefenderCreepProcess extends Process {
    constructor() { super('defender-creeps', 'defender-creeps', PRIORITY.CRITICAL); }
    run(): void {
        forEachCreepWithRole(['defender'], creep => roleDefender.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '⚔️ Defender Creeps'; }
}

// --- Claimer/Reserver Process ---
class ClaimProcess extends Process {
    constructor() { super('claiming', 'claiming', PRIORITY.DEFERRED); }
    run(): void {
        forEachCreepWithRole(['claimer'], creep => roleClaimer.run(creep));
        forEachCreepWithRole(['reserver'], creep => roleReserver.run(creep));
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🏴 Claiming'; }
}

// --- Colony Process (Runs all Colonies / Overlords) ---
class ColonyProcess extends Process {
    constructor() { super('colonies', 'colonies', PRIORITY.HIGH); }
    run(): void {
        initColonies(); // Ensure all owned rooms have Colonies
        for (const colony of getAllColonies()) {
            colony.run();
        }
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string {
        const count = getAllColonies().length;
        return `🏰 Colonies (${count})`;
    }
}

// --- Traffic Process (Path visuals + GC) ---
class TrafficProcess extends Process {
    constructor() { super('traffic', 'traffic', PRIORITY.LOW); }
    run(): void {
        trafficManager.drawVisuals();
        // GC dead creep move states every 10 ticks
        if (Game.time % 10 === 0) trafficManager.gc();
    }
    init(entry?: ProcessEntry): void { super.init(entry); }
    toString(): string { return '🚦 Traffic'; }
}

// ─── KERNEL SETUP ──────────────────────────────────────────────────

const kernel = new Kernel();

// Register all process factories.
// The factory function creates a process and optionally restores saved state.
kernel.registerProcess('creep-recovery', (e) => { const p = new CreepRecoveryProcess(); p.init(e); return p; });
kernel.registerProcess('memory-cleanup', (e) => { const p = new MemoryCleanupProcess(); p.init(e); return p; });
kernel.registerProcess('defense', (e) => { const p = new DefenseProcess(); p.init(e); return p; });
kernel.registerProcess('spawn', (e) => { const p = new SpawnProcess(); p.init(e); return p; });
kernel.registerProcess('mining', (e) => { const p = new MiningProcess(); p.init(e); return p; });
kernel.registerProcess('logistics', (e) => { const p = new LogisticsProcess(); p.init(e); return p; });
kernel.registerProcess('building', (e) => { const p = new BuildingProcess(); p.init(e); return p; });
kernel.registerProcess('upgrade', (e) => { const p = new UpgradeProcess(); p.init(e); return p; });
kernel.registerProcess('market', (e) => { const p = new MarketProcess(); p.init(e); return p; });
kernel.registerProcess('reporting', (e) => { const p = new ReportingProcess(); p.init(e); return p; });
kernel.registerProcess('expansion', (e) => { const p = new ExpansionProcess(); p.init(e); return p; });
kernel.registerProcess('scouting', (e) => { const p = new ScoutProcess(); p.init(e); return p; });
kernel.registerProcess('defender-creeps', (e) => { const p = new DefenderCreepProcess(); p.init(e); return p; });
kernel.registerProcess('claiming', (e) => { const p = new ClaimProcess(); p.init(e); return p; });
kernel.registerProcess('segments', (e) => { const p = new SegmentManagerProcess(); p.init(e); return p; });
kernel.registerProcess('colonies', (e) => { const p = new ColonyProcess(); p.init(e); return p; });
kernel.registerProcess('traffic', (e) => { const p = new TrafficProcess(); p.init(e); return p; });

// ─── GLOBAL TOOLS (Console Utilities) ──────────────────────────────

const tools: Record<string, any> = {
    Sim: toolsSimulation,
    Inspect: toolsInspector.inspect,
    Kernel: kernel, // Expose kernel to console: Kernel.suspend('mining', 10)
    Heap: heap,     // Expose heap to console: Heap.stats()
    Traffic: {
        stats: () => trafficManager.stats(),
        visuals: (on: boolean) => { trafficManager.setVisuals(on); return on ? '👁️ Visuals ON' : '👁️ Visuals OFF'; },
    },
    Planner: {
        visualize: (roomName: string) => roomPlanner.visualize(roomName),
        anchor: (roomName: string) => {
            const a = roomPlanner.recalculateAnchor(roomName);
            return a ? `⚓ Anchor: (${a.x}, ${a.y}) DT=${a.distance}` : '❌ No valid anchor';
        },
        plan: (roomName: string) => {
            const room = Game.rooms[roomName];
            const rcl = room?.controller?.level || 0;
            const missing = roomPlanner.getMissingStructures(roomName, rcl);
            const roads = roomPlanner.getMissingRoads(roomName);
            return `🏗️ ${missing.length} structures + ${roads.length} roads to build at RCL ${rcl}`;
        },
    },
    Status: () => {
        const ownedRooms = Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
        if (ownedRooms.length === 0) return "❌ No owned rooms found.";
        for (const room of ownedRooms) {
            console.log(managerSpawn.getQueueReport(room));
        }
        console.log(kernel.scheduler.getReport());
        return "Report generated.";
    },
    Replan: (roomName: string) => {
        const a = roomPlanner.recalculateAnchor(roomName);
        return a ? `🔄 Replan triggered for ${roomName}. Anchor: (${a.x}, ${a.y}) DT=${a.distance}` : '❌ No valid anchor';
    }
};

for (const [key, value] of Object.entries(tools)) {
    Object.defineProperty(global, key, { value, configurable: true, writable: true });
}

// ─── GAME LOOP ─────────────────────────────────────────────────────

export const loop = ErrorMapper.wrapLoop(() => {
    profiler.wrap(() => {
        kernel.run();
    });
});
