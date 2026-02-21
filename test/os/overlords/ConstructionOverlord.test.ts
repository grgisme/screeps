// ============================================================================
// ConstructionOverlord — Reverse-Anchor Tests
// ============================================================================
//
// Tests target `reverseAnchorFromSpawn()` (via planRoom()) and
// `canBlueprintFit()` (exposed on the overlord instance through unit
// exercising of planRoom).
// ============================================================================

import "../../mock.setup";
import { expect } from "chai";
import { ConstructionOverlord } from "../../../src/os/overlords/ConstructionOverlord";
import { BunkerLayout } from "../../../src/os/infrastructure/BunkerLayout";
import { MockColony, MockRoom, MockRoomPosition } from "../../mock.setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock spawn at (sx, sy) */
function makeSpawn(sx: number, sy: number, roomName = "W1N1"): any {
    return {
        id: "spawn1",
        pos: new MockRoomPosition(sx, sy, roomName),
        structureType: STRUCTURE_SPAWN,
        room: { name: roomName }
    };
}

/** Build a ConstructionOverlord wired to a mock colony */
function makeOverlord(roomName = "W1N1"): {
    overlord: ConstructionOverlord;
    colony: any;
    room: MockRoom;
} {
    const room = new MockRoom(roomName);
    room.find = (_type: number) => [];

    const colony = new MockColony(roomName) as any;
    colony.room = room;
    colony.memory = {};
    colony.state = { rclChanged: false };
    colony.overlords = [];
    colony.hatchery = { enqueue: () => { }, refresh: () => { } };
    colony.logistics = {
        offerIds: [], requesters: [],
        incomingReservations: new Map(), outgoingReservations: new Map(),
        matchWithdraw: () => null, matchTransfer: () => null,
        requestInput: () => { }, requestOutput: () => { },
        getEffectiveStore: () => 999999,
        refresh: () => { }, init: () => { }
    };
    colony.linkNetwork = { refresh: () => { }, init: () => { }, run: () => { } };
    colony.registerOverlord = (_o: any) => { };

    const overlord = new ConstructionOverlord(colony);
    return { overlord, colony, room };
}

// ---------------------------------------------------------------------------
// canBlueprintFit — low-level helper tests
// ---------------------------------------------------------------------------

describe("ConstructionOverlord — canBlueprintFit", () => {
    let overlord: ConstructionOverlord;

    beforeEach(() => {
        // All-plains terrain
        (global as any).Game.map.getRoomTerrain = (_name: string) => ({
            get: (_x: number, _y: number) => 0 // 0 = plain
        });
        ({ overlord } = makeOverlord());
    });

    it("should accept a clear anchor at the center of a room", () => {
        const result = (overlord as any).canBlueprintFit("W1N1", 25, 25);
        expect(result).to.be.true;
    });

    it("should reject when anchor is too close to the left/top border (< 7)", () => {
        expect((overlord as any).canBlueprintFit("W1N1", 6, 25)).to.be.false;
        expect((overlord as any).canBlueprintFit("W1N1", 25, 6)).to.be.false;
    });

    it("should reject when anchor is too close to the right/bottom border (> 42)", () => {
        expect((overlord as any).canBlueprintFit("W1N1", 43, 25)).to.be.false;
        expect((overlord as any).canBlueprintFit("W1N1", 25, 43)).to.be.false;
    });

    it("should reject when a wall tile falls inside the 13×13 footprint", () => {
        // Wall exactly at the border of the footprint (anchor ± 6)
        (global as any).Game.map.getRoomTerrain = (_name: string) => ({
            get: (x: number, y: number) => (x === 25 + 6 && y === 25) ? TERRAIN_MASK_WALL : 0
        });
        expect((overlord as any).canBlueprintFit("W1N1", 25, 25)).to.be.false;
    });

    it("should accept when walls are just outside the footprint", () => {
        // Wall at radius 7 — outside the 13×13 area
        (global as any).Game.map.getRoomTerrain = (_name: string) => ({
            get: (x: number, y: number) => (x === 25 + 7 && y === 25) ? TERRAIN_MASK_WALL : 0
        });
        expect((overlord as any).canBlueprintFit("W1N1", 25, 25)).to.be.true;
    });
});

// ---------------------------------------------------------------------------
// reverseAnchorFromSpawn — derive anchor from an existing spawn position
// ---------------------------------------------------------------------------

