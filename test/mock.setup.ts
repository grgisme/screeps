// ============================================================================
// Screeps Mock — Provides simulated Game/Memory globals for unit tests
// ============================================================================

/**
 * This module sets up minimal Screeps globals so that Kernel, Process,
 * and other OS classes can be tested outside the Screeps runtime.
 *
 * Import this at the top of every test file:
 *   import "./mock.setup";
 */

// ---------------------------------------------------------------------------
// Screeps Constants
// ---------------------------------------------------------------------------

// Screeps Constants
// ---------------------------------------------------------------------------

(globalThis as any).OK = 0;
(globalThis as any).ERR_NOT_IN_RANGE = -9;
(globalThis as any).ERR_NOT_FOUND = -5;
(globalThis as any).ERR_NO_PATH = -2;
(globalThis as any).ERR_INVALID_TARGET = -7;
(globalThis as any).ERR_BUSY = -4;
(globalThis as any).ERR_NOT_ENOUGH_ENERGY = -6;
(globalThis as any).ERR_NAME_EXISTS = -3;
(globalThis as any).ERR_NOT_OWNER = -1;
(globalThis as any).ERR_NO_BODYPART = -12;
(globalThis as any).ERR_TIRED = -11;
(globalThis as any).ERR_NOT_ENOUGH_RESOURCES = -6;

(globalThis as any).FIND_SOURCES = 105;
(globalThis as any).FIND_MY_SPAWNS = 111;
(globalThis as any).FIND_SOURCES_ACTIVE = 104;
(globalThis as any).FIND_FLAGS = 110;
(globalThis as any).FIND_HOSTILE_CREEPS = 106;
(globalThis as any).FIND_DROPPED_RESOURCES = 109;
(globalThis as any).FIND_TOMBSTONES = 119;

// Mocks for PathFinder
(globalThis as any).PathFinder = {
    search: (origin: RoomPosition, _goal: any, _opts: any) => {
        return {
            path: [
                new RoomPosition(origin.x + 1, origin.y, origin.roomName),
                new RoomPosition(origin.x + 2, origin.y, origin.roomName),
                new RoomPosition(origin.x + 3, origin.y, origin.roomName)
            ],
            ops: 1,
            cost: 1,
            incomplete: false
        };
    },
    CostMatrix: class {
        _bits: Uint8Array = new Uint8Array(2500);
        set(x: number, y: number, val: number) { this._bits[x * 50 + y] = val; }
        get(x: number, y: number) { return this._bits[x * 50 + y]; }
        clone() { return new (globalThis as any).PathFinder.CostMatrix(); }
        serialize() { return []; }
        deserialize(_val: any) { }
    }
};

(globalThis as any).RoomVisual = class MockRoomVisual {
    constructor(public roomName: string) { }
    text(_text: string, _x: number, _y: number, _opts?: any) { }
    line(_x1: number, _y1: number, _x2: number, _y2: number, _opts?: any) { }
    circle(_x: number, _y: number, _opts?: any) { }
    rect(_x: number, _y: number, _w: number, _h: number, _opts?: any) { }
    poly(_points: any[], _opts?: any) { }
};

// Direction Constants
(globalThis as any).TOP = 1;
(globalThis as any).TOP_RIGHT = 2;
(globalThis as any).RIGHT = 3;
(globalThis as any).BOTTOM_RIGHT = 4;
(globalThis as any).BOTTOM = 5;
(globalThis as any).BOTTOM_LEFT = 6;
(globalThis as any).LEFT = 7;
(globalThis as any).TOP_LEFT = 8;

// Look Constants
(globalThis as any).LOOK_CREEPS = "creep";
(globalThis as any).LOOK_SOURCES = "source";
(globalThis as any).LOOK_STRUCTURES = "structure";
(globalThis as any).LOOK_CONSTRUCTION_SITES = "constructionSite";
(globalThis as any).STRUCTURE_WALL = "constructedWall";
(globalThis as any).FIND_SOURCES_ACTIVE = 104;
(globalThis as any).FIND_MY_STRUCTURES = 108;
(globalThis as any).FIND_STRUCTURES = 107;
(globalThis as any).FIND_MY_SPAWNS = 112;
(globalThis as any).FIND_MY_CREEPS = 102;
(globalThis as any).FIND_MY_CONSTRUCTION_SITES = 113;

