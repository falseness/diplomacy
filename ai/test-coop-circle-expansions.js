#!/usr/bin/env node
// Neutral town and further mine checks for placeCircleExpansions (ai/coop-circle-plan.js).
// Layers, path distances, clearances and connectivity are re-derived here with an
// axial-coordinate hex metric and the test's own BFS, never the planner's helpers.
// Usage: node ai/test-coop-circle-expansions.js [--output-dir DIR] [--fault elite-mine|unfair-neutral]
'use strict';
const fs = require('fs'), path = require('path'), Module = require('module'), crypto = require('crypto');
const {coopHexLayer} = require('./coop-hex-geometry');
const {circleTestBands} = require('./coop-circle-test-bands');
const {getCoopMapScaling} = require('./coop-map-scaling');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Fault injections rewrite the planner source before it is loaded.
const FAULTS = {
    'elite-mine': [['if (layerOf(id) <= elite || layerOf(id) > radius || reserved.has(id)', 'if (layerOf(id) > elite || reserved.has(id)']],
    'unfair-neutral': [['const CIRCLE_ACCESS_DISPARITY = 4', 'const CIRCLE_ACCESS_DISPARITY = Infinity'],
        ['const tier = Math.max(CIRCLE_NEUTRAL_TARGET, spread(next))', 'const tier = -spread(next)']]
};
if (fault !== undefined && !FAULTS[fault]) { console.error(`unknown fault ${fault}`); process.exit(2); }

const plannerPath = path.join(__dirname, 'coop-circle-plan.js');
let planner;
if (fault) {
    let source = fs.readFileSync(plannerPath, 'utf8');
    for (const [from, to] of FAULTS[fault]) {
        if (!source.includes(from)) throw new Error(`fault ${fault} anchor missing: ${from}`);
        source = source.split(from).join(to);
    }
    const faulted = new Module(plannerPath, module);
    faulted.filename = plannerPath;
    faulted.paths = Module._nodeModulePaths(__dirname);
    faulted._compile(source, plannerPath);
    planner = faulted.exports;
} else planner = require('./coop-circle-plan');

const SIZES = ['tiny', 'normal', 'big'], SEEDS = [0, 1, 2, 31, 777, 65535, 2654435769, 4294967295];
const DISPARITY = 4;
const colorOf = i => ({r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256});

// Independent hex metric: offset column -> axial, cube distance to the centre cell (R, R).
const axial = c => ({q: c.x, r: c.y - Math.floor(c.x / 2)});
const hexDistance = (a, b) => {
    const A = axial(a), B = axial(b), dq = A.q - B.q, dr = A.r - B.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
const layerAt = (c, R) => hexDistance(c, {x: R, y: R});
const AXIAL_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const neighbours = (c, side) => AXIAL_DIRS.map(([dq, dr]) => {
    const q = c.x + dq, r = c.y - Math.floor(c.x / 2) + dr;
    return {x: q, y: r + Math.floor(q / 2)};
}).filter(n => n.x >= 0 && n.y >= 0 && n.x < side && n.y < side);
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const key = c => `${c.x},${c.y}`;
const box = c => [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({x: c.x + dx, y: c.y + dy})));

// Path distances from one human town: layer > R and other human towns are solid,
// neutral towns and mines are endpoints (reached but not walked through).
function pathField(R, from, solid, endpoints) {
    const side = 2 * R + 1, dist = new Map([[key(from), 0]]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        if (i > 0 && endpoints.has(key(c))) continue;
        for (const n of neighbours(c, side)) {
            const k = key(n);
            if (dist.has(k) || layerAt(n, R) > R || solid.has(k)) continue;
            dist.set(k, dist.get(key(c)) + 1); queue.push(n);
        }
    }
    return dist;
}