describe("ConstructionOverlord — reverseAnchorFromSpawn", () => {
    const ROOM = "W1N1";
    const spawnOffsets = BunkerLayout.structures[STRUCTURE_SPAWN] ?? [];

    beforeEach(() => {
        // All-plains terrain
        (global as any).Game.map.getRoomTerrain = (_name: string) => ({
            get: (_x: number, _y: number) => 0
        });
    });

    it("should return an anchor that places the existing spawn on a blueprint spawn position", () => {
        // Place spawn at offset-1 position from anchor (25,25): spawn at (24,27)
        const offset0 = spawnOffsets[0]; // {x:-1, y:2}
        const spawnX = 25 + offset0.x;  // 24
        const spawnY = 25 + offset0.y;  // 27

        const { overlord, room } = makeOverlord(ROOM);
        const spawn = makeSpawn(spawnX, spawnY, ROOM);
        const result: any = (overlord as any).reverseAnchorFromSpawn(room, spawn);

        expect(result).to.not.be.null;

        // The returned anchor must satisfy: spawn = anchor + some blueprint spawn offset
        const validAlignment = spawnOffsets.some(off =>
            result.x + off.x === spawnX && result.y + off.y === spawnY
        );
        expect(validAlignment, `anchor (${result.x},${result.y}) must align spawn (${spawnX},${spawnY}) to a blueprint spawn slot`).to.be.true;
    });

    it("should return a valid fit anchor (passes canBlueprintFit) for each blueprint spawn position", () => {
        // For each spawn offset, place the spawn there and confirm the returned anchor passes fit
        for (const offset of spawnOffsets) {
            const spawnX = 25 + offset.x;
            const spawnY = 25 + offset.y;

            const { overlord, room } = makeOverlord(ROOM);
            const spawn = makeSpawn(spawnX, spawnY, ROOM);
            const result: any = (overlord as any).reverseAnchorFromSpawn(room, spawn);

            expect(result).to.not.be.null;
            // The returned anchor must pass the fit check (no walls, in bounds)
            const fits = (overlord as any).canBlueprintFit(ROOM, result.x, result.y);
            expect(fits, `anchor for spawn at (${spawnX},${spawnY}) should pass fit check but got anchor (${result.x},${result.y})`).to.be.true;
        }
    });

    it("should return fallback when no offset produces a passing fit (all-wall terrain)", () => {
        // All terrain is walls — no fit will pass
        (global as any).Game.map.getRoomTerrain = (_name: string) => ({
            get: (_x: number, _y: number) => TERRAIN_MASK_WALL
        });

        const { overlord, room } = makeOverlord(ROOM);
        const spawn = makeSpawn(25, 25, ROOM);
        const result: any = (overlord as any).reverseAnchorFromSpawn(room, spawn);

        // Should still return something (fallback to first offset)
        expect(result).to.not.be.null;
        const off0 = spawnOffsets[0];
        expect(result.x).to.equal(25 - off0.x);
        expect(result.y).to.equal(25 - off0.y);
    });

    it("the Math: anchor = spawn - offset is correct for the first blueprint spawn slot", () => {
        // Explicit: if spawn is at (24, 27) and offset[0] is {x:-1, y:2},
        // the correct anchor is (24-(-1), 27-2) = (25, 25)
        const off = spawnOffsets[0]; // {x:-1, y:2}
        const spawnX = 25 + off.x;  // 24
        const spawnY = 25 + off.y;  // 27

        const { overlord, room } = makeOverlord(ROOM);
        const spawn = makeSpawn(spawnX, spawnY, ROOM);
        const result: any = (overlord as any).reverseAnchorFromSpawn(room, spawn);

        expect(result.x).to.equal(25);
        expect(result.y).to.equal(25);
    });
});

// ---------------------------------------------------------------------------
// planRoom() integration — branch selection
// ---------------------------------------------------------------------------

describe("ConstructionOverlord — planRoom() branch selection", () => {
    const ROOM = "W1N1";
    const spawnOffsets = BunkerLayout.structures[STRUCTURE_SPAWN] ?? [];

    beforeEach(() => {
        (global as any).Game.map.getRoomTerrain = (_name: string) => ({
            get: (_x: number, _y: number) => 0
        });
    });

    it("should use reverse-anchor when empire has exactly 1 spawn and room has 1 spawn", () => {
        const { overlord, colony, room } = makeOverlord(ROOM);

        // Spawn placed at the first blueprint spawn slot relative to anchor (25,25)
        const off0 = spawnOffsets[0]; // {x:-1, y:2}
        const spawn = makeSpawn(25 + off0.x, 25 + off0.y, ROOM);
        room.find = (type: number) => (type === FIND_MY_SPAWNS ? [spawn] : []);
        (global as any).Game.spawns = { Spawn1: spawn };

        colony.memory.anchor = undefined;
        (overlord as any).planRoom();

        expect(colony.memory.anchor).to.not.be.undefined;
        expect(colony.memory.anchor.x).to.equal(25);
        expect(colony.memory.anchor.y).to.equal(25);
    });

    it("should set an anchor that passes fit check when using reverse-anchor path", () => {
        const { overlord, colony, room } = makeOverlord(ROOM);

        const off0 = spawnOffsets[0];
        const spawn = makeSpawn(25 + off0.x, 25 + off0.y, ROOM);
        room.find = (type: number) => (type === FIND_MY_SPAWNS ? [spawn] : []);
        (global as any).Game.spawns = { Spawn1: spawn };

        colony.memory.anchor = undefined;
        (overlord as any).planRoom();

        const { x, y } = colony.memory.anchor;
        const fits = (overlord as any).canBlueprintFit(ROOM, x, y);
        expect(fits).to.be.true;
    });

    it("should skip reverse-anchor when empire has 2+ spawns (use DT path)", () => {
        const { overlord, colony, room } = makeOverlord(ROOM);

        const spawn1 = makeSpawn(25, 25, ROOM);
        const spawn2 = makeSpawn(30, 30, "W2N2");
        room.find = (type: number) => (type === FIND_MY_SPAWNS ? [spawn1] : []);
        // Two empire spawns → reverse-anchor branch is skipped
        (global as any).Game.spawns = { Spawn1: spawn1, Spawn2: spawn2 };

        colony.memory.anchor = undefined;

        // Stub distanceTransform so DT scan produces a predictable result
        const algMod = require("../../../src/utils/Algorithms");
        const origDT = algMod.distanceTransform;
        algMod.distanceTransform = () => ({ get: (_x: number, _y: number) => 7 });

        try {
            (overlord as any).planRoom();
            // DT path should have set an anchor somewhere
            expect(colony.memory.anchor).to.not.be.undefined;
        } finally {
            algMod.distanceTransform = origDT;
        }
    });
});
