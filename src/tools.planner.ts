export const toolsPlanner = {
    plan: function (roomName: string) {
        const room = Game.rooms[roomName];
        if (!room) {
            console.log(`❌ Room ${roomName} not found or not visible.`);
            return;
        }

        const mem = (room.memory as any).planning;
        if (!mem || !mem.bunkerCenter) {
            console.log(`❌ No Planning Data found for ${roomName}. (Manager.building hasn't run yet?)`);
            // Attempt to find it manually?
            console.log("   Run 'managerBuilding.run(room)' manually or wait for tick 100.");
            return;
        }

        const center = new RoomPosition(mem.bunkerCenter.x, mem.bunkerCenter.y, roomName);
        console.log(`📍 Bunker Center at [${center.x}, ${center.y}]`);

        const vis = new RoomVisual(roomName);

        // Draw Center
        vis.circle(center, { radius: 0.5, fill: 'red', opacity: 0.8 });
        vis.text("CENTER", center.x, center.y + 1, { color: 'red', font: 0.5 });

        // Simulate Extension Spiral
        let extensions = 0;
        let radius = 1;
        const potential: { x: number, y: number }[] = [];

        // Theoretical Max Extensions at RCL 8 = 60
        while (extensions < 60 && radius < 12) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                    if ((center.x + dx + center.y + dy) % 2 !== 0) continue; // Checkerboard

                    const x = center.x + dx;
                    const y = center.y + dy;
                    if (x < 2 || x > 48 || y < 2 || y > 48) continue;

                    const terrain = room.getTerrain().get(x, y);
                    if (terrain === TERRAIN_MASK_WALL) continue;

                    potential.push({ x, y });

                    // Visuals
                    vis.circle(x, y, { radius: 0.3, fill: 'yellow', opacity: 0.3 });
                    // vis.text("E", x, y + 0.2, { color: 'yellow', font: 0.3 });
                    extensions++;
                }
            }
            radius++;
        }

        console.log(`🔮 Plan Preview:`);
        console.log(`   Center: [${center.x}, ${center.y}]`);
        console.log(`   Potential Extension Slots: ${extensions}`);
        console.log(`   (Check map visuals for yellow dots)`);

        // Draw Skeleton Lines
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (spawn) {
            const sources = room.find(FIND_SOURCES);
            sources.forEach(s => {
                const path = PathFinder.search(spawn.pos, { pos: s.pos, range: 1 }, { plainCost: 2, swampCost: 5 });
                if (!path.incomplete) {
                    vis.poly(path.path, { stroke: 'white', strokeWidth: 0.1, lineStyle: 'dashed' });
                }
            });
        }
    }
};
