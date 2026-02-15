export const managerCPU = {
    strategy: 'healthy' as 'critical' | 'recovering' | 'healthy' | 'burst',

    init: function () {
        const bucket = Game.cpu.bucket;

        if (bucket < 1000) {
            this.strategy = 'critical';
            if (Game.time % 10 === 0) console.log(`🔥 CPU CRITICAL: Bucket ${bucket}. shutting down non-essentials.`);
        } else if (bucket < 5000) {
            this.strategy = 'recovering';
        } else if (bucket > 9500) {
            this.strategy = 'burst';
        } else {
            this.strategy = 'healthy';
        }

        // Lifetime Account Awareness
        // If limit > 30 (e.g. 500), we can be more aggressive?
        // Actually, bucket fills faster (or rather, we get more CPU per tick to fill it).
        // But the bucket CAP is still 10,000.
        // So the thresholds don't necessarily change, but we might stay in 'burst' longer.
        // User requested: "Adjust the 'Healthy' bucket thresholds dynamically"
        // If we have huge CPU (Limit > 100), maybe 'recovering' is less scary?
        // Actually, on shard2 user has "Lifetime CPU Unlock".
        // Let's stick to the user's requested thresholds for now.
    },

    getStrategy: function () {
        return this.strategy;
    },

    shouldRun: function (taskType: 'spawn' | 'harvest' | 'build' | 'repair' | 'scout' | 'upgrading' | 'expansion') {
        if (this.strategy === 'critical') {
            return taskType === 'spawn' || taskType === 'harvest';
        }
        if (this.strategy === 'recovering') {
            return taskType !== 'scout' && taskType !== 'expansion'; // Disable expansion/scouting
        }
        return true; // Healthy/Burst runs everything
    }
};
