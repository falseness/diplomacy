#!/usr/bin/env node
// Portal checks for placeCirclePortals (ai/coop-circle-plan.js): elite categories
// in the core (layer <= floor(R/4)), common categories in the ring, town distance,
// non-adjacency, approach cells, category counts, connectivity and determinism.
// Layers and hex distances are re-derived here with an axial-coordinate metric.
// Usage: node ai/test-coop-circle-portals.js [--output-dir DIR] [--fault elite-melee|adjacent-portals]
'use strict';
const fs = require('fs'), path = require('path'), Module = require('module'), crypto = require('crypto');
const {coopHexLayer} = require('./coop-hex-geometry');
const {getCoopMapScaling} = require('./coop-map-scaling');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Fault injections rewrite the planner source before it is loaded.
const FAULTS = {
    'elite-melee': [["sequence: deal(COOP_CIRCLE_ELITE_CATEGORIES)}", "sequence: ['melee', ...deal(COOP_CIRCLE_ELITE_CATEGORIES)]}"],
        ["sequence: deal(COOP_CIRCLE_RING_CATEGORIES)}", "sequence: deal(COOP_CIRCLE_RING_CATEGORIES).slice(1)}"]],
    'adjacent-portals': [['if (portalSet.has(id) || around(id).some(n => portalSet.has(n))) continue', 'if (portalSet.has(id)) continue'],
        ['const candidates = [...shuffle(lattice), ...shuffle(rest)]', 'const candidates = [...shuffle(rest), ...shuffle(lattice)]']]
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
const TOWN_DISTANCE = {tiny: 3, normal: 4, big: 5};
const ELITE = ['chaos', 'heavy', 'siege', 'mage'], RING = ['melee', 'ranged', 'support'];
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
const key = c => `${c.x},${c.y}`;

// Components of the free region (layer <= R minus every object) and objects cut off from it.
function components(R, objects) {
    const side = 2 * R + 1, solid = new Set(objects.map(key)), seen = new Set();
    const free = c => layerAt(c, R) <= R && !solid.has(key(c));
    let count = 0;
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const c = {x, y};
        if (!free(c) || seen.has(key(c))) continue;
        count++;
        const queue = [c]; seen.add(key(c));
        for (let i = 0; i < queue.length; i++) for (const n of neighbours(queue[i], side))
            if (!seen.has(key(n)) && free(n)) { seen.add(key(n)); queue.push(n); }
    }
    const detached = objects.filter(o => !neighbours(o, side).some(n => seen.has(key(n)))).length;
    return {components: count, detachedObjects: detached};
}

