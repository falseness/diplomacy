#!/usr/bin/env node
// Dead-code gate for the retired Divided Valley planner. The planner file must stay
// on disk byte-identical to the retired copy, no .js/.html file may reference it, and
// index.html must load the circle generation scripts in dependency order.
// Usage: node ai/test-coop-generation-sources.js [--output-dir DIR] [--fault reintroduce-valley]
// Scans git-visible files (tracked or untracked, not ignored). --output-dir writes sources.json. --fault reintroduce-valley copies the scanned sources to
// DIR/fault-scratch, adds a planner reference to the scratch ai/generateMap.js, scans the
// scratch copy instead of the repository and must fail naming that file (requires --output-dir).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), {execFileSync} = require('child_process');
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
const FAULTS = ['reintroduce-valley'];
if (fault !== undefined && !FAULTS.includes(fault)) { console.error(`unknown fault ${fault}`); process.exit(2); }
if (fault && !outputDir) { console.error('--fault needs --output-dir for its scratch copy'); process.exit(2); }

// Tokens are assembled from parts so this gate never matches its own scan (or a repo grep).
const VALLEY = 'valley';
const PLANNER = `ai/coop-${VALLEY}-plan.js`;
// sha256 of the planner as retired (recorded when circle generation replaced it).
const PLANNER_SHA256 = '254fb99119d733cc6f277b3ccf8c97a9e23a16afa2794e9f0ab18aceb9e0c335';
const TOKENS = [`coop-${VALLEY}-plan`, 'planDivided' + 'Valley', VALLEY + 'RowPlans', 'verify' + 'Valley'];
const SCRIPT_ORDER = ['ai/coop-hex-geometry.js', 'ai/coop-map-scaling.js', 'ai/coop-circle-plan.js', 'ai/generateMap.js'];

// Repository .js/.html files: tracked plus untracked-but-not-ignored, so gitignored local tooling,
// node_modules and artifacts/ are out of scope. The list always comes from the real checkout.
const SOURCE_FILES = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'})
    .split('\0').filter(file => /\.(js|html)$/.test(file) && file !== PLANNER &&
        !/^(node_modules|artifacts)\//.test(file) && fs.existsSync(path.join(root, file))).sort();

function references(dir) {
    const found = [];
    for (const file of SOURCE_FILES) {
        const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
        lines.forEach((line, i) => {
            const tokens = TOKENS.filter(token => line.includes(token));
            if (tokens.length) found.push({file, line: i + 1, tokens});
        });
    }
    return found;
}

let scanRoot = root;
if (fault === 'reintroduce-valley') {
    scanRoot = path.resolve(outputDir, 'fault-scratch');
    fs.rmSync(scanRoot, {recursive: true, force: true});
    for (const file of [...SOURCE_FILES, PLANNER]) {
        fs.mkdirSync(path.dirname(path.join(scanRoot, file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(scanRoot, file));
    }
    fs.appendFileSync(path.join(scanRoot, 'ai/generateMap.js'),
        `\nconst reintroducedValley = require('./${path.basename(PLANNER)}').${TOKENS[1]}\n`);
}

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };

const plannerPath = path.join(scanRoot, PLANNER);
const valleyOnDisk = fs.existsSync(plannerPath);
const valleySha256 = valleyOnDisk ? crypto.createHash('sha256').update(fs.readFileSync(plannerPath)).digest('hex') : null;
assert('valley-on-disk', valleyOnDisk, {file: PLANNER});
assert('valley-sha256', valleySha256 === PLANNER_SHA256, {expected: PLANNER_SHA256, observed: valleySha256});

const valleyReferences = references(scanRoot);
assert('valley-unreferenced', valleyReferences.length === 0, valleyReferences);

const html = fs.readFileSync(path.join(scanRoot, 'index.html'), 'utf8');
const loaded = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g)].map(m => m[1].replace(/^\.\//, ''));
const scriptOrder = loaded.filter(src => SCRIPT_ORDER.includes(src));
assert('script-order', JSON.stringify(scriptOrder) === JSON.stringify(SCRIPT_ORDER), {expected: SCRIPT_ORDER, observed: scriptOrder});

const summary = {fault: fault || null, scanRoot: path.relative(root, scanRoot) || '.', scannedFiles: SOURCE_FILES.length,
    valleyOnDisk, valleySha256, expectedSha256: PLANNER_SHA256, valleyReferences, scriptOrder,
    failures: failures.length, failedAssertions: failures.map(f => f.name), pass: failures.length === 0};
if (outputDir) {
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, fault ? `sources-${fault}.json` : 'sources.json'), JSON.stringify(summary, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const f of failures) console.error(`FAIL ${f.name}${f.name === 'valley-unreferenced' ? ' ' + [...new Set(f.detail.map(r => r.file))].join(', ') : ''}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op generation sources: ${PLANNER} on disk (sha256 ${valleySha256}), unreferenced in ${summary.scannedFiles} files, script order ${scriptOrder.join(' < ')}`);
