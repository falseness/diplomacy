#!/usr/bin/env node
// Region and radius checks for ai/coop-circle-plan.js. Every region, capacity
// number and the accepted radius are re-derived here from coopHexLayer and
// coopHexLattice, never from the planner's own masks.
// Usage: node ai/test-coop-circle-regions.js [--output-dir DIR] [--fault shrink-radius|ignore-lattice]
'use strict';
const fs = require('fs'), path = require('path'), Module = require('module');
const {coopHexLayer, coopHexLattice} = require('./coop-hex-geometry');
const {baselineRadius, hexCounts} = require('./coop-map-scaling');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Fault injections rewrite the planner source before it is loaded.
const FAULTS = {
    'shrink-radius': ['    const plan = {baseline, radius,',
        '    radius--; capacity = circleCapacityAt(humans, size, radius)\n    const plan = {baseline, radius,'],
    'ignore-lattice': ['const lattice = circleGeometry.coopHexLattice(x, y)', 'const lattice = true']
};
if (fault !== undefined && !FAULTS[fault]) { console.error(`unknown fault ${fault}`); process.exit(2); }

const plannerPath = path.join(__dirname, 'coop-circle-plan.js');
let planner;
if (fault) {
    const [from, to] = FAULTS[fault];
    const source = fs.readFileSync(plannerPath, 'utf8');
    if (!source.includes(from)) throw new Error(`fault ${fault} anchor missing`);
    const faulted = new Module(plannerPath, module);
    faulted.filename = plannerPath;
    faulted.paths = Module._nodeModulePaths(__dirname);
    faulted._compile(source.split(from).join(to), plannerPath);
    planner = faulted.exports;
} else planner = require('./coop-circle-plan');

const SIZES = ['tiny', 'normal', 'big'], SEEDS = [0, 1, 31, 4294967295];
const TOWN_DISTANCE = {tiny: 3, normal: 4, big: 5}, MAX_GROWTH = 8;
// Independent per-human targets: neutral towns 1/2/3, gold mines 2/4/6.
const TOWNS_PER_HUMAN = {tiny: 1, normal: 2, big: 3}, MINES_PER_HUMAN = {tiny: 2, normal: 4, big: 6};

// Independent region bands and capacity at radius R.
function expectedAt(humans, size, R) {
    const center = {q: R, r: Math.ceil(R / 2)}, side = 2 * R + 1;
    // Elite core: R/6, grown to the first layer whose disc fits 4 lattice
    // portals per human and 12 cells per human (portal + 2 approach cells).
    let E = Math.floor(R / 6);
    for (let grown = false; !grown && E < R; ) {
        let total = 0, onLattice = 0;
        for (let x = 0; x < side; x++) for (let y = 0; y < side; y++)
            if (coopHexLayer(x, y, center) <= E) { total++; if (coopHexLattice(x, y)) onLattice++; }
        if (onLattice >= 4 * humans && total >= 12 * humans) grown = true; else E++;
    }
    const C = Math.floor(R / 2), T = R - 3, ringOuter = Math.min(C, T - TOWN_DISTANCE[size]);
    const cells = {elite: [], ring: [], townRing: [], other: [], outside: []};
    const lattice = {elite: 0, ring: 0, townRing: 0};
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const layer = coopHexLayer(x, y, center), onLattice = coopHexLattice(x, y);
        let region;
        if (layer > R) region = 'outside';
        else if (layer <= E) region = 'elite';
        else if (layer <= ringOuter) region = 'ring';
        else if (layer === T) region = 'townRing';
        else region = 'other';
        cells[region].push({x, y});
        if (onLattice && lattice[region] !== undefined) lattice[region]++;
    }
    const terrain = hexCounts(R);
    const playable = side * side - cells.outside.length, eliteCells = cells.elite.length;
    const neutralTowns = humans * TOWNS_PER_HUMAN[size], goldmines = humans * MINES_PER_HUMAN[size];
    const outsideNeed = 9 * (humans + neutralTowns) + goldmines + 3 * 11 * humans;
    const rows = {
        eliteLattice: {have: lattice.elite, need: 4 * humans},
        eliteApproach: {have: eliteCells - 4 * humans, need: 2 * 4 * humans},
        ringLattice: {have: lattice.ring, need: 7 * humans},
        townRingLattice: {have: lattice.townRing, need: humans},
        townRingGap: {have: T, need: E + 2},
        eliteDepth: {have: E, need: 1},
        outsideElite: {have: playable - eliteCells, need: outsideNeed},
        terrain: {have: playable - eliteCells - outsideNeed, need: terrain.mountains + terrain.lakes + terrain.bushes}
    };
    for (const row of Object.values(rows)) row.slack = row.have - row.need;
    return {regions: {elite: E, ringInner: E + 1, ringOuter, townRing: T}, cells, playable,
        rows, ok: Object.values(rows).every(row => row.slack >= 0)};
}

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const key = c => `${c.x},${c.y}`;
const sameCells = (a, b) => {
    const keys = new Set(a.map(key));
    return a.length === b.length && keys.size === a.length && b.every(c => keys.has(key(c)));
};
const REGION_CHARS = {elite: 'X', ring: 'o', townRing: 'T', other: '-', outside: '.'};

