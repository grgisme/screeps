import { managerIntel } from "./manager.intel";

export const toolsSimulation = {
    assess: function (roomName: string) {
        const intel = Memory.intel ? Memory.intel[roomName] : null;

        console.log(`--- Simulation: Assessing ${roomName} ---`);

        if (!intel) {
            console.log(`No intel found for ${roomName}. Send a scout first!`);
            return;
        }

        console.log(`Sources: ${intel.sources}`);
        console.log(`Terrain Score: ${intel.terrainScore.toFixed(2)} (1.0 = All Walkable)`);
        console.log(`Status: ${intel.status}`);
        if (intel.controllerOwner) console.log(`Owner: ${intel.controllerOwner}`);

        console.log(`>>> FINAL SCORE: ${intel.score}`);

        if (intel.score > 15) console.log(`Verdict: ⭐ EXCELLENT expansion candidate.`);
        else if (intel.score > 10) console.log(`Verdict: ✅ GOOD candidate.`);
        else console.log(`Verdict: ❌ POOR candidate.`);
    }
};
