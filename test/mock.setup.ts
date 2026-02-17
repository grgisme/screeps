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

(globalThis as any).OK = 0;
(globalThis as any).ERR_NOT_IN_RANGE = -9;
(globalThis as any).ERR_NOT_FOUND = -5;
(globalThis as any).ERR_NO_PATH = -2;
(globalThis as any).ERR_INVALID_TARGET = -7;
(globalThis as any).ERR_BUSY = -4;
(globalThis as any).ERR_NOT_ENOUGH_ENERGY = -6;

(globalThis as any).FIND_SOURCES = 105;
(globalThis as any).FIND_SOURCES_ACTIVE = 104;
(globalThis as any).FIND_MY_STRUCTURES = 108;
(globalThis as any).FIND_STRUCTURES = 107;
(globalThis as any).FIND_MY_SPAWNS = 112;

(globalThis as any).STRUCTURE_SPAWN = "spawn";
(globalThis as any).STRUCTURE_EXTENSION = "extension";
(globalThis as any).STRUCTURE_CONTAINER = "container";
(globalThis as any).STRUCTURE_STORAGE = "storage";

(globalThis as any).RESOURCE_ENERGY = "energy";

(globalThis as any).WORK = "work";
(globalThis as any).CARRY = "carry";
(globalThis as any).MOVE = "move";

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
    rooms: {} as Record<string, any>,
    getObjectById: (_id: string) => null,
};

// ---------------------------------------------------------------------------
// RoomPosition (minimal)
// ---------------------------------------------------------------------------

class MockRoomPosition {
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

    findPathTo(
        _target: MockRoomPosition,
        _opts?: any
    ): Array<{ x: number; y: number; dx: number; dy: number; direction: number }> {
        return [{ x: _target.x, y: _target.y, dx: 1, dy: 0, direction: 3 }];
    }
}

(globalThis as any).RoomPosition = MockRoomPosition;

// ---------------------------------------------------------------------------
// Room (minimal)
// ---------------------------------------------------------------------------

class MockRoom {
    static serializePath(
        path: Array<{ x: number; y: number; dx: number; dy: number; direction: number }>
    ): string {
        let result = "";
        for (const step of path) {
            result += `${step.x}${step.y}${step.direction}`;
        }
        return result;
    }

    static deserializePath(
        serialized: string
    ): Array<{ x: number; y: number; dx: number; dy: number; direction: number }> {
        const path: Array<{ x: number; y: number; dx: number; dy: number; direction: number }> = [];
        for (let i = 0; i < serialized.length; i += 3) {
            path.push({
                x: parseInt(serialized[i], 10),
                y: parseInt(serialized[i + 1], 10),
                dx: 0,
                dy: 0,
                direction: parseInt(serialized[i + 2], 10),
            });
        }
        return path;
    }
}

(globalThis as any).Room = MockRoom;

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
    (globalThis as any).Memory = {
        creeps: {},
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
        rooms: {},
        getObjectById: (_id: string) => null,
    };
    (globalThis as any)._heap = {
        _initialized: false,
        _kernelInstance: undefined,
        _cache: new Map<string, unknown>(),
        _pathCache: new Map<string, { path: string; tick: number }>(),
    };
}