const matrix = [], grids = {}, growthHistogram = {};
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) {
    const baseline = baselineRadius(humans, size);
    let R = baseline;
    while (!expectedAt(humans, size, R).ok && R < baseline + MAX_GROWTH) R++;
    const expected = expectedAt(humans, size, R);
    assert('radius-feasible', expected.ok, {size, humans, R});
    let plans;
    try { plans = SEEDS.map(seed => planner.planCoopCircle(humans, size, seed)); }
    catch (error) { assert('planner-throws', false, {size, humans, error: error.message}); continue; }
    const plan = plans[0], accepted = plan.radius;
    const atAccepted = expectedAt(humans, size, accepted);
    assert('radius-minimal', accepted === R, {size, humans, expected: R, planned: accepted});
    assert('radius-at-least-baseline', accepted >= baseline, {size, humans, baseline, accepted});
    assert('predicate-holds-at-radius', atAccepted.ok, {size, humans, accepted});
    const failsBelow = accepted > baseline ? !expectedAt(humans, size, accepted - 1).ok : null;
    if (accepted > baseline) assert('predicate-fails-at-radius-minus-1', failsBelow, {size, humans, accepted});
    const growth = accepted - baseline;
    (growthHistogram[growth] = growthHistogram[growth] || []).push(`${size}-${humans}`);
    assert('capacity-rows', JSON.stringify(plan.capacity.rows) === JSON.stringify(atAccepted.rows), {size, humans});
    assert('capacity-growth', plan.capacity.baselineRadius === baseline && plan.capacity.growth === growth, {size, humans});
    assert('regions', JSON.stringify(plan.regions) === JSON.stringify(atAccepted.regions), {size, humans, planned: plan.regions});
    const side = 2 * accepted + 1;
    assert('shape', plan.side === side && plan.mapSize.x === side && plan.mapSize.y === side &&
        plan.center.q === accepted && plan.center.r === Math.ceil(accepted / 2) && plan.mapShape.type === 'hexagonal' &&
        plan.mapShape.radius === accepted && plan.mapShape.offset.x === 0 && plan.mapShape.offset.y === 0, {size, humans});
    assert('playable-count', atAccepted.playable === 3 * accepted * accepted + 3 * accepted + 1, {size, humans});
    for (const region of Object.keys(REGION_CHARS))
        assert(`mask-${region}`, sameCells(plan.masks[region], atAccepted.cells[region]), {size, humans});
    // Grid render: per-character counts and cell-for-cell placement.
    const charCounts = {};
    for (const line of plan.grid) for (const ch of line) charCounts[ch] = (charCounts[ch] || 0) + 1;
    assert('grid-dimensions', plan.grid.length === side && plan.grid.every(line => line.length === side), {size, humans});
    for (const [region, ch] of Object.entries(REGION_CHARS)) {
        assert('grid-char-count', (charCounts[ch] || 0) === atAccepted.cells[region].length,
            {size, humans, ch, grid: charCounts[ch] || 0, expected: atAccepted.cells[region].length});
        assert('grid-cells', atAccepted.cells[region].every(c => plan.grid[c.y][c.x] === ch), {size, humans, ch});
    }
    assert('grid-alphabet', Object.keys(charCounts).every(ch => Object.values(REGION_CHARS).includes(ch)), {size, humans});
    // Seeds only change the recorded seed at this stage.
    const strip = p => JSON.stringify({...p, seed: 0});
    assert('seed-regions', plans.every((p, i) => p.seed === SEEDS[i] && strip(p) === strip(plan)), {size, humans});
    assert('elite-categories', JSON.stringify(plan.eliteCategories) === JSON.stringify(planner.COOP_CIRCLE_ELITE_CATEGORIES), {size, humans});
    grids[`${size}-${humans}`] = plan.grid.join('\n') + '\n';
    matrix.push({size, humans, baselineRadius: baseline, radius: accepted, growth, failsAtRadiusMinus1: failsBelow,
        regions: atAccepted.regions, regionCells: Object.fromEntries(Object.keys(REGION_CHARS).map(r => [r, atAccepted.cells[r].length])),
        capacity: atAccepted.rows, minSlack: Math.min(...Object.values(atAccepted.rows).map(row => row.slack))});
}
assert('matrix-complete', matrix.length === 36, {rows: matrix.length});
assert('slack-non-negative', matrix.every(row => row.minSlack >= 0), {});

