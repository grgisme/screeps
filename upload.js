const { ScreepsAPI } = require('screeps-api');
const fs = require('fs');
const path = require('path');

// 1. Load your config
// Config is in src/.screeps.json based on file system
const configPath = path.join(__dirname, 'src', '.screeps.json');
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
        // Optional: Upload source maps if needed, though Screeps native support varies.
        // Usually just main.js is enough for a bundle.
    });

    console.log(`Pushing ${Object.keys(modules).length} modules to branch: ${config.branch}`);

    try {
        await api.code.set(config.branch, modules);
        console.log("✅ Success! Code uploaded to Screeps.");
    } catch (err) {
        console.error("❌ Upload failed:", err);
    }
}

upload();