(globalThis as any).STRUCTURE_SPAWN = "spawn";
(globalThis as any).STRUCTURE_EXTENSION = "extension";
(globalThis as any).STRUCTURE_CONTAINER = "container";
(globalThis as any).STRUCTURE_STORAGE = "storage";
(globalThis as any).STRUCTURE_TOWER = "tower";
(globalThis as any).STRUCTURE_LYB = "lab"; // Typo safeguard? LAB
(globalThis as any).STRUCTURE_LAB = "lab";
(globalThis as any).STRUCTURE_TERMINAL = "terminal";
(globalThis as any).STRUCTURE_LINK = "link";
(globalThis as any).STRUCTURE_ROAD = "road";
(globalThis as any).STRUCTURE_RAMPART = "rampart";
(globalThis as any).STRUCTURE_WALL = "constructedWall";
(globalThis as any).STRUCTURE_KEEPER_LAIR = "keeperLair";
(globalThis as any).STRUCTURE_CONTROLLER = "controller";
(globalThis as any).STRUCTURE_POWER_BANK = "powerBank";
(globalThis as any).STRUCTURE_PORTAL = "portal";
(globalThis as any).STRUCTURE_INVADER_CORE = "invaderCore";
(globalThis as any).STRUCTURE_OBSERVER = "observer";
(globalThis as any).STRUCTURE_NUKER = "nuker";
(globalThis as any).STRUCTURE_POWER_SPAWN = "powerSpawn";
(globalThis as any).STRUCTURE_FACTORY = "factory";
(globalThis as any).STRUCTURE_EXTRACTOR = "extractor";