// Determinism: same inputs after clearing the memo cache give byte-identical JSON.
const determinism = [];
for (const [humans, size, seed] of [[1, 'tiny', 0], [3, 'tiny', 1], [5, 'tiny', 31], [8, 'tiny', 4294967295],
    [2, 'normal', 0], [7, 'normal', 31], [4, 'big', 1], [12, 'big', 4294967295], [11, 'tiny', 7]]) {
    let first, second;
    try {
        planner.clearCirclePlanCache(); first = JSON.stringify(planner.planCoopCircle(humans, size, seed));
        planner.clearCirclePlanCache(); second = JSON.stringify(planner.planCoopCircle(humans, size, seed));
    } catch (error) { assert('determinism-throws', false, {humans, size, seed, error: error.message}); continue; }
    const hash = s => require('crypto').createHash('sha256').update(s).digest('hex');
    determinism.push({humans, size, seed, bytes: first.length, sha256First: hash(first), sha256Second: hash(second), identical: first === second});
    assert('determinism', first === second, {humans, size, seed});
}

const growthSteps = Object.fromEntries(Object.entries(growthHistogram).map(([g, list]) => [g, {count: list.length, combinations: list}]));
const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, combinations: matrix.length, seeds: SEEDS, growthSteps: Object.fromEntries(
    Object.entries(growthSteps).map(([g, v]) => [g, v.count])), failures: failures.length, failedAssertions: failedNames,
    firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(path.join(outputDir, `grids${suffix}`), {recursive: true});
    fs.writeFileSync(path.join(outputDir, `regions-matrix${suffix}.json`),
        JSON.stringify({growthSteps, rows: matrix}, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `determinism${suffix}.json`), JSON.stringify(determinism, null, 1) + '\n');
    for (const [name, text] of Object.entries(grids)) fs.writeFileSync(path.join(outputDir, `grids${suffix}`, `${name}.txt`), text);
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle regions combinations=${matrix.length} seeds=${SEEDS.length} determinism=${determinism.length}`);
