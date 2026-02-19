import "../../mock.setup";
import { expect } from "chai";
import { MiningSite } from "../../../src/os/colony/MiningSite";
import { resetMocks } from "../../mock.setup";

describe("MiningSite", () => {
    let mockColony: any;
    let room: Room;
    let source: Source;

    afterEach(() => {
        resetMocks();
    });

    beforeEach(() => {
        room = new Room("W1N1");
        (globalThis as any).Game.rooms["W1N1"] = room;

        // Mock find
        (room as any).find = (type: number) => {
            if (type === FIND_MY_SPAWNS) {
                return [{ pos: new RoomPosition(5, 5, "W1N1") }];
            }
            return [];
        };

        source = {
            id: "src1" as Id<Source>,
            pos: new RoomPosition(10, 10, "W1N1"),
            energy: 3000,
            energyCapacity: 3000,
            ticksToRegeneration: 300,
            room: room
        } as unknown as Source;

        mockColony = {
            name: "W1N1",
            room: room,
            logistics: {
                requestInput: () => { }
            }
        };

        // Mock PathFinder
        (globalThis as any).PathFinder = {
            search: (_origin: RoomPosition, _goal: any) => {
                // Mock a distance of 10
                return {
                    path: new Array(10).fill(new RoomPosition(0, 0, "W1N1")),
                    incomplete: false
                };
            },
            CostMatrix: class {
                set() { }
                get() { return 0; }
            }
        };
        // Mock Game.getObjectById for getter-based MiningSite
        (globalThis as any).Game.getObjectById = (id: string) => {
            if (id === "src1") return source;
            return null;
        };
    });

    it("should instantiate and refresh", () => {
        const site = new MiningSite(mockColony, source.id as Id<Source>);
        expect(site.source!.id).to.equal(source.id);
    });

    it("should calculate hauling power needed based on distance", () => {
        const site = new MiningSite(mockColony, source.id as Id<Source>);
        // Mock container pos
        site.containerPos = new RoomPosition(11, 11, "W1N1");

        // Mock controller (owned) -> 10 energy/tick
        room.controller = { my: true, reservation: undefined } as any;

        // Force distance calc
        (site as any).calculateDistance();
        // Distance mocked to 10
        // Power = 10 * 2 * 10 = 200
        const power = site.calculateHaulingPowerNeeded();

        expect(site.distance).to.equal(10);
        expect(power).to.equal(200);
    });

    it("should handle unreserved room power calculation", () => {
        const site = new MiningSite(mockColony, source.id as Id<Source>);
        site.containerPos = new RoomPosition(11, 11, "W1N1");

        // Mock controller (none) -> 5 energy/tick
        room.controller = undefined;

        (site as any).calculateDistance();
        // Power = 5 * 2 * 10 = 100
        const power = site.calculateHaulingPowerNeeded();

        expect(power).to.equal(100);
    });
});
