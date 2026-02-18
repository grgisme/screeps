const { ScreepsAPI } = require('screeps-api');
const fs = require('fs');
const path = require('path');

// 1. Load config
const configPath = path.join(__dirname, '.screeps.json');
if (!fs.existsSync(configPath)) {
    console.error("Config file not found at:", configPath);
    process.exit(1);
}
// Load the entire object containing both "main" and "local" keys
const allConfigs = JSON.parse(fs.readFileSync(configPath, 'utf8'));

async function run() {
    // 2. Prepare modules (do this once for all servers)
    console.log("Reading build artifacts...");
    const buildPath = path.join(__dirname, 'dist');
    if (!fs.existsSync(buildPath)) {
        console.error("Dist folder not found! Run 'npm run build' first.");
        process.exit(1);
    }

    const files = fs.readdirSync(buildPath);
    const modules = {};

    // Load JS files
    files.forEach(file => {
        if (file.endsWith('.js')) {
            const name = path.basename(file, '.js');
            modules[name] = fs.readFileSync(path.join(buildPath, file), 'utf8');
        }
    });

    // Load Source Maps (special handling for ErrorMapper)
    const mapFile = path.join(buildPath, 'main.js.map');
    if (fs.existsSync(mapFile)) {
        const mapContent = fs.readFileSync(mapFile, 'utf8');
        // We wrap it in module.exports so it can be required in game
        modules['main.js.map'] = `module.exports = ${mapContent};`;
        console.log(`📍 Source map loaded (${(mapContent.length / 1024).toFixed(1)} KB)`);
    } else {
        console.log("⚠️  No source map found — ErrorMapper will be inactive");
    }

    // 3. Upload to each server found in .screeps.json
    const serverNames = Object.keys(allConfigs);

    // We use a loop to handle async uploads sequentially or in parallel
    for (const serverName of serverNames) {
        const serverConfig = allConfigs[serverName];
        console.log(`\n🚀 Deploying to [${serverName}] (${serverConfig.hostname})...`);

        try {
            const api = new ScreepsAPI(serverConfig);

            // If using email/pass (local), we might need to auth explicitly first
            if (!serverConfig.token && serverConfig.password) {
                await api.auth(serverConfig.email, serverConfig.password);
            }

            await api.code.set(serverConfig.branch, modules);
            console.log(`✅ [${serverName}] Success! Code uploaded to branch "${serverConfig.branch}"`);
        } catch (err) {
            console.error(`❌ [${serverName}] Upload failed:`, err.message);
        }
    }
}

run();