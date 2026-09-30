#!/usr/bin/env node
// Starting town and mine checks for placeCircleStarts (ai/coop-circle-plan.js).
// Layers, ring order, reservations and connectivity are re-derived here with an
// axial-coordinate hex metric and the test's own BFS, never the planner's helpers.
// Usage: node ai/test-coop-circle-starts.js [--output-dir DIR] [--fault off-ring|collide-towns]
'use strict';
const fs = require('fs'), path = require('path'), Module = require('module'), crypto = require('crypto');
const {coopHexLayer} = require('./coop-hex-geometry');
const {circleTestBands} = require('./coop-circle-test-bands');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Fault injections rewrite the planner source before it is loaded.
const FAULTS = {
    'off-ring': [['circleRingOrder(plan, plan.regions.townRing)', 'circleRingOrder(plan, plan.regions.townRing - 1)']],
    'collide-towns': [['circleHexDistance(t, ring[j]) >= CIRCLE_START_SPACING', 'circleHexDistance(t, ring[j]) >= 0']]
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

// Ring cells in walk order: start at the smallest cell and keep stepping to an unvisited ring neighbour.
function ringWalk(R, layer) {
    const side = 2 * R + 1, on = new Set(), cells = [];
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) if (layerAt({x, y}, R) === layer) { on.add(key({x, y})); cells.push({x, y}); }
    const order = [cells[0]], seen = new Set([key(cells[0])]);
    for (;;) {
        const next = neighbours(order[order.length - 1], side).find(n => on.has(key(n)) && !seen.has(key(n)));
        if (!next) break;
        order.push(next); seen.add(key(next));
    }
    return {order, complete: order.length === cells.length && hexDistance(order[0], order[order.length - 1]) === 1};
}

