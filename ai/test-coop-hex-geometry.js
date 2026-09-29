#!/usr/bin/env node
// Parity and region checks for ai/coop-hex-geometry.js against the shipped
// getHexagonalLayer (options/gamestart.js), evaluated in a vm sandbox.
// Usage: node ai/test-coop-hex-geometry.js [--output-dir DIR] [--fault shift-center|tweak-layer]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const geometry = require('./coop-hex-geometry');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
const FAULTS = ['shift-center', 'tweak-layer'];
if (fault !== undefined && !FAULTS.includes(fault)) { console.error(`unknown fault ${fault}`); process.exit(2); }

const MIN_RADIUS = 3, MAX_RADIUS = 49;

// The authored map table at the bottom of gamestart.js calls browser helpers at load
// time; stub each missing global with an inert callable until the script evaluates.
const inert = new Proxy(function () {}, {get: (target, key) => key === Symbol.toPrimitive ? () => 0 : inert,
    apply: () => inert, construct: () => inert});
// Class declarations persist in a context, so every retry starts a fresh one.
const gamestartSource = fs.readFileSync(path.join(root, 'options/gamestart.js'), 'utf8');
const stubbed = [];
let sandbox;
for (;;) {
    sandbox = {console};
    for (const name of stubbed) sandbox[name] = inert;
    vm.createContext(sandbox);
    try { vm.runInContext(gamestartSource, sandbox, {filename: 'options/gamestart.js'}); break; }
    catch (error) {
        const match = /^(\w+) is not defined$/.exec(error && error.message);
        if (!match || stubbed.includes(match[1]) || stubbed.length > 50) throw error;
        stubbed.push(match[1]);
    }
}
const shippedLayer = vm.runInContext('getHexagonalLayer', sandbox);
if (typeof shippedLayer !== 'function') throw new Error('getHexagonalLayer missing from options/gamestart.js');

const valleySource = fs.readFileSync(path.join(root, 'ai/coop-valley-plan.js'), 'utf8');
const latticeLine = valleySource.split('\n').find(line => line.startsWith('const valleyPortalLattice ='));
const shippedLattice = vm.runInNewContext(latticeLine.replace('const valleyPortalLattice =', '(') + ')');

// Fault injections replace the module under test, never the shipped reference.
const layer = fault === 'tweak-layer' ? (x, y, center) => {
    const q = x, r = y - Math.floor(x / 2), s = -q - r, centerS = -center.q - center.r;
    return Math.max(Math.abs(q - center.q), Math.abs(r - center.r), Math.abs(s - centerS));
} : geometry.coopHexLayer;
const centerOf = fault === 'shift-center' ? radius => ({q: radius, r: Math.floor(radius / 2)}) : geometry.coopHexCenter;

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };

let comparisons = 0, latticeComparisons = 0;
const rows = [];
for (let R = MIN_RADIUS; R <= MAX_RADIUS; R++) {
    const side = 2 * R + 1;
    const center = centerOf(R);
    // Canonical centre plus fractional centres, as the authored maps use.
    const parityCenters = [center, {q: center.q + 0.5, r: center.r}, {q: center.q, r: center.r - 0.5}];
    let parityMismatches = 0, cells = 0, maskCells = 0;
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        for (const c of parityCenters) {
            comparisons++;
            if (!Object.is(layer(x, y, c), shippedLayer(x, y, c))) parityMismatches++;
        }
        if (layer(x, y, center) <= R) cells++; else maskCells++;
        latticeComparisons++;
        assert('lattice-parity', geometry.coopHexLattice(x, y) === shippedLattice(x, y), {x, y});
    }
    // Every axial hex within distance R of the centre must land inside the grid.
    let outOfBounds = 0;
    for (let dq = -R; dq <= R; dq++) for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
        const x = center.q + dq, y = center.r + dr + Math.floor(x / 2);
        if (x < 0 || y < 0 || x >= side || y >= side) outOfBounds++;
    }
    const expectedCells = 3 * R * R + 3 * R + 1, expectedMask = R * R + R;
    rows.push({radius: R, side, cells, expectedCells, maskCells, expectedMask, outOfBounds, parityMismatches});
    assert('layer-parity', parityMismatches === 0, {radius: R, parityMismatches});
    assert('cell-count', cells === expectedCells, {radius: R, cells, expectedCells});
    assert('mask-count', maskCells === expectedMask, {radius: R, maskCells, expectedMask});
    assert('in-bounds', outOfBounds === 0, {radius: R, outOfBounds});
    if (!fault) {
        const listed = geometry.coopHexCells(R);
        assert('cells-list', listed.length === expectedCells && listed.every(({x, y}) => x >= 0 && y >= 0 && x < side && y < side && shippedLayer(x, y, center) <= R), {radius: R});
        const shape = geometry.coopHexMapShape(R);
        assert('map-shape', shape.type === 'hexagonal' && shape.radius === R && shape.center.q === R &&
            shape.center.r === Math.ceil(R / 2) && shape.offset.x === 0 && shape.offset.y === 0, {radius: R});
    }
}

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, stubbedGlobals: stubbed, radii: [MIN_RADIUS, MAX_RADIUS], parityComparisons: comparisons,
    latticeComparisons, failures: failures.length, failedAssertions: failedNames, firstFailures: failures.slice(0, 5),
    pass: failures.length === 0};
if (outputDir) {
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, fault ? `geometry-matrix-${fault}.json` : 'geometry-matrix.json'), JSON.stringify(rows, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op hex geometry radii=${MIN_RADIUS}..${MAX_RADIUS} parityComparisons=${comparisons} latticeComparisons=${latticeComparisons}`);