const build = (humans, size, seed) => {
    const plan = planner.planCoopCircle(humans, size, seed);
    const layout = planner.placeCircleExpansions(plan, planner.placeCircleStarts(plan, colorOf));
    return {plan, layout, portals: planner.placeCirclePortals(plan, layout)};
};

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const matrix = [], approachRows = [];
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
    const id = {size, humans, seed};
    let plan, layout, result;
    try { ({plan, layout, portals: result} = build(humans, size, seed)); }
    catch (error) { assert('planner-throws', false, {...id, error: error.message}); continue; }
    const R = plan.radius, E = Math.floor(R / 4), D = TOWN_DISTANCE[size], side = 2 * R + 1;
    const ringOuter = Math.min(Math.floor(3 * R / 4), (R - 3) - D), center = {q: R, r: Math.ceil(R / 2)};
    const target = getCoopMapScaling(humans, size).counts.portalCategories;
    const portals = result.portals;
    assert('layer-agrees', portals.every(p => layerAt(p, R) === coopHexLayer(p.x, p.y, center)), id);
    const table = {};
    for (const category of [...ELITE, ...RING]) {
        const layers = portals.filter(p => p.category === category).map(p => layerAt(p, R));
        table[category] = {count: layers.length, target: target[category],
            minLayer: layers.length ? Math.min(...layers) : null, maxLayer: layers.length ? Math.max(...layers) : null};
        assert('category-count', layers.length === target[category], {...id, category, count: layers.length, target: target[category]});
        if (ELITE.includes(category)) assert('elite-in-core', layers.every(l => l <= E), {...id, category, table: table[category], E});
        else assert('common-in-ring', layers.every(l => l > E && l <= ringOuter), {...id, category, table: table[category], E, ringOuter});
    }
    assert('portal-total', portals.length === Object.values(target).reduce((a, b) => a + b, 0), {...id, placed: portals.length});
    const towns = layout.players.slice(1).map(p => p.towns[0]);
    const minTownDistance = Math.min(...portals.flatMap(p => towns.map(t => hexDistance(p, t))));
    let minPortalDistance = Infinity;
    portals.forEach((p, i) => portals.forEach((q, j) => { if (j > i) minPortalDistance = Math.min(minPortalDistance, hexDistance(p, q)); }));
    if (!Number.isFinite(minPortalDistance)) minPortalDistance = null;
    assert('town-distance', minTownDistance >= D, {...id, minTownDistance, D});
    assert('portals-not-adjacent', minPortalDistance === null || minPortalDistance >= 2, {...id, minPortalDistance});
    // Approach cells: free = inside the radius and not a portal, town, mine or pre-portal reservation.
    const blocked = new Set([...portals, ...layout.players.flatMap(p => p.towns), ...layout.goldmines, ...layout.reserved].map(key));
    const onBlocked = portals.filter(p => [...layout.players.flatMap(t => t.towns), ...layout.goldmines, ...layout.reserved]
        .some(o => o.x === p.x && o.y === p.y)).length;
    assert('portal-on-free-cell', onBlocked === 0, {...id, onBlocked});
    const freeAdjacent = portals.map(p => neighbours(p, side).filter(n => layerAt(n, R) <= R && !blocked.has(key(n))).length);
    assert('two-free-approaches', freeAdjacent.every(n => n >= 2), {...id, freeAdjacent});
    const recorded = result.portalApproaches.flatMap(a => a.cells.map(key));
    const approachesValid = result.portalApproaches.length === portals.length && result.portalApproaches.every((a, i) =>
        key(a.portal) === key(portals[i]) && a.cells.length === 2 && a.cells.every(c =>
            hexDistance(c, portals[i]) === 1 && layerAt(c, R) <= R && !blocked.has(key(c)))) && new Set(recorded).size === recorded.length;
    assert('recorded-approaches', approachesValid, id);
    const conn = components(R, [...layout.players.flatMap(p => p.towns), ...layout.goldmines, ...portals]);
    assert('connectivity', conn.components === 1 && conn.detachedObjects === 0, {...id, conn});
    matrix.push({size, humans, seed, radius: R, eliteLayer: E, ringOuter, townDistance: D,
        categories: table, minTownDistance, minPortalDistance, freeRegion: conn,
        portals: portals.map(p => ({x: p.x, y: p.y, category: p.category}))});
    approachRows.push({size, humans, seed, portals: portals.length, minFreeAdjacent: Math.min(...freeAdjacent),
        allAtLeastTwo: freeAdjacent.every(n => n >= 2), recordedApproachesValid: approachesValid, freeAdjacent});
}
assert('matrix-complete', matrix.length === 36 * SEEDS.length, {rows: matrix.length});

// Determinism: same seed after clearing the memo cache gives byte-identical portal
// lists; the next seed gives a different list.
const determinism = [];
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
for (const [humans, size, seed] of [[1, 'tiny', 0], [3, 'tiny', 31], [6, 'tiny', 2], [2, 'normal', 0], [7, 'normal', 777],
    [10, 'normal', 1], [4, 'big', 1], [12, 'big', 65535]]) {
    const run = s => { planner.clearCirclePlanCache(); return JSON.stringify(build(humans, size, s).portals.portals); };
    let first, second, other;
    try { first = run(seed); second = run(seed); other = run(seed + 1); }
    catch (error) { assert('determinism-throws', false, {humans, size, seed, error: error.message}); continue; }
    determinism.push({humans, size, seed, sha256First: hash(first), sha256Second: hash(second), identical: first === second,
        otherSeed: seed + 1, sha256OtherSeed: hash(other), differsFromOtherSeed: other !== first});
    assert('determinism', first === second, {humans, size, seed});
    assert('seed-varies', other !== first, {humans, size, seed});
}

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, cases: matrix.length, seeds: SEEDS, approachCases: approachRows.length,
    determinismCases: determinism.length, failures: failures.length, failedAssertions: failedNames,
    firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, `portals-matrix${suffix}.json`), JSON.stringify(matrix, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `approaches${suffix}.json`), JSON.stringify(approachRows, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `determinism${suffix}.json`), JSON.stringify(determinism, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle portals cases=${matrix.length} approaches=${approachRows.length} determinism=${determinism.length}`);