// Free cells = layer <= R minus towns and mines; one component, and every town and mine touches it.
function connectivity(R, towns, mines) {
    const side = 2 * R + 1, solid = new Set([...towns, ...mines].map(key));
    const free = c => layerAt(c, R) <= R && !solid.has(key(c));
    let open = 0, first = null;
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) if (free({x, y})) { open++; if (!first) first = {x, y}; }
    const seen = new Set([key(first)]), queue = [first];
    for (let i = 0; i < queue.length; i++) for (const n of neighbours(queue[i], side))
        if (!seen.has(key(n)) && free(n)) { seen.add(key(n)); queue.push(n); }
    const detached = [...towns, ...mines].filter(o => !neighbours(o, side).some(n => seen.has(key(n))));
    return {freeCells: open, reached: queue.length, components: queue.length === open ? 1 : 2, detachedObjects: detached.length,
        connected: queue.length === open && detached.length === 0};
}

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const matrix = [], connectivityRows = [];
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
    const id = {size, humans, seed};
    let plan, layout;
    try { plan = planner.planCoopCircle(humans, size, seed); layout = planner.placeCircleStarts(plan, colorOf); }
    catch (error) { assert('planner-throws', false, {...id, error: error.message}); continue; }
    const R = plan.radius, E = circleTestBands(R, humans, size).E, side = 2 * R + 1, center = {q: R, r: Math.ceil(R / 2)};
    const humansList = layout.players.slice(1), towns = humansList.map(p => p.towns[0]);
    assert('town-count', humansList.length === humans && humansList.every(p => p.towns.length === 1), id);
    const townLayers = towns.map(t => layerAt(t, R));
    const townLayersCoop = towns.map(t => coopHexLayer(t.x, t.y, center));
    assert('town-layer', townLayers.every(l => l === R - 3) && townLayersCoop.every(l => l === R - 3), {...id, townLayers});
    let minChebyshev = null;
    for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) {
        const d = chebyshev(towns[i], towns[j]);
        if (minChebyshev === null || d < minChebyshev) minChebyshev = d;
    }
    assert('town-chebyshev', minChebyshev === null || minChebyshev >= 3, {...id, minChebyshev});
    let minHex = null;
    for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) {
        const d = hexDistance(towns[i], towns[j]);
        if (minHex === null || d < minHex) minHex = d;
    }
    assert('town-hex-distance', minHex === null || minHex >= 5, {...id, minHex});
    // Angular gaps along the test's own ring walk.
    const walk = ringWalk(R, R - 3), index = new Map(walk.order.map((c, i) => [key(c), i]));
    assert('ring-walk', walk.complete && walk.order.length === 6 * (R - 3), {...id, walked: walk.order.length});
    const positions = towns.map(t => index.get(key(t))).filter(i => i !== undefined).sort((a, b) => a - b);
    const gaps = positions.map((p, i) => i + 1 < positions.length ? positions[i + 1] - p : positions[0] + walk.order.length - p);
    const gapSpread = gaps.length === towns.length ? Math.max(...gaps) - Math.min(...gaps) : null;
    assert('towns-on-walk', positions.length === towns.length, {...id, positions});
    // Mines: one per human, owned, income 20, layer > E, not on a town or reservation.
    const mines = layout.goldmines, mineLayers = mines.map(m => layerAt(m, R));
    const ownedBy = humansList.map(p => mines.filter(m => m.owner === p.slot).length);
    assert('one-mine-per-human', mines.length === humans && ownedBy.every(n => n === 1), {...id, ownedBy});
    assert('mine-income', mines.every(m => m.income === 20), id);
    assert('mine-layer', mineLayers.every(l => l > E && l <= R), {...id, mineLayers, E});
    // Reservations: the 3x3 of every town, pairwise disjoint, inside the radius.
    const boxes = towns.map(t => [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => key({x: t.x + dx, y: t.y + dy}))));
    const union = new Set(boxes.flat());
    const disjoint = union.size === 9 * towns.length;
    const reservedKeys = new Set(layout.reserved.map(key));
    assert('reservation-disjoint', disjoint, id);
    assert('reservation-matches', reservedKeys.size === union.size && [...union].every(k => reservedKeys.has(k)), id);
    const reservedOutside = layout.reserved.filter(c => c.x < 0 || c.y < 0 || c.x >= side || c.y >= side || layerAt(c, R) > R).length;
    assert('reservation-inside', reservedOutside === 0, {...id, reservedOutside});
    assert('mine-free-cell', mines.every(m => !reservedKeys.has(key(m))), id);
    assert('colors', humansList.every(p => JSON.stringify(p.rgb) === JSON.stringify(colorOf(p.slot))), id);
    const conn = connectivity(R, towns, mines);
    assert('connectivity', conn.connected, {...id, conn});
    connectivityRows.push({size, humans, seed, radius: R, solidOutsideRadius: side * side - (3 * R * R + 3 * R + 1), ...conn});
    matrix.push({size, humans, seed, radius: R, eliteLayer: E, townRing: R - 3, ringCells: walk.order.length,
        towns, townLayers, minChebyshev, minHex, gaps, gapSpread,
        mines: mines.map((m, i) => ({x: m.x, y: m.y, owner: m.owner, income: m.income, layer: mineLayers[i]})),
        minesPerHuman: ownedBy, reservationsDisjoint: disjoint, reservedCells: layout.reserved.length, reservedOutsideRadius: reservedOutside});
}
assert('matrix-complete', matrix.length === 36 * SEEDS.length, {rows: matrix.length});

// Determinism: same seed after clearing the memo cache gives byte-identical layouts.
const determinism = [];
for (const [humans, size, seed] of [[1, 'tiny', 0], [3, 'tiny', 1], [5, 'tiny', 31], [12, 'tiny', 4294967295],
    [2, 'normal', 0], [7, 'normal', 777], [4, 'big', 1], [12, 'big', 65535], [9, 'normal', 2654435769]]) {
    let first, second;
    try {
        planner.clearCirclePlanCache(); first = JSON.stringify(planner.placeCircleStarts(planner.planCoopCircle(humans, size, seed), colorOf));
        planner.clearCirclePlanCache(); second = JSON.stringify(planner.placeCircleStarts(planner.planCoopCircle(humans, size, seed), colorOf));
    } catch (error) { assert('determinism-throws', false, {humans, size, seed, error: error.message}); continue; }
    const hash = s => crypto.createHash('sha256').update(s).digest('hex');
    determinism.push({humans, size, seed, bytes: first.length, sha256First: hash(first), sha256Second: hash(second), identical: first === second});
    assert('determinism', first === second, {humans, size, seed});
}

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, cases: matrix.length, seeds: SEEDS, connectivityCases: connectivityRows.length,
    determinismCases: determinism.length, failures: failures.length, failedAssertions: failedNames,
    firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, `starts-matrix${suffix}.json`), JSON.stringify(matrix, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `connectivity${suffix}.json`), JSON.stringify(connectivityRows, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `determinism${suffix}.json`), JSON.stringify(determinism, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle starts cases=${matrix.length} connectivity=${connectivityRows.length} determinism=${determinism.length}`);
