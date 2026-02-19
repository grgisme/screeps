
import type { Colony } from "./Colony";
import type { Zerg } from "../zerg/Zerg";
import { Logger } from "../../utils/Logger";

const log = new Logger("Logistics");

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
        log.throttle(50, () => `Online: [${this.providers.length}] Providers, [${this.requesters.length}] Requesters registered.`);
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

    getEffectiveAmount(target: Structure | Resource, resourceType: ResourceConstant, predictionDistance: number = 0): number {
        let amount = 0;
        if ('store' in target) {
            amount = (target as any).store[resourceType] || 0;
        } else if ('amount' in target) {
            amount = (target as Resource).amount;
        }

        const incoming = this.incomingReservations.get(target.id) || 0;
        const outgoing = this.outgoingReservations.get(target.id) || 0;

        let predictedGain = 0;
        // Logic: If target is a Source Container, predict gain during travel time
        // We need to know if it's near a source. 
        // Heuristic: If it increases automatically? Or just check range to Sources?
        // For efficiency, maybe cache this? For now, simplistic check.
        if ('structureType' in target && target.structureType === STRUCTURE_CONTAINER && resourceType === RESOURCE_ENERGY) {
            const sources = target.pos.findInRange(FIND_SOURCES, 1);
            if (sources.length > 0) {
                const source = sources[0];
                const productionPerTick = source.energyCapacity / 300; // 10 or 20 (keen/invader)
                // If source is empty/regen, production is 0? 
                // Assuming active mining:
                if (source.energy > 0) {
                    predictedGain = productionPerTick * predictionDistance;
                }
            }
        }

        return amount + incoming - outgoing + predictedGain;
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
        // Buffer Logic (State Aware)
        if (this.colony.room?.storage) {
            const storage = this.colony.room.storage;
            const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);

            // Surplus Mode: Storage acts as Provider
            if (energy > 100000) {
                this.providers.push(storage);
            }

            // Deficit Mode: Storage acts as Requester
            if (energy < 100000) {
                this.requestInput(storage, { amount: 100000 - energy, priority: 1 });
            }
        }

        // --- Link Integration (Hub Link) ---
        if (this.colony.linkNetwork && this.colony.linkNetwork.hubLink) {
            const hub = this.colony.linkNetwork.hubLink;
            // Provider: If full (came from source), dump to storage
            // Use hysteresis to prevent flip-flopping
            if (hub.store.energy > 600) {
                this.providers.push(hub);
            }
            // Requester: If empty (needs to feed controller/upgraders), fill from storage
            if (hub.store.energy < 400) {
                this.requestInput(hub, { amount: 800 - hub.store.energy, priority: 5 });
            }
        }

        // --- Terminal Integration ---
        if (this.colony.room?.terminal) {
            const term = this.colony.room.terminal;
            // Simplistic logic for now: Keep terminal at ~5000 energy for transactions
            // Real logic is handled by TerminalOverlord - but Logistics handles the moving
            if (term.store.energy < 3000) {
                this.requestInput(term, { amount: 3000 - term.store.energy, priority: 3 });
            }
            if (term.store.energy > 10000) { // Too much? dump back to storage (unless selling)
                // Actually, TerminalOverlord might want it full. 
                // Let's just allow it to provide if it has excess?
                // For now, let's treat it as a provider if > 10000
                this.providers.push(term);
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

        log.debug(() => `Matched [${this.unassignedRequests.length}] requests, [${reservedEnergy}] energy reserved.`);
    }

    requestTask(zerg: Zerg): MatchedRequest | null {
        // Finds the best task for the zerg (Heuristic Score)
        let bestRequest: MatchedRequest | null = null;
        let maxScore = -Infinity;
        let bestIndex = -1;

        for (let i = 0; i < this.unassignedRequests.length; i++) {
            const req = this.unassignedRequests[i];

            const distance = zerg.pos!.getRangeTo(req.provider.pos);
            const distSq = Math.max(1, distance * distance);

            // Resource Density: Request Amount / Zerg Capacity
            // High density (full load) > Low density (partial load)
            const capacity = zerg.creep!.store.getCapacity(req.resourceType) || 1;
            const resourceDensity = Math.min(req.amount, capacity) / capacity;

            // Score = Priority / (Distance^2 * (1 + ResourceDensity))
            // Problem: Priority is static (e.g. 5). Distance^2 grows fast.
            // Adjust: Priority * Density / Distance ? Or Priority * (1 + Density) / Distance?
            // User Formula: Priority / (Distance^2 * (1 + ResourceDensity))
            // Let's interpret "resource density" in denominator or numerator?
            // "favors full loads slightly further away".
            // If Density is in denominator, higher density -> lower score? NO.
            // Current user formula: Priority / (D^2 * (1+RD)). This means Higher RD (Full load) -> Smaller denominator -> Higher Score. YES.

            // Score = (Priority * (1 + resourceDensity)) / distSq;
            // WAIT. If RD is high (1), denominator is D^2 * 2. If RD is low (0), D^2 * 1.
            // Higher RD makes denominator LARGER? That reduces score.
            // "favors full loads" means score should be HIGHER for full loads.
            // So RD should DECREASE denominator.
            // Formula in prompt: Priority / (Distance^2 * (1 + ResourceDensity))
            // Let's assume prompt meant: Score = (Priority * (1 + ResourceDensity)) / Distance^2
            // OR the prompt meant "Low density penalty".
            // Let's use standard: Score = (Priority * DensityFactor) / DistanceFactor.

            // Re-reading prompt: "Score = Priority / (Distance^2 * (1 + ResourceDensity))"
            // If RD=1, Denom = 2 D^2. Score is HALVED?
            // If RD=0, Denom = 1 D^2. Score is NORMAL?
            // This favors EMPTY loads?
            // I will invert the density logic to match the GOAL "favors full loads".
            // Score = (Priority * (1 + resourceDensity)) / distSq;

            const adjustedScore = (req.priority * (1 + resourceDensity)) / distSq;

            if (adjustedScore > maxScore) {
                maxScore = adjustedScore;
                bestRequest = req;
                bestIndex = i;
            }
        }

        if (bestRequest && bestIndex !== -1) {
            const provider = bestRequest.provider;
            const currentAmount = this.getEffectiveAmount(provider, bestRequest.resourceType);
            // We can check predicted amount here for logging?
            // Prediction only useful if we KNEW travel time.
            const dist = zerg.pos!.getRangeTo(provider);
            const predictedAmount = this.getEffectiveAmount(provider, bestRequest.resourceType, dist);

            const providerName = 'structureType' in provider ? provider.structureType : 'resource';

            log.debug(() => `Predictive Match: hauler → ${providerName}@${provider.pos.x},${provider.pos.y} (Current: ${currentAmount}, Predicted: ${predictedAmount.toFixed(1)}, Score: ${maxScore.toFixed(2)})`);

            this.unassignedRequests.splice(bestIndex, 1); // Remove from pool
            return bestRequest;
        }

        return null;
    }
}