// Mock Controller Structures Map
(globalThis as any).CONTROLLER_STRUCTURES = {
    "spawn": { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3 },
    "extension": { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 },
    "link": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 3, 7: 4, 8: 6 },
    "road": { 0: 2500, 1: 2500, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
    "constructedWall": { 0: 0, 1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
    "rampart": { 0: 0, 1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
    "storage": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 },
    "tower": { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6 },
    "observer": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
    "powerSpawn": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
    "extractor": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
    "lab": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 3, 7: 6, 8: 10 },
    "terminal": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
    "container": { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
    "nuker": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
    "factory": { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1 }
};

(globalThis as any).RESOURCE_ENERGY = "energy";

(globalThis as any).WORK = "work";
(globalThis as any).CARRY = "carry";
(globalThis as any).MOVE = "move";
(globalThis as any).ATTACK = "attack";
(globalThis as any).RANGED_ATTACK = "ranged_attack";
(globalThis as any).HEAL = "heal";
(globalThis as any).TOUGH = "tough";
(globalThis as any).CLAIM = "claim";
(globalThis as any).ORDER_SELL = "sell";
(globalThis as any).ORDER_BUY = "buy";
(globalThis as any).TERRAIN_MASK_WALL = 1;
(globalThis as any).TERRAIN_MASK_SWAMP = 2;

(globalThis as any).BODYPART_COST = {
    work: 100,
    carry: 50,
    move: 50,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    tough: 10,
    claim: 600,
};

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

(globalThis as any).Memory = {
    creeps: {},
    rooms: {},
    kernel: {
        processTable: [],
        nextPID: 1,
    },
};

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

(globalThis as any).Game = {
    time: 1,
    cpu: {
        limit: 20,
        tickLimit: 500,
        bucket: 10000,
        getUsed: () => 0,
    },
    creeps: {} as Record<string, any>,
    flags: {} as Record<string, any>,
    rooms: {} as Record<string, any>,
    map: {
        getRoomTerrain: (_roomName: string) => {
            return {
                get: (_x: number, _y: number) => 0 // Default to plain
            };
        }
    },
    getObjectById: (_id: string) => null,
    market: {
        calcTransactionCost: (_amount: number, _roomName1: string, _roomName2: string) => 0,
        getAllOrders: (_filter?: any) => [],
        deal: (_orderId: string, _amount: number, _targetRoomName?: string) => OK,
    }
};

// ---------------------------------------------------------------------------
// RoomPosition (minimal)
// ---------------------------------------------------------------------------

export class MockRoomPosition {
    x: number;
    y: number;
    roomName: string;

    constructor(x: number, y: number, roomName: string) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
    }

    isEqualTo(target: MockRoomPosition): boolean {
        return (
            this.x === target.x &&
            this.y === target.y &&
            this.roomName === target.roomName
        );
    }

    isNearTo(target: RoomPosition | { pos: RoomPosition }): boolean {
        return this.inRangeTo(target, 1);
    }

    createConstructionSite(_structureType: StructureConstant): number {
        return 0; // OK
    }

    findPathTo(
        _target: MockRoomPosition,
        _opts?: any
    ): Array<{ x: number; y: number; dx: number; dy: number; direction: number }> {
        return [{ x: _target.x, y: _target.y, dx: 1, dy: 0, direction: 3 }];
    }

    inRangeTo(target: RoomPosition | { pos: RoomPosition }, range: number): boolean {
        const pos = "pos" in target ? target.pos : target;
        const dx = Math.abs(this.x - pos.x);
        const dy = Math.abs(this.y - pos.y);
        return dx <= range && dy <= range;
    }

    getRangeTo(target: RoomPosition | { pos: RoomPosition }): number {
        const pos = "pos" in target ? target.pos : target;
        const dx = Math.abs(this.x - pos.x);
        const dy = Math.abs(this.y - pos.y);
        return Math.max(dx, dy);
    }

    findInRange<T>(_type: number, _range: number, _opts?: any): T[] {
        return [] as T[];
    }

    findClosestByRange<T>(objects: T[] | number): T | null {
        if (Array.isArray(objects)) {
            return objects[0] || null; // Simple mock: return first
        }
        return null; // Mock for finding by constant
    }

    findClosestByPath<T>(objects: T[] | number): T | null {
        if (Array.isArray(objects)) {
            return objects[0] || null;
        }
        return null;
    }

    getDirectionTo(target: RoomPosition | { pos: RoomPosition }): DirectionConstant {
        const pos = "pos" in target ? target.pos : target;
        if (this.x === pos.x && this.y === pos.y) return 1 as DirectionConstant; // Same pos

        const dx = pos.x - this.x;
        const dy = pos.y - this.y;

        if (dx > 0) return 3; // Right
        if (dx < 0) return 7; // Left
        if (dy > 0) return 5; // Down
        if (dy < 0) return 1; // Up
        return 1;
    }

    lookFor<T>(_type: string): T[] {
        return [] as T[];
    }
}

(globalThis as any).RoomPosition = MockRoomPosition;

// ---------------------------------------------------------------------------
// Room (very minimal)
// ---------------------------------------------------------------------------

export class MockRoom {
    name: string;
    controller?: {
        my: boolean;
        owner?: { username: string };
        reservation?: { username: string };
    };
    storage?: { pos: MockRoomPosition; store: any };

    constructor(name: string) {
        this.name = name;
    }

    find(_type: number): any[] {
        return [];
    }

    lookForAt(_type: string, _x: number, _y: number): any[] {
        return [];
    }
}

(globalThis as any).Room = MockRoom;

// ---------------------------------------------------------------------------
// Creep (minimal)
// ---------------------------------------------------------------------------

export class MockCreep {
    name: string;
    room: MockRoom;
    pos: MockRoomPosition;
    store: any;
    memory: any;
    body: any[];
    hits: number;
    hitsMax: number;
    id: string;

    constructor(name: string, roomName: string) {
        this.name = name;
        this.id = name; // Use name as ID for mock
        this.room = new MockRoom(roomName);
        this.pos = new MockRoomPosition(25, 25, roomName);
        this.store = {
            getUsedCapacity: () => 0,
            getFreeCapacity: () => 50,
            energy: 0
        };
        this.memory = {};
        this.body = [];
        this.hits = 100;
        this.hitsMax = 100;
    }

