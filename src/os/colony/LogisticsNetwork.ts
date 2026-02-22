// ============================================================================
// LogisticsNetwork — Atomic task-based resource logistics
// ============================================================================
//
// ⚠️ ID-ONLY PATTERN (V8 MEMORY LEAK PREVENTION)
// ══════════════════════════════════════════════
// Stores IDs only. Resolves live objects via Game.getObjectById() in methods.
// Reservation maps are cleared + rebuilt from active tasks each tick.
// ============================================================================

import type { Colony } from "./Colony";
import type { Zerg } from "../zerg/Zerg";
import { WithdrawTask } from "../tasks/WithdrawTask";
import { TransferTask } from "../tasks/TransferTask";
import { Logger } from "../../utils/Logger";
import { stableMatch, MatchProposer, MatchReceiver } from "../../utils/Algorithms";

const log = new Logger("Logistics");

export interface LogisticsRequest {
    targetId: Id<Structure | Resource>;
    amount: number;
    resourceType: ResourceConstant;
    priority: number;
}

export class LogisticsNetwork {

    offerIds: Id<Structure | Resource>[] = [];
    requesters: LogisticsRequest[] = [];
    incomingReservations: Map<string, number>;
    outgoingReservations: Map<string, number>;
    colony: Colony;

    constructor(colony: Colony) {
        this.colony = colony;
        this.offerIds = [];
        this.requesters = [];
        this.incomingReservations = new Map();
        this.outgoingReservations = new Map();
    }

    // -----------------------------------------------------------------------
    // Refresh — clear everything each tick
    // -----------------------------------------------------------------------

    refresh(): void {
        this.offerIds = [];
        this.requesters = [];
        this.incomingReservations.clear();
        this.outgoingReservations.clear();
    }

    // -----------------------------------------------------------------------
    // Init — register infrastructure offers/requests + rebuild ledger
    // -----------------------------------------------------------------------

    init(): void {
        // 1. Register infrastructure offers/requests
        this.registerInfrastructure();

        // 2. Rebuild the true ledger from active tasks
        this.rebuildLedger();

        log.throttle(50, () => `Online: [${this.offerIds.length}] Offers, [${this.requesters.length}] Requesters registered.`);
    }

    private registerInfrastructure(): void {
        // ── Fix #4: Scavenge dropped energy and tombstones ────────────
        const dropped = this.colony.room?.find(FIND_DROPPED_RESOURCES, {
            filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
        }) || [];
        for (const r of dropped) this.offerIds.push(r.id as Id<Structure | Resource>);

        const tombstones = this.colony.room?.find(FIND_TOMBSTONES, {
            filter: (t: Tombstone) => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        }) || [];
        for (const t of tombstones) this.offerIds.push(t.id as unknown as Id<Structure | Resource>);

        // ── Fix #4: Storage — always offer + always request (priority 0 sink) ──
        if (this.colony.room?.storage) {
            const storage = this.colony.room.storage;
            if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.offerIds.push(storage.id as Id<Structure | Resource>);
            }
            if (storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                this.requestInput(storage.id as Id<Structure | Resource>, {
                    amount: storage.store.getFreeCapacity(RESOURCE_ENERGY),
                    priority: 0.1 // 0.1 prevents math from zeroing out
                });
            }
        }

