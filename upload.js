const { ScreepsAPI } = require('screeps-api');
const fs = require('fs');
const path = require('path');

// 1. Load your config
// Config is in src/.screeps.json based on file system
const configPath = path.join(__dirname, '.screeps.json');
if (!fs.existsSync(configPath)) {
    console.error("Config file not found at:", configPath);
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath));

// 2. Initialize API
const api = new ScreepsAPI(config);

async function upload() {
    console.log("Reading build artifacts...");
    // Read from DIST, not SRC
    const buildPath = path.join(__dirname, 'dist');
    if (!fs.existsSync(buildPath)) {
        console.error("Dist folder not found! Run 'npm run build' first.");
        process.exit(1);
    }

    const files = fs.readdirSync(buildPath);

    const modules = {};
    files.forEach(file => {
        if (file.endsWith('.js')) {
            // main.js -> main
            const name = path.basename(file, '.js');
            modules[name] = fs.readFileSync(path.join(buildPath, file), 'utf8');
        }
    });

    // Upload source maps for ErrorMapper
    // Screeps convention: upload `main.js.map` as a module named "main.js.map"
    // The Screeps runtime strips the trailing `.js`, so `require("main.js.map")` works
    const mapFile = path.join(buildPath, 'main.js.map');
    if (fs.existsSync(mapFile)) {
        const mapContent = fs.readFileSync(mapFile, 'utf8');
        modules['main.js.map'] = `module.exports = ${mapContent};`;
        console.log(`📍 Source map loaded (${(mapContent.length / 1024).toFixed(1)} KB)`);
    } else {
        console.log("⚠️  No source map found — ErrorMapper will be inactive");
    }

    console.log(`Pushing ${Object.keys(modules).length} modules to branch: ${config.branch}`);

    try {
        await api.code.set(config.branch, modules);
        console.log("✅ Success! Code uploaded to Screeps.");
    } catch (err) {
        console.error("❌ Upload failed:", err);
    }
}

upload();