
export interface TransportRequest {
    target: Structure | Resource;
    amount: number;
    resourceType: ResourceConstant;
    priority: number;
}

export interface LogisticsNetworkState {
    responseCodes: { [role: string]: number };
}

export class LogisticsNetwork {

    providers: (Structure | Resource)[];
    requesters: Structure[];
    buffers: Structure[];
    incomingReservations: Map<string, number>;
    outgoingReservations: Map<string, number>;

    constructor() {
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

    requestInput(target: Structure, _opts: { resourceType?: ResourceConstant, amount?: number, priority?: number } = {}): void {
        this.requesters.push(target);
    }

    requestOutput(target: Structure | Resource, _opts: { resourceType?: ResourceConstant, amount?: number, priority?: number } = {}): void {
        this.providers.push(target);
    }

    provideBuffer(target: Structure): void {
        this.buffers.push(target);
    }
}