        // ── Controller Container — local energy buffer for upgraders ──
        const controller = this.colony.room?.controller;
        if (controller) {
            const ctrlContainers = controller.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
            }) as StructureContainer[];

            for (const c of ctrlContainers) {
                // Requester only — upgraders pull directly via findInRange(1), not via logistics.
                // NOT an offer: prevents transporter oscillation (deposit then withdraw).
                const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free > 100) {
                    this.requestInput(c.id as Id<Structure | Resource>, { amount: free, priority: 3 });
                }
            }
        }

        // ── Hatchery Container — central energy buffer near spawn ──
        const spawns = this.colony.room?.find(FIND_MY_SPAWNS) ?? [];
        if (spawns.length > 0) {
            const spawn = spawns[0];
            const hatchContainers = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
            }).filter(c => {
                // Exclude source containers (within 2 of a source)
                const nearSource = c.pos.findInRange(FIND_SOURCES, 2).length > 0;
                // Exclude controller containers (within 3 of controller)
                const nearCtrl = controller && c.pos.getRangeTo(controller) <= 3;
                return !nearSource && !nearCtrl;
            }) as StructureContainer[];

            for (const c of hatchContainers) {
                // Requester only (NOT an offer) — only the Filler draws from it directly.
                // Haulers deliver here; Filler distributes to extensions/spawns.
                if (!this.colony.room?.storage) {
                    const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
                    if (free > 50) {
                        this.requestInput(c.id as Id<Structure | Resource>, { amount: free, priority: 5 });
                    }
                }
            }
        }

        // ── Hatchery Integration (Individual Registration) ──
        // Only register spawns/extensions as requesters when NO filler exists.
        // When a filler is active, it fills extensions directly from the hub —
        // haulers should focus on containers (hatchery + controller), not extensions.
        const hasFillers = this.colony.creeps.some(c => (c.memory as any)?.role === "filler");

        if (!hasFillers) {
            for (const spawn of this.colony.hatchery.spawns) {
                const free = spawn.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free > 0) {
                    this.requestInput(spawn.id as Id<Structure | Resource>, { amount: free, priority: 10 });
                }
            }

            for (const ext of this.colony.hatchery.extensions) {
                const free = ext.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free > 0) {
                    this.requestInput(ext.id as Id<Structure | Resource>, { amount: free, priority: 10 });
                }
            }
        }

        // ── Fix 2: Tower Integration (Critical Defense Sinks) ──
        const towers = this.colony.room?.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER
        }) as StructureTower[] ?? [];

        const isUnderAttack = (this.colony.room?.find(FIND_HOSTILE_CREEPS)?.length ?? 0) > 0;

        for (const t of towers) {
            const free = t.store.getFreeCapacity(RESOURCE_ENERGY);
            if (free > 400) {
                this.requestInput(t.id as Id<Structure | Resource>, { amount: free, priority: isUnderAttack ? 15 : 8 });
            } else if (free > 0) {
                this.requestInput(t.id as Id<Structure | Resource>, { amount: free, priority: 5 });
            }
        }

        // Link Integration (Hub Link)
        if (this.colony.linkNetwork) {
            const hub = this.colony.linkNetwork.hubLink;
            if (hub) {
                if (hub.store.energy > 600) {
                    this.offerIds.push(hub.id as Id<Structure | Resource>);
                }
                if (hub.store.energy < 400) {
                    this.requestInput(hub.id as Id<Structure | Resource>, { amount: 800 - hub.store.energy, priority: 5 });
                }
            }
        }

        // Terminal Integration
        if (this.colony.room?.terminal) {
            const term = this.colony.room.terminal;
            if (term.store.energy < 3000) {
                this.requestInput(term.id as Id<Structure | Resource>, { amount: 3000 - term.store.energy, priority: 3 });
            }
            if (term.store.energy > 10000) {
                this.offerIds.push(term.id as Id<Structure | Resource>);
            }
        }
    }

    /**
     * Rebuild reservation ledger from active Zerg tasks.
     * This prevents infinite growth by reconstructing state each tick.
     */
    private rebuildLedger(): void {
        for (const zerg of this.colony.zergs.values()) {
            if (!zerg.task) continue;

            // Fix #3: Include Pickup tasks in outgoing reservations
            if (zerg.task.name === "Withdraw" || zerg.task.name === "Pickup") {
                const taskWithTarget = zerg.task as WithdrawTask;
                const amount = zerg.store?.getFreeCapacity() ?? 0;
                if (amount > 0) {
                    const current = this.outgoingReservations.get(taskWithTarget.targetId) || 0;
                    this.outgoingReservations.set(taskWithTarget.targetId, current + amount);
                }
            }

            if (zerg.task.name === "Transfer") {
                const transferTask = zerg.task as TransferTask;
                const amount = zerg.store?.getUsedCapacity() ?? 0;
                if (amount > 0) {
                    const current = this.incomingReservations.get(transferTask.targetId) || 0;
                    this.incomingReservations.set(transferTask.targetId, current + amount);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Registration API — accepts IDs only
    // -----------------------------------------------------------------------

    requestInput(targetId: Id<Structure | Resource>, opts: { resourceType?: ResourceConstant, amount?: number, priority?: number } = {}): void {
        const req: LogisticsRequest = {
            targetId,
            amount: opts.amount || 0,
            resourceType: opts.resourceType || RESOURCE_ENERGY,
            priority: opts.priority ?? 1,
        };
        this.requesters.push(req);
    }

    requestOutput(targetId: Id<Structure | Resource>, _opts: { resourceType?: ResourceConstant, amount?: number, priority?: number } = {}): void {
        this.offerIds.push(targetId);
    }

    // -----------------------------------------------------------------------
    // Effective Amount — simplified (no predictive CPU bomb)
    // -----------------------------------------------------------------------

    getEffectiveAmount(targetId: Id<Structure | Resource>): number {
        const target = Game.getObjectById(targetId);
        if (!target) return 0;

        let amount = 0;
        if ('store' in target) {
            amount = (target as any).store[RESOURCE_ENERGY] || 0;
        } else if ('amount' in target) {
            amount = (target as Resource).amount;
        }

        const incoming = this.incomingReservations.get(targetId) || 0;
        const outgoing = this.outgoingReservations.get(targetId) || 0;

        return amount + incoming - outgoing;
    }

    /**
     * Calculate the effective energy in a store, accounting for all reservations.
     * Effective = CurrentStore + IncomingReservations - OutgoingReservations
     * Used by Overlords to make economically-safe spawn decisions.
     */
    getEffectiveStore(targetId: Id<Structure>): number {
        const target = Game.getObjectById(targetId);
        if (!target || !('store' in target)) return 0;

        const current = (target as any).store[RESOURCE_ENERGY] || 0;
        const incoming = this.incomingReservations.get(targetId as any) || 0;
        const outgoing = this.outgoingReservations.get(targetId as any) || 0;

        return current + incoming - outgoing;
    }

    // -----------------------------------------------------------------------
    // Task Matching — Atomic withdraw/transfer assignment
    // -----------------------------------------------------------------------

    // ========================================================================
    // Gale-Shapley Stable Matching — Batch Logistics
    // ========================================================================

    /**  Cached batch results for the current tick */
    private _withdrawMatches: Map<string, string> | null = null;
    private _transferMatches: Map<string, string> | null = null;
    private _matchTick: number = -1;

    /**
     * Run Gale-Shapley for all free haulers needing withdraw targets.
     * Called lazily on first matchWithdraw() of each tick.
     */
    private ensureWithdrawBatch(haulers: Zerg[]): void {
        if (this._matchTick === Game.time && this._withdrawMatches) return;
        this._matchTick = Game.time;

        // Build proposers: each hauler ranks offers by effectiveAmount / distance
        const proposers: MatchProposer[] = [];
        const haulerMap = new Map<string, Zerg>();

        for (const h of haulers) {
            if (!h.pos) continue;
            const isWorker = (h.memory as any)?.role === "worker" || (h.memory as any)?.role === "upgrader";
            const threshold = isWorker ? 10 : 50;

            // Rank offers by score descending
            const scored: { id: string; score: number }[] = [];
            for (const offerId of this.offerIds) {
                const effectiveAmount = this.getEffectiveAmount(offerId);
                if (effectiveAmount <= threshold) continue;

                const target = Game.getObjectById(offerId);
                if (!target) continue;

                // Ping-pong prevention for buffers
                const isBuffer = 'structureType' in target &&
                    ((target as Structure).structureType === STRUCTURE_STORAGE ||
                        (target as Structure).structureType === STRUCTURE_TERMINAL);
                if (isBuffer) {
                    const realDemand = this.requesters.some(r =>
                        r.priority > 0 &&
                        (r.amount - (this.incomingReservations.get(r.targetId) || 0)) > 0
                    );
                    if (!realDemand) continue;
                }

                const distance = h.pos.getRangeTo(target.pos);
                scored.push({ id: offerId as string, score: effectiveAmount / Math.max(1, distance) });
            }

            scored.sort((a, b) => b.score - a.score);
            if (scored.length > 0) {
                proposers.push({ id: h.name, preferences: scored.map(s => s.id) });
                haulerMap.set(h.name, h);
            }
        }

        // Build receivers: each offer can accept multiple haulers based on stored energy
        const receivers: MatchReceiver[] = [];
        for (const offerId of this.offerIds) {
            const target = Game.getObjectById(offerId);
            if (!target) continue;

            const effectiveAmount = this.getEffectiveAmount(offerId);
            if (effectiveAmount <= 0) continue;

            // Capacity: how many haulers can withdraw simultaneously
            // Each hauler takes ~50 energy, so capacity = ceil(amount / 50)
            const cap = Math.max(1, Math.ceil(effectiveAmount / 50));

            receivers.push({
                id: offerId as string,
                capacity: cap,
                score: (proposerId: string) => {
                    const h = haulerMap.get(proposerId);
                    if (!h?.pos || !target.pos) return 0;
                    // Receivers prefer closer haulers (higher score = closer)
                    return 100 - h.pos.getRangeTo(target.pos);
                }
            });
        }

        this._withdrawMatches = stableMatch(proposers, receivers);
        this._transferMatches = null; // Reset transfer for this tick
    }

    /**
     * Run Gale-Shapley for all free haulers needing transfer targets.
     * Called lazily on first matchTransfer() of each tick.
     */
    private ensureTransferBatch(haulers: Zerg[]): void {
        if (this._matchTick === Game.time && this._transferMatches) return;
        this._matchTick = Game.time;

        const proposers: MatchProposer[] = [];
        const haulerMap = new Map<string, Zerg>();

        for (const h of haulers) {
            if (!h.pos) continue;

            const scored: { id: string; score: number }[] = [];
            for (const req of this.requesters) {
                const incoming = this.incomingReservations.get(req.targetId) || 0;
                const deficit = req.amount - incoming;
                if (deficit <= 0) continue;

                const target = Game.getObjectById(req.targetId);
                if (!target) continue;

                const distance = h.pos.getRangeTo(target.pos);
                // Strict priority bands: priority * 1000 - distance
                scored.push({ id: req.targetId as string, score: (req.priority * 1000) - distance });
            }

            scored.sort((a, b) => b.score - a.score);
            if (scored.length > 0) {
                proposers.push({ id: h.name, preferences: scored.map(s => s.id) });
                haulerMap.set(h.name, h);
            }
        }

        const receivers: MatchReceiver[] = [];
        for (const req of this.requesters) {
            const incoming = this.incomingReservations.get(req.targetId) || 0;
            const deficit = req.amount - incoming;
            if (deficit <= 0) continue;

            const target = Game.getObjectById(req.targetId);
            if (!target) continue;

            // Capacity: how many haulers needed to fill the deficit
            const cap = Math.max(1, Math.ceil(deficit / 50));

            receivers.push({
                id: req.targetId as string,
                capacity: cap,
                score: (proposerId: string) => {
                    const h = haulerMap.get(proposerId);
                    if (!h?.pos || !target.pos) return 0;
                    const distScore = 100 - h.pos.getRangeTo(target.pos);
                    // Fix #4: Weight by payload so a full hauler beats a closer empty one.
                    // Each energy unit adds 1 point — a full 50-carry hauler at range 2
                    // scores 148 vs an empty hauler at range 1 scoring 99.
                    const energyCarried = h.store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
                    return distScore + energyCarried;
                }
            });
        }

        this._transferMatches = stableMatch(proposers, receivers);
        this._withdrawMatches = null; // Reset withdraw for this tick
    }

    /**
     * Find the best withdraw target for an empty hauler.
     * Uses Gale-Shapley stable matching for global optimality.
     */
    matchWithdraw(zerg: Zerg, allFreeHaulers?: Zerg[]): Id<Structure | Resource> | null {
        if (!zerg.pos) return null;

        // Run batch matching if not yet computed this tick
        if (allFreeHaulers && allFreeHaulers.length > 0) {
            this.ensureWithdrawBatch(allFreeHaulers);
        }

        // Look up this hauler's assignment
        const matchedId = this._withdrawMatches?.get(zerg.name);
        if (matchedId) {
            const bestId = matchedId as Id<Structure | Resource>;
            // Reserve: add zerg's free capacity to outgoing
            const freeCapacity = zerg.store?.getFreeCapacity() ?? 0;
            const current = this.outgoingReservations.get(bestId) || 0;
            this.outgoingReservations.set(bestId, current + freeCapacity);
            return bestId;
        }

        return null;
    }

    /**
     * Find the best transfer target for a loaded hauler.
     * Uses Gale-Shapley stable matching for global optimality.
     */
    matchTransfer(zerg: Zerg, allFreeHaulers?: Zerg[]): Id<Structure | Resource> | null {
        if (!zerg.pos) return null;

        // Run batch matching if not yet computed this tick
        if (allFreeHaulers && allFreeHaulers.length > 0) {
            this.ensureTransferBatch(allFreeHaulers);
        }

        // Look up this hauler's assignment
        const matchedId = this._transferMatches?.get(zerg.name);
        if (matchedId) {
            const bestId = matchedId as Id<Structure | Resource>;
            // Reserve: add zerg's used capacity to incoming
            const usedCapacity = zerg.store?.getUsedCapacity() ?? 0;
            const current = this.incomingReservations.get(bestId) || 0;
            this.incomingReservations.set(bestId, current + usedCapacity);
            return bestId;
        }

        return null;
    }
}