// Components of the free region (layer <= R minus every object) and objects cut off from it.
function components(R, objects) {
    const side = 2 * R + 1, solid = new Set(objects.map(key)), seen = new Set();
    const free = c => layerAt(c, R) <= R && !solid.has(key(c));
    let count = 0, cells = 0;
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const c = {x, y};
        if (!free(c)) continue;
        cells++;
        if (seen.has(key(c))) continue;
        count++;
        const queue = [c]; seen.add(key(c));
        for (let i = 0; i < queue.length; i++) for (const n of neighbours(queue[i], side))
            if (!seen.has(key(n)) && free(n)) { seen.add(key(n)); queue.push(n); }
    }
    const detached = objects.filter(o => !neighbours(o, side).some(n => seen.has(key(n)))).length;
    return {freeCells: cells, components: count, detachedObjects: detached};
}

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const matrix = [], fairness = [];
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
    const id = {size, humans, seed};
    let plan, starts, layout;
    try {
        plan = planner.planCoopCircle(humans, size, seed);
        starts = planner.placeCircleStarts(plan, colorOf);
        layout = planner.placeCircleExpansions(plan, starts);
    } catch (error) { assert('planner-throws', false, {...id, error: error.message}); continue; }
    const R = plan.radius, E = circleTestBands(R, humans, size).E, side = 2 * R + 1, center = {q: R, r: Math.ceil(R / 2)};
    const target = getCoopMapScaling(humans, size).counts;
    const towns = layout.players.slice(1).map(p => p.towns[0]), neutral = layout.players[0].towns;
    const startMines = starts.goldmines, further = layout.goldmines.slice(humans);
    assert('starts-preserved', JSON.stringify(layout.goldmines.slice(0, humans)) === JSON.stringify(startMines)
        && JSON.stringify(towns) === JSON.stringify(starts.players.slice(1).map(p => p.towns[0])), id);
    assert('neutral-count', neutral.length === target.neutralTowns, {...id, placed: neutral.length, target: target.neutralTowns});
    assert('goldmine-count', layout.goldmines.length === target.goldmines, {...id, placed: layout.goldmines.length, target: target.goldmines});
    assert('further-mine-owner', further.every(m => m.owner === 0 && m.income === 20), id);
    const expansion = [...neutral, ...further];
    const layers = expansion.map(o => layerAt(o, R));
    const coopLayers = expansion.map(o => coopHexLayer(o.x, o.y, center));
    const minLayer = layers.length ? Math.min(...layers) : null;
    assert('layer-agrees', JSON.stringify(layers) === JSON.stringify(coopLayers), id);
    assert('outside-elite', layers.every(l => l > E && l <= R), {...id, minLayer, E});
    // Clearances: nothing on a human town, starting mine or reserved cell; every
    // neutral 3x3 inside the radius and clear of every other object and reservation;
    // no further mine inside any town's 3x3.
    const startReserved = new Set(starts.reserved.map(key));
    const taken = new Set([...towns, ...startMines].map(key));
    const onOccupied = expansion.filter(o => taken.has(key(o)) || startReserved.has(key(o))).length;
    const allObjects = [...towns, ...neutral, ...layout.goldmines];
    let neutralBoxViolations = 0;
    neutral.forEach((t, i) => {
        const cells = box(t);
        if (cells.some(c => c.x < 0 || c.y < 0 || c.x >= side || c.y >= side || layerAt(c, R) > R)) neutralBoxViolations++;
        else if (cells.some(c => startReserved.has(key(c)))) neutralBoxViolations++;
        else if (allObjects.some(o => o !== t && chebyshev(o, t) <= 1)) neutralBoxViolations++;
        else if (neutral.some((u, j) => j !== i && chebyshev(u, t) <= 2)) neutralBoxViolations++;
    });
    const mineInTownBox = further.filter(m => [...towns, ...neutral].some(t => chebyshev(t, m) <= 1)).length;
    const duplicates = allObjects.length - new Set(allObjects.map(key)).size;
    assert('no-occupied-cell', onOccupied === 0 && duplicates === 0, {...id, onOccupied, duplicates});
    assert('neutral-clearance', neutralBoxViolations === 0, {...id, neutralBoxViolations});
    assert('mine-clearance', mineInTownBox === 0, {...id, mineInTownBox});
    const reservedKeys = new Set(layout.reserved.map(key));
    assert('reservation-covers', neutral.every(t => box(t).every(c => reservedKeys.has(key(c)))) && [...startReserved].every(k => reservedKeys.has(k)), id);
    // Paths: nearest neutral town per human and its spread; mine fairness.
    const endpoints = new Set([...neutral, ...layout.goldmines].map(key));
    const fields = towns.map((t, i) => pathField(R, t, new Set(towns.filter((_, j) => j !== i).map(key)), endpoints));
    const nearest = fields.map(f => Math.min(...neutral.map(t => f.has(key(t)) ? f.get(key(t)) : Infinity)));
    const spread = nearest.length ? Math.max(...nearest) - Math.min(...nearest) : null;
    assert('neutral-reachable', nearest.every(Number.isFinite), {...id, nearest});
    assert('neutral-spread', spread !== null && spread <= DISPARITY, {...id, nearest, spread});
    const own = towns.map((_, i) => fields[i].get(key(startMines.find(m => m.owner === i + 1))));
    const mineRows = further.map(m => ({x: m.x, y: m.y, layer: layerAt(m, R),
        distances: fields.map(f => f.has(key(m)) ? f.get(key(m)) : null)}));
    const unfair = mineRows.filter(m => m.distances.some((d, i) => d === null || !(d > own[i]))).length;
    assert('mine-fairness', unfair === 0 && own.every(Number.isFinite), {...id, own, unfair});
    if (further.length) fairness.push({size, humans, seed, radius: R, ownStartingMineDistance: own, furtherMines: mineRows,
        unfairMines: unfair, allStrictlyFarther: unfair === 0});
    const conn = components(R, allObjects);
    assert('connectivity', conn.components === 1 && conn.detachedObjects === 0, {...id, conn});
    matrix.push({size, humans, seed, radius: R, eliteLayer: E,
        neutralTowns: {placed: neutral.length, target: target.neutralTowns},
        goldmines: {placed: layout.goldmines.length, target: target.goldmines, starting: humans, further: further.length},
        minExpansionLayer: minLayer, nearestNeutralDistance: nearest, neutralSpread: spread,
        freeRegion: conn, clearance: {onOccupiedOrReserved: onOccupied, duplicates, neutralBoxViolations, mineInTownBox},
        neutral, furtherMines: further.map(m => ({x: m.x, y: m.y}))});
}
assert('matrix-complete', matrix.length === 36 * SEEDS.length, {rows: matrix.length});

