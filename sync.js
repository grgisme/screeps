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
versionParts[1]++; // Bump minor
// Fingers-and-toes rule: minor wraps at 20, major increments
if (versionParts[1] >= 20) {
    versionParts[0]++;
    versionParts[1] = 0;
}
const newVersion = versionParts.join('.');
pkg.version = newVersion;

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✅ Version bumped to ${newVersion}`);

// 1.5 Update src/version.ts
console.log('📝 Updating src/version.ts...');
const summary = process.argv[2] || "Update";
const versionFileContent = `export const SCRIPT_VERSION = "${newVersion}";\nexport const SCRIPT_SUMMARY = "${summary}";\n`;
fs.writeFileSync(path.join(__dirname, 'src', 'version.ts'), versionFileContent);

// 1.6 Update docs/index.md
console.log('📖 Updating docs/index.md...');
const docsPath = path.join(__dirname, 'docs', 'index.md');
if (fs.existsSync(docsPath)) {
    let docsContent = fs.readFileSync(docsPath, 'utf8');
    // Replace "## Recent Advancements (v...)" with current version
    docsContent = docsContent.replace(/## Recent Advancements \(v[^)]+\)/, `## Recent Advancements (v${newVersion})`);
    // Also handle specific version references if needed
    fs.writeFileSync(docsPath, docsContent);
}

// 2. Build & Upload
console.log('📤 Uploading to Screeps...');
run('npm run upload');

// 3. Git Sync
console.log('📂 Syncing with GitHub...');
run('git add .');
run(`git commit -m "Deploy v${newVersion}"`);
run('git push');

console.log(`\n🎉 Deployment v${newVersion} complete!`);
