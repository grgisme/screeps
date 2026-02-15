export const reporting = {
    run: function (room: Room) {
        if (Game.time % 20 === 0) {
            this.logSummary(room);
        }
        this.visualize(room);
    },

    logSummary: function (room: Room) {
        const rcl = room.controller ? `${room.controller.level} (${Math.round(room.controller.progress / room.controller.progressTotal * 100)}%)` : "N/A";
        const energy = `${room.energyAvailable} / ${room.energyCapacityAvailable}`;
        const bucket = Game.cpu.bucket;

        const creeps = room.find(FIND_MY_CREEPS);
        const roles: { [key: string]: number } = {};
        creeps.forEach(c => {
            const r = c.memory.role || 'unknown';
            roles[r] = (roles[r] || 0) + 1;
        });
        const roleStr = Object.entries(roles).map(([r, c]) => `${r}: ${c}`).join(', ');

        // Determine Goal
        // Determine Goal & Build Status
        let goal = "Unknown";
        let building = "";
        let next = "";

        const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        if (sites.length > 0) {
            // Summarize sites
            const siteCounts: { [key: string]: number } = {};
            sites.forEach(s => siteCounts[s.structureType] = (siteCounts[s.structureType] || 0) + 1);
            building = Object.entries(siteCounts).map(([t, c]) => `${c} ${t}`).join(', ');
            goal = `Construction (${sites.length} Sites)`;
        } else {
            building = "Nothing";
            if (room.controller) {
                const progress = Math.round(room.controller.progress / room.controller.progressTotal * 100);
                goal = `Upgrade (RCL ${room.controller.level}->${room.controller.level + 1} @ ${progress}%)`;
            }
        }

        // Predict Next Build
        if (room.controller) {
            const level = room.controller.level;
            if (level < 2) next = "Extensions (RCL 2)";
            else if (level < 3) next = "Tower, Containers (RCL 3)";
            else if (level < 4) next = "Storage (RCL 4)";
            else if (level < 5) next = "Links (RCL 5)";
            else next = "RCL " + (level + 1);
        }

        console.log(`[${Game.time}] Room ${room.name} | RCL: ${rcl} | Energy: ${energy} | Goal: ${goal}`);
        console.log(`\t🏗️ Building: ${building}`);
        console.log(`\t🔮 Next: ${next}`);
        console.log(`\t👥 Creeps: ${roleStr}`);
    },

    visualize: function (room: Room) {
        // Visualize Bunker Center
        if ((room.memory as any).planning && (room.memory as any).planning.bunkerCenter) {
            const center = (room.memory as any).planning.bunkerCenter;
            room.visual.circle(center.x, center.y, { fill: 'transparent', radius: 0.5, stroke: 'red' });
            room.visual.text("Bunker", center.x, center.y + 0.2, { color: 'red', font: 0.5 });

            // Visualize planned extensions?
            // Since we auto-place them, they are construction sites or structures.
            // But we can highlight our planned spiral if we wanted.
            // For now, let's just highlight the center.
        }
    }
};
