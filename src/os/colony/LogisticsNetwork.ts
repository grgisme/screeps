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
        // Buffer Logic (State Aware)
        if (this.colony.room?.storage) {
            const storage = this.colony.room.storage;
            const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);

            // Surplus Mode: Storage acts as Provider
            if (energy > 100000) {
                this.offerIds.push(storage.id as Id<Structure | Resource>);
            }

            // Deficit Mode: Storage acts as Requester
            if (energy < 100000) {
                this.requestInput(storage.id as Id<Structure | Resource>, { amount: 100000 - energy, priority: 1 });
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

            if (zerg.task.name === "Withdraw") {
                const withdrawTask = zerg.task as WithdrawTask;
                const amount = zerg.store?.getFreeCapacity() ?? 0;
                if (amount > 0) {
                    const current = this.outgoingReservations.get(withdrawTask.targetId) || 0;
                    this.outgoingReservations.set(withdrawTask.targetId, current + amount);
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
            priority: opts.priority || 1,
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

    // -----------------------------------------------------------------------
    // Task Matching — Atomic withdraw/transfer assignment
    // -----------------------------------------------------------------------

    /**
     * Find the best withdraw target for an empty hauler.
     * Score = effectiveAmount / max(1, distance)
     */
    matchWithdraw(zerg: Zerg): Id<Structure | Resource> | null {
        if (!zerg.pos) return null;

        let bestId: Id<Structure | Resource> | null = null;
        let bestScore = -Infinity;

        for (const offerId of this.offerIds) {
            const effectiveAmount = this.getEffectiveAmount(offerId);
            if (effectiveAmount <= 50) continue; // Minimum threshold to bother

            const target = Game.getObjectById(offerId);
            if (!target) continue;

            const distance = zerg.pos.getRangeTo(target.pos);
            const score = effectiveAmount / Math.max(1, distance);

            if (score > bestScore) {
                bestScore = score;
                bestId = offerId;
            }
        }

        if (bestId) {
            // Reserve: add zerg's free capacity to outgoing
            const freeCapacity = zerg.store?.getFreeCapacity() ?? 0;
            const current = this.outgoingReservations.get(bestId) || 0;
            this.outgoingReservations.set(bestId, current + freeCapacity);
        }

        return bestId;
    }

    /**
     * Find the best transfer target for a loaded hauler.
     * Score = priority / max(1, distance)
     */
    matchTransfer(zerg: Zerg): Id<Structure | Resource> | null {
        if (!zerg.pos) return null;

        let bestId: Id<Structure | Resource> | null = null;
        let bestScore = -Infinity;

        for (const req of this.requesters) {
            const incoming = this.incomingReservations.get(req.targetId) || 0;
            const deficit = req.amount - incoming;
            if (deficit <= 0) continue;

            const target = Game.getObjectById(req.targetId);
            if (!target) continue;

            const distance = zerg.pos.getRangeTo(target.pos);
            const score = req.priority / Math.max(1, distance);

            if (score > bestScore) {
                bestScore = score;
                bestId = req.targetId;
            }
        }

        if (bestId) {
            // Reserve: add zerg's used capacity to incoming
            const usedCapacity = zerg.store?.getUsedCapacity() ?? 0;
            const current = this.incomingReservations.get(bestId) || 0;
            this.incomingReservations.set(bestId, current + usedCapacity);
        }

        return bestId;
    }
}
