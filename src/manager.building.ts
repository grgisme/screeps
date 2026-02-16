export const managerBuilding = {
    run: function (room: Room) {
        if (Game.time % 100 !== 0 && !(room.memory as any).forceBuildingRun) return; // Run rarely to save CPU
        delete (room.memory as any).forceBuildingRun;

        // Manual Override
        const overrideFlag = Game.flags['OVERRIDE'];
        if (overrideFlag && overrideFlag.pos.roomName === room.name) return;

        // Check planning memory
        const rcl = room.controller?.level || 0;
        const spawn = room.find(FIND_MY_SPAWNS)[0];

        // Flag Overrides
        const flagMigrate = Game.flags['MIGRATE'];
        if (flagMigrate && flagMigrate.pos.roomName === room.name) {
            console.log(`🏳️ MANUAL TRIGGER: Migration requested.`);
            delete (room.memory as any).planning;
            delete (room.memory as any).roadsInitialized;
            flagMigrate.remove();
        }

        const flagCenter = Game.flags['CENTER'];
        if (flagCenter && flagCenter.pos.roomName === room.name) {
            console.log(`🏳️ MANUAL TRIGGER: Bunker Center set to [${flagCenter.pos.x}, ${flagCenter.pos.y}]`);
            if (!(room.memory as any).planning) (room.memory as any).planning = {};
            (room.memory as any).planning.bunkerCenter = { x: flagCenter.pos.x, y: flagCenter.pos.y };
            delete (room.memory as any).roadsInitialized; // Force road redraw
            flagCenter.remove();
        }

        // Planning Check
        if (!(room as any).memory.planning?.bunkerCenter) {
            const center = this.findBunkerCenter(room, spawn, rcl);
            if (center) {
                if (!(room as any).memory.planning) (room as any).memory.planning = {};
                (room as any).memory.planning.bunkerCenter = { x: center.x, y: center.y };
                console.log(`🏗️ BUNKER PLANNER: New Center Established at [${center.x}, ${center.y}] (RCL ${rcl})`);

                // CLEANUP: Remove old sites to allow new plan to take over
                const oldSites = room.find(FIND_MY_CONSTRUCTION_SITES);
                oldSites.forEach(s => s.remove());
                console.log(`🧹 CLEANUP: Nuked ${oldSites.length} old construction sites to prepare for new plan.`);

                delete (room.memory as any).roadsInitialized; // Force road redraw
            } else { return; }
        }

        const centerPos = (room as any).memory.planning.bunkerCenter;
        const center = new RoomPosition(centerPos.x, centerPos.y, room.name);

        // RCL Checks
        // RCL 1 Speed Boost: Early Road Skeleton
        if (rcl >= 1) {
            const mem = room.memory as any;
            // spawn defined above

            // Run if: 1. Periodically (rarely) OR 2. Not yet initialized
            if (spawn && (Game.time % 1000 === 0 || !mem.roadsInitialized)) {
                const sources = room.find(FIND_SOURCES);
                const targets = [...sources];
                if (room.controller) targets.push(room.controller as any);

                targets.forEach(t => {
                    const path = PathFinder.search(spawn.pos, { pos: t.pos, range: 1 }, { plainCost: 2, swampCost: 5 });
                    path.path.forEach(p => room.createConstructionSite(p.x, p.y, STRUCTURE_ROAD));
                });

                mem.roadsInitialized = true;
                console.log(`🛣️ ROAD SKELETON: Initialized/Refreshed for ${room.name}`);
            }
        }

        const extensionsPossible = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl];
        const existingExt = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).length;
        const constructionExt = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).length;

        if (existingExt + constructionExt < extensionsPossible) {
            this.placeExtensionSpiral(room, center, extensionsPossible);
        }

        // Tower & Container (RCL 3)
        // Note: User requested Source Containers at RCL 2.
        if (rcl >= 2) {
            // Source Containers
            const sources = room.find(FIND_SOURCES);
            sources.forEach(source => {
                const containers = source.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER });
                const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER });

                if (containers.length === 0 && sites.length === 0) {
                    // Place container. Where?
                    // Ideally, on the path to the spawn/bunker.
                    // Simple heuristic: find a walkable spot 1 tile away that is not a wall.
                    // Better: use PathFinder to find path to center, pick first step.
                    const ret = PathFinder.search(source.pos, { pos: center, range: 1 });
                    if (ret.path.length > 0) {
                        const pos = ret.path[0];
                        room.createConstructionSite(pos.x, pos.y, STRUCTURE_CONTAINER);
                    } else {
                        // Fallback: any clear spot
                        const adj = [
                            { x: source.pos.x + 1, y: source.pos.y }, { x: source.pos.x - 1, y: source.pos.y },
                            { x: source.pos.x, y: source.pos.y + 1 }, { x: source.pos.x, y: source.pos.y - 1 },
                            { x: source.pos.x + 1, y: source.pos.y + 1 }, { x: source.pos.x - 1, y: source.pos.y - 1 },
                            { x: source.pos.x + 1, y: source.pos.y - 1 }, { x: source.pos.x - 1, y: source.pos.y + 1 }
                        ];
                        for (const p of adj) {
                            if (room.getTerrain().get(p.x, p.y) !== TERRAIN_MASK_WALL) {
                                room.createConstructionSite(p.x, p.y, STRUCTURE_CONTAINER);
                                break;
                            }
                        }
                    }
                }
            });
        }

        if (rcl >= 3) {
            const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
            const towerSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER });
            if (towers.length + towerSites.length < 1) {
                // Place Tower near Center (offset)
                room.createConstructionSite(center.x + 1, center.y + 1, STRUCTURE_TOWER);
            }

            // USER REQUEST: Ramparts over Spawn/Tower at RCL 3
            const critical = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER
            });
            critical.forEach(s => {
                const rampart = s.pos.lookFor(LOOK_STRUCTURES).find(st => st.structureType === STRUCTURE_RAMPART);
                const rampartSite = s.pos.lookFor(LOOK_CONSTRUCTION_SITES).find(st => st.structureType === STRUCTURE_RAMPART);
                if (!rampart && !rampartSite) {
                    room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
                }
            });

            // Controller Container
            if (room.controller) {
                const containers = room.controller.pos.findInRange(FIND_STRUCTURES, 2, { filter: s => s.structureType === STRUCTURE_CONTAINER });
                const containerSites = room.controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, { filter: s => s.structureType === STRUCTURE_CONTAINER });
                if (containers.length + containerSites.length === 0) {
                    const path = PathFinder.search(room.controller.pos, { pos: center, range: 1 });
                    if (path.path.length > 0) {
                        room.createConstructionSite(path.path[0].x, path.path[0].y, STRUCTURE_CONTAINER);
                    }
                }
            }
        }

        // Storage & Ramparts (RCL 4)
        if (rcl >= 4) {
            const storage = room.storage;
            const storageSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_STORAGE });

            if (!storage && storageSites.length === 0) {
                room.createConstructionSite(center.x, center.y, STRUCTURE_STORAGE);
            }

            // Ramparts on Critical Structures (Spawn, Storage, Tower)
            const critical = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_SPAWN ||
                    s.structureType === STRUCTURE_STORAGE ||
                    s.structureType === STRUCTURE_TOWER
            });

            critical.forEach(s => {
                const rampart = s.pos.lookFor(LOOK_STRUCTURES).find(st => st.structureType === STRUCTURE_RAMPART);
                const rampartSite = s.pos.lookFor(LOOK_CONSTRUCTION_SITES).find(st => st.structureType === STRUCTURE_RAMPART);
                if (!rampart && !rampartSite) {
                    room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
                }
            });
        }

        // Roads: Heatmap
        if (room.memory.roadHeatMap) {
            for (const key in room.memory.roadHeatMap) {
                if (room.memory.roadHeatMap[key] > 50) {
                    const [x, y] = key.split(',').map(Number);
                    room.createConstructionSite(x, y, STRUCTURE_ROAD);
                }
            }
        }
    },

    findBunkerCenter: function (room: Room, spawn: StructureSpawn, rcl: number): { x: number, y: number } | null {
        const terrain = room.getTerrain();

        // Phase 1: Bootstrap (RCL < 4) - Speed is King
        // Find a 3x3 spot near spawn (Range 5)
        if (rcl < 4 && spawn) {
            console.log(`🏗️ PHASE 1 (Bootstrap): Finding 3x3 hub near spawn...`);
            let bestSpot = null;
            let minDist = 999;

            for (let x = Math.max(2, spawn.pos.x - 5); x <= Math.min(47, spawn.pos.x + 5); x++) {
                for (let y = Math.max(2, spawn.pos.y - 5); y <= Math.min(47, spawn.pos.y + 5); y++) {
                    // Check 3x3
                    let allClear = true;
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            if (terrain.get(x + dx, y + dy) === TERRAIN_MASK_WALL) {
                                allClear = false;
                                break;
                            }
                        }
                        if (!allClear) break;
                    }

                    if (allClear) {
                        const dist = Math.abs(x - spawn.pos.x) + Math.abs(y - spawn.pos.y);
                        if (dist < minDist) {
                            minDist = dist;
                            bestSpot = { x, y };
                        }
                    }
                }
            }
            if (bestSpot) return bestSpot;
            // Fallback to Phase 2 if no Phase 1 spot found (unlikely unless spawn is in a hole)
        }

        // Phase 2: Fortress (RCL >= 4 or Fallback) - Optimization is King
        // Find best 5x5 spot in room. Score = (Clearance * 10) - (Distance * 1)
        console.log(`🏰 PHASE 2 (Fortress): Finding optimal 5x5 bunker...`);
        let bestSpot = null;
        let maxScore = -9999;

        // Slide window over entire room
        for (let x = 3; x < 47; x++) {
            for (let y = 3; y < 47; y++) {
                // Check 5x5 (Range 2)
                let allClear = true;
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dy = -2; dy <= 2; dy++) {
                        if (terrain.get(x + dx, y + dy) === TERRAIN_MASK_WALL) {
                            allClear = false;
                            break;
                        }
                    }
                    if (!allClear) break;
                }

                if (allClear) {
                    // Check wider clearance (Range 3, 4, etc for future expansion?)
                    // For now, just 5x5 is required.
                    const dist = spawn ? PathFinder.search(spawn.pos, { pos: new RoomPosition(x, y, room.name), range: 1 }).path.length : 25;
                    // Preference: Open space (score? we already checked it's clear). 
                    // Let's just minimize distance for now, BUT with a heavy penalty if too close to exits?
                    // Actually, just maximizing distance from walls is good, but hard to calc cheap.
                    // Simple: -Distance.
                    const score = -dist;
                    if (score > maxScore) {
                        maxScore = score;
                        bestSpot = { x, y };
                    }
                }
            }
        }
        return bestSpot;
    },

    placeExtensionSpiral: function (room: Room, center: RoomPosition, maxExtensions: number) {
        const structures = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
        const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
        if (structures.length + sites.length >= maxExtensions) return;

        // USER REQUEST: Efficiency Check (Avoid blocking paths between Sources and Tower/Spawn)
        const sources = room.find(FIND_SOURCES);
        const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        const criticalTargets = [...towers, spawn].filter(t => t);

        const pathsToAvoid: RoomPosition[] = [];
        if (criticalTargets.length > 0) {
            sources.forEach(source => {
                criticalTargets.forEach(target => {
                    const ret = PathFinder.search(source.pos, { pos: target!.pos, range: 1 }, {
                        plainCost: 2, swampCost: 4, // Encourage following existing roads or clear paths
                        roomCallback: (roomName) => {
                            let costs = new PathFinder.CostMatrix;
                            // Pre-existing structures should be obstacles, BUT we want the "ideal" path
                            // So we don't add structures here unless they are walls.
                            return costs;
                        }
                    });
                    if (!ret.incomplete) pathsToAvoid.push(...ret.path);
                });
            });
        }

        let radius = 1;
        while (radius < 12) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    // Only check edge
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                    // Checkerboard
                    if ((center.x + dx + center.y + dy) % 2 !== 0) continue;

                    const x = center.x + dx;
                    const y = center.y + dy;

                    // Validation
                    if (x < 2 || x > 48 || y < 2 || y > 48) continue;
                    const terrain = room.getTerrain();
                    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                    // Path Blocking Check (5th-10th extensions specifically mentioned, but good for all)
                    if (pathsToAvoid.some(p => p.x === x && p.y === y)) continue;

                    const structs = room.lookForAt(LOOK_STRUCTURES, x, y);
                    if (structs.length > 0) continue;

                    const existingSites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
                    if (existingSites.length > 0) continue;

                    room.createConstructionSite(x, y, STRUCTURE_EXTENSION);
                    return; // One at a time
                }
            }
            radius++;
        }
    }
};