    say(_msg: string): void { }
    move(_direction: number): number { return 0; }
    transfer(_target: any, _resource: string): number { return 0; }
    withdraw(_target: any, _resource: string): number { return 0; }
    harvest(_target: any): number { return 0; }
    pickup(_target: any): number { return 0; }
    repair(_target: any): number { return 0; }
    build(_target: any): number { return 0; }
    attack(_target: any): number { return 0; }
    rangedAttack(_target: any): number { return 0; }
    heal(_target: any): number { return 0; }

    getActiveBodyparts(type: BodyPartConstant): number {
        return this.body.filter((p: any) => p.type === type && p.hits > 0).length;
    }
}

(globalThis as any).Creep = MockCreep;

// ---------------------------------------------------------------------------
// Colony (minimal)
// ---------------------------------------------------------------------------

export class MockColony {
    name: string;
    room: MockRoom;
    hatchery: { enqueue: (req: any) => void };
    logistics: {
        offerIds: any[];
        requesters: any[];
        incomingReservations: Map<string, number>;
        outgoingReservations: Map<string, number>;
        matchWithdraw: (zerg: any) => null;
        matchTransfer: (zerg: any) => null;
        requestInput: (targetId: any, opts?: any) => void;
        requestOutput: (targetId: any, opts?: any) => void;
    };

    constructor(name: string) {
        this.name = name;
        this.room = new MockRoom(name);
        this.hatchery = { enqueue: () => { } };
        this.logistics = {
            offerIds: [],
            requesters: [],
            incomingReservations: new Map(),
            outgoingReservations: new Map(),
            matchWithdraw: () => null,
            matchTransfer: () => null,
            requestInput: () => { },
            requestOutput: () => { }
        };
    }
}

// ---------------------------------------------------------------------------
// _heap global init
// ---------------------------------------------------------------------------

(globalThis as any)._heap = {
    _initialized: false,
    _kernelInstance: undefined,
    _cache: new Map<string, unknown>(),
    _pathCache: new Map<string, { path: string; tick: number }>(),
};

// ---------------------------------------------------------------------------
// Helper: reset all mocks between tests
// ---------------------------------------------------------------------------

export function resetMocks(): void {
    // console.log("resetMocks called");
    (globalThis as any).Memory = {
        creeps: {},
        rooms: {},
        kernel: {
            processTable: [],
            nextPID: 1,
        },
    };
    (globalThis as any).Game = {
        time: 1,
        cpu: {
            limit: 20,
            tickLimit: 500,
            bucket: 10000,
            getUsed: () => 0,
        },
        creeps: {},
        flags: {},
        rooms: {},
        map: {
            getRoomTerrain: (_roomName: string) => {
                return {
                    get: (_x: number, _y: number) => 0 // Default to plain
                };
            }
        },
        getObjectById: (_id: string) => null,
        market: {
            calcTransactionCost: (_amount: number, _roomName1: string, _roomName2: string) => 0,
            getAllOrders: (_filter?: any) => [],
            deal: (_orderId: string, _amount: number, _targetRoomName?: string) => OK,
        }
    };
    (globalThis as any)._heap = {
        _initialized: false,
        _kernelInstance: undefined,
        _cache: new Map<string, unknown>(),
        _pathCache: new Map<string, { path: string; tick: number }>(),
    };

    // Restore PathFinder
    (globalThis as any).PathFinder = {
        search: (origin: RoomPosition, _goal: any, _opts: any) => {
            return {
                path: [
                    new RoomPosition(origin.x + 1, origin.y, origin.roomName),
                    new RoomPosition(origin.x + 2, origin.y, origin.roomName),
                    new RoomPosition(origin.x + 3, origin.y, origin.roomName)
                ],
                ops: 1,
                cost: 1,
                incomplete: false
            };
        },
        CostMatrix: class {
            _bits: Uint8Array = new Uint8Array(2500);
            set(x: number, y: number, val: number) { this._bits[x * 50 + y] = val; }
            get(x: number, y: number) { return this._bits[x * 50 + y]; }
            clone() { return new (globalThis as any).PathFinder.CostMatrix(); }
            serialize() { return []; }
            deserialize(_val: any) { }
        }
    };
}
