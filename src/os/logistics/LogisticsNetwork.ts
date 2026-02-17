
import type { Colony } from "../Colony";
import type { Zerg } from "../infrastructure/Zerg";

export interface TransportRequest {
    target: Structure | Resource;
    amount: number;
    resourceType: ResourceConstant;
    priority: number;
}

export interface LogisticsRequest extends TransportRequest {
    id: string;
}

export interface MatchedRequest extends TransportRequest {
    provider: Structure | Resource;
}

export interface LogisticsNetworkState {
    responseCodes: { [role: string]: number };
}

export class LogisticsNetwork {

    providers: (Structure | Resource)[];
    requesters: LogisticsRequest[];
    buffers: Structure[];
    incomingReservations: Map<string, number>;
    outgoingReservations: Map<string, number>;
    colony: Colony;
    unassignedRequests: MatchedRequest[] = [];

    constructor(colony: Colony) {
        this.colony = colony;
        this.providers = [];
        this.requesters = [];
        this.buffers = [];
        this.incomingReservations = new Map();
        this.outgoingReservations = new Map();
    }

    refresh(): void {
        this.providers = [];
        this.requesters = [];
        this.buffers = [];
    }

    init(): void {
        console.log(`LogisticsNetwork Online: [${this.providers.length}] Providers, [${this.requesters.length}] Requesters registered.`);
    }

    requestInput(target: Structure, opts: { resourceType?: ResourceConstant, amount?: number, priority?: number } = {}): void {
        const req: LogisticsRequest = {
            target: target,
            amount: opts.amount || 0,
            resourceType: opts.resourceType || RESOURCE_ENERGY,
            priority: opts.priority || 1,
            id: target.id
        };
        this.requesters.push(req);
    }

    requestOutput(target: Structure | Resource, _opts: { resourceType?: ResourceConstant, amount?: number, priority?: number } = {}): void {
        this.providers.push(target);
    }

    provideBuffer(target: Structure): void {
        this.buffers.push(target);
    }

    getEffectiveAmount(target: Structure | Resource, resourceType: ResourceConstant): number {
        let amount = 0;
        if ('store' in target) {
            amount = (target as any).store[resourceType] || 0;
        } else if ('amount' in target) {
            amount = (target as Resource).amount;
        }

        const incoming = this.incomingReservations.get(target.id) || 0;
        const outgoing = this.outgoingReservations.get(target.id) || 0;

        return amount + incoming - outgoing;
    }

    registerAllocation(source: Structure | Resource, target: Structure, amount: number): void {
        const currentOutgoing = this.outgoingReservations.get(source.id) || 0;
        this.outgoingReservations.set(source.id, currentOutgoing + amount);

        const currentIncoming = this.incomingReservations.get(target.id) || 0;
        this.incomingReservations.set(target.id, currentIncoming + amount);
    }

    match(): void {
        this.unassignedRequests = [];
        let reservedEnergy = 0;

        // Buffer Logic
        if (this.colony.room.storage) {
            const storage = this.colony.room.storage;
            if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.providers.push(storage);
            }
        }

        // Sort requesters by priority (descending)
        this.requesters.sort((a, b) => b.priority - a.priority);

        for (const req of this.requesters) {
            // Find closest provider with energy
            let bestProvider: Structure | Resource | undefined;
            let bestRange = Infinity;

            // Simple "effective amount" check for request
            // If request already has enough incoming, skip?
            // For now, let's assume requestInput is authoritative for "I need this".

            for (const provider of this.providers) {
                // Check if provider has enough energy (effective)
                const effectiveAmount = this.getEffectiveAmount(provider, req.resourceType);
                if (effectiveAmount < 50) continue; // Minimum threshold to bother

                const range = req.target.pos.getRangeTo(provider.pos);
                if (range < bestRange) {
                    bestRange = range;
                    bestProvider = provider;
                }
            }

            if (bestProvider) {
                // Match found!
                // How much to take? Min of (requested, provider effective)
                const providerAmount = this.getEffectiveAmount(bestProvider, req.resourceType);
                const amount = Math.min(req.amount, providerAmount);

                if (amount > 0) {
                    this.registerAllocation(bestProvider, req.target as Structure, amount);
                    this.unassignedRequests.push({
                        target: req.target,
                        amount: amount,
                        resourceType: req.resourceType,
                        priority: req.priority,
                        provider: bestProvider
                    });
                    reservedEnergy += amount;
                }
            }
        }

        console.log(`Matched [${this.unassignedRequests.length}] requests, [${reservedEnergy}] energy reserved.`);
    }

    requestTask(zerg: Zerg): MatchedRequest | null {
        // Finds the best task for the zerg (closest)
        let bestRequest: MatchedRequest | null = null;
        let minCost = Infinity;
        let bestIndex = -1;

        for (let i = 0; i < this.unassignedRequests.length; i++) {
            const req = this.unassignedRequests[i];
            // Simple cost function: Range to provider
            const cost = zerg.pos.getRangeTo(req.provider.pos);

            // Priority multiplier? (Lower cost is better)
            // Higher priority should reduce cost? Or just take highest priority first?
            // The list is already sorted by priority. So we should pick the first one that is "reasonably" close.
            // Or just pick the absolute closest one to save CPU/travel.
            // Let's pick closest for now.
            if (cost < minCost) {
                minCost = cost;
                bestRequest = req;
                bestIndex = i;
            }
        }

        if (bestRequest && bestIndex !== -1) {
            this.unassignedRequests.splice(bestIndex, 1); // Remove from pool
            return bestRequest;
        }

        return null;
    }
}
