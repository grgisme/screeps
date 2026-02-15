// Memory extension samples
interface CreepMemory {
    role: string;
    room: string;
    working: boolean;
    state: number; // For state machine
    targetId?: Id<Structure | ConstructionSite | Source | Mineral | Resource | Creep>; // Added Creep for defender
    _path?: string; // Serialized path
    _pos?: { x: number, y: number, roomName: string }; // Last position for stuck detection
    _stuckCount?: number;
    emergency?: boolean;
}

interface RoomMemory {
    planning?: {
        bunkerCenter?: { x: number, y: number };
        layout?: { [key: string]: string }; // packed layout data
    };
    sources?: { [key: string]: { pos: RoomPosition, containerId?: Id<StructureContainer> } };
    roadHeatMap?: { [key: string]: number };
}

interface Memory {
    remoteRooms: { [roomName: string]: RemoteRoomData };
    intel: { [roomName: string]: import('./manager.intel').RoomIntel };
    diplomacy: {
        whitelist: string[];
    };
}

interface RemoteRoomData {
    sources: { pos: RoomPosition, id?: Id<Source> }[];
    controller?: { pos: RoomPosition, id?: Id<StructureController>, owner?: string, reservation?: { username: string, ticksToEnd: number } };
    lastScouted: number;
    state: 'safe' | 'hostile' | 'reserved' | 'unknown';
}

interface LogisticsTask {
    id: Id<any>;
    pos: RoomPosition;
    type: 'transfer' | 'withdraw' | 'pickup';
    resource: ResourceConstant;
    amount: number;
    priority: number;
}

interface SpawnMemory {
}

interface FlagMemory {
    override: boolean; // For manual planning override
}

// Syntax for adding proprties to `global` (ex "global.log")
declare namespace NodeJS {
    interface Global {
        log: any;
    }
}