// Determinism: same seed after clearing the memo cache gives byte-identical layouts.
const determinism = [];
for (const [humans, size, seed] of [[1, 'tiny', 0], [5, 'tiny', 31], [2, 'normal', 0], [7, 'normal', 777], [4, 'big', 1], [12, 'big', 65535]]) {
    const run = () => {
        planner.clearCirclePlanCache();
        const plan = planner.planCoopCircle(humans, size, seed);
        return JSON.stringify(planner.placeCircleExpansions(plan, planner.placeCircleStarts(plan, colorOf)));
    };
    let first, second;
    try { first = run(); second = run(); }
    catch (error) { assert('determinism-throws', false, {humans, size, seed, error: error.message}); continue; }
    const hash = s => crypto.createHash('sha256').update(s).digest('hex');
    determinism.push({humans, size, seed, sha256First: hash(first), sha256Second: hash(second), identical: first === second});
    assert('determinism', first === second, {humans, size, seed});
}

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, cases: matrix.length, seeds: SEEDS, fairnessCases: fairness.length,
    determinismCases: determinism.length, failures: failures.length, failedAssertions: failedNames,
    firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, `expansions-matrix${suffix}.json`), JSON.stringify(matrix, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `mine-fairness${suffix}.json`), JSON.stringify(fairness, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `determinism${suffix}.json`), JSON.stringify(determinism, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle expansions cases=${matrix.length} fairness=${fairness.length} determinism=${determinism.length}`);
