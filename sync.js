const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(command) {
    console.log(`\n🚀 Running: ${command}`);
    try {
        execSync(command, { stdio: 'inherit' });
    } catch (error) {
        console.error(`\n❌ Command failed: ${command}`);
        process.exit(1);
    }
}

// 1. Bump Version
console.log('🔢 Bumping version...');
const packagePath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const versionParts = pkg.version.split('.').map(Number);
versionParts[2]++; // Bump patch
const newVersion = versionParts.join('.');
pkg.version = newVersion;

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✅ Version bumped to ${newVersion}`);

// 2. Build & Upload
console.log('📤 Uploading to Screeps...');
run('npm run upload');

// 3. Git Sync
console.log('📂 Syncing with GitHub...');
run('git add .');
run(`git commit -m "Deploy v${newVersion}"`);
run('git push');

console.log(`\n🎉 Deployment v${newVersion} complete!`);
