export const toolsInspector = {
    inspect: function (creepName: string) {
        const creep = Game.creeps[creepName];
        if (!creep) {
            console.log(`❌ Creep ${creepName} not found.`);
            return;
        }

        const mem = creep.memory as any;
        const pos = `${creep.pos.x},${creep.pos.y} [${creep.room.name}]`;
        const role = mem.role;
        const task = mem.working ? "Working" : "Getting Energy";
        const target = mem.targetId ? Game.getObjectById(mem.targetId) : "None";
        const energy = `${creep.store[RESOURCE_ENERGY]} / ${creep.store.getCapacity()}`;

        console.log(`🔍 INSPECTOR: ${creepName}`);
        console.log(`\t📍 Pos: ${pos}`);
        console.log(`\t🛠️ Role: ${role} | State: ${task}`);
        console.log(`\t🔋 Energy: ${energy}`);
        console.log(`\t🎯 Target: ${target} (${mem.targetId})`);
        console.log(`\t🧠 Full Memory: ${JSON.stringify(mem)}`);
    }
};
