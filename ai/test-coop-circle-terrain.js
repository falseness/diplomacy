#!/usr/bin/env node
// Terrain checks for placeCircleTerrain (ai/coop-circle-plan.js): mountain, lake
// and bush counts against 8/6/10 % of the 3R*R+3R+1 playable cells, no terrain
// outside the radius or on objects/reservations, one free component, every human
// town reaching every objective and nearest-objective spreads within 4.
// Layers, adjacency and paths are re-derived here with an axial-coordinate metric.
// Usage: node ai/test-coop-circle-terrain.js [--output-dir DIR] [--fault terrain-outside-radius|wall-off-portal]
'use strict';
const fs = require('fs'), path = require('path'), Module = require('module'), crypto = require('crypto');
const {withCircleTestAttempts} = require('./coop-circle-test-attempts');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Fault injections rewrite the planner source before it is loaded.
const FAULTS = {
    'terrain-outside-radius': [['for (let id = 0; id < area; id++) if (layers[id] > radius) forbidden[id] = 1', ''],
        ['const around = id => Array.from(adjacent.subarray(adjacentStart[id], adjacentStart[id + 1]))',
            'const around = id => circleNeighbours(cell(id), side).map(idOf)']],
    'wall-off-portal': [["    grow('bushes', 0.1)\n", "    for (const n of around(portalIds[0])) kind[n] = CIRCLE_TERRAIN_KINDS.mountains\n    grow('bushes', 0.1)\n"]]
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
const SHARES = {mountains: 0.08, lakes: 0.06, bushes: 0.10};
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

// Components of the free region (layer <= R minus terrain and objects) and objects cut off from it.
function components(R, solidCells, objects) {
    const side = 2 * R + 1, solid = new Set(solidCells.map(key)), seen = new Set();
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

// Path distances from one town: layer > R, mountains, lakes and every other human
// town are solid; objectives (mines, neutral towns, portals) are entered, never expanded.
function paths(R, origin, solid, endpoints) {
    const side = 2 * R + 1, distance = new Map([[key(origin), 0]]), queue = [origin];
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        if (i > 0 && endpoints.has(key(c))) continue;
        for (const n of neighbours(c, side)) {
            const k = key(n);
            if (distance.has(k) || layerAt(n, R) > R || solid.has(k)) continue;
            distance.set(k, distance.get(key(c)) + 1); queue.push(n);
        }
    }
    return distance;
}

// Production retry sequence: the first attempt seed whose stages all build wins.
const build = (humans, size, seed) => withCircleTestAttempts(seed, s => {
    const plan = planner.planCoopCircle(humans, size, s);
    const starts = planner.placeCircleStarts(plan, colorOf);
    const portals = planner.placeCirclePortals(plan, planner.placeCircleExpansions(plan, starts));
    return {plan, layout: portals, terrain: planner.placeCircleTerrain(plan, portals)};
});

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const matrix = [], reachability = [];
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
    const id = {size, humans, seed};
    let plan, result, attempt;
    try { ({plan, terrain: result, attempt} = build(humans, size, seed)); }
    catch (error) { assert('planner-throws', false, {...id, error: error.message}); continue; }
    const R = plan.radius, side = 2 * R + 1, playable = 3 * R * R + 3 * R + 1;
    const counts = {};
    for (const kind of Object.keys(SHARES)) {
        const placed = result[kind].length, target = Math.round(playable * SHARES[kind]);
        const deviationPoints = 100 * (placed - target) / playable;
        counts[kind] = {placed, target, plannerTarget: result.terrain[kind].target, deviationPoints};
        assert('target-matches-hexCounts', result.terrain[kind].target === target, {...id, kind, target, planner: result.terrain[kind].target});
        assert('count-within-2-points', Math.abs(placed - target) / playable <= 0.02, {...id, kind, placed, target, playable});
    }
    const terrainCells = [...result.mountains, ...result.lakes, ...result.bushes];
    const maxLayer = terrainCells.length ? Math.max(...terrainCells.map(c => layerAt(c, R))) : null;
    assert('terrain-inside-radius', terrainCells.every(c => layerAt(c, R) <= R && c.x >= 0 && c.y >= 0 && c.x < side && c.y < side),
        {...id, maxLayer, R});
    assert('terrain-cells-distinct', new Set(terrainCells.map(key)).size === terrainCells.length, id);
    assert('hills-empty', Array.isArray(result.hills) && result.hills.length === 0, id);
    // Overlaps with objects and reservations.
    const towns = result.players.slice(1).map(p => p.towns[0]), neutral = result.players[0].towns;
    const allTowns = [...towns, ...neutral], mines = result.goldmines, portals = result.portals;
    const approaches = result.portalApproaches.flatMap(a => a.cells);
    const townBoxes = allTowns.flatMap(t => [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => ({x: t.x + dx, y: t.y + dy}))));
    const terrainSet = new Set(terrainCells.map(key));
    const hits = list => list.filter(c => terrainSet.has(key(c))).length;
    const conflicts = {portals: hits(portals), approaches: hits(approaches), towns: hits(allTowns), mines: hits(mines),
        townReservations: hits(townBoxes), reserved: hits(result.reserved)};
    assert('terrain-off-objects', Object.values(conflicts).every(n => n === 0), {...id, conflicts});
    // Free region connectivity with mountains and lakes solid.
    const blocking = [...result.mountains, ...result.lakes], objects = [...allTowns, ...mines, ...portals];
    const conn = components(R, [...blocking, ...objects], objects);
    assert('free-region-connected', conn.components === 1 && conn.detachedObjects === 0, {...id, conn});
    // Reachability and nearest-objective spreads.
    const groups = {mines, neutralTowns: neutral, portals};
    const endpoints = new Set([...mines, ...neutral, ...portals].map(key));
    const nearest = {mines: [], neutralTowns: [], portals: []};
    let pairs = 0, unreached = 0;
    towns.forEach((t, i) => {
        const solid = new Set([...blocking, ...towns.filter((_, j) => j !== i)].map(key));
        const d = paths(R, t, solid, endpoints);
        for (const [name, list] of Object.entries(groups)) {
            const reached = list.filter(o => d.has(key(o)));
            pairs += list.length; unreached += list.length - reached.length;
            nearest[name].push(reached.length ? Math.min(...reached.map(o => d.get(key(o)))) : null);
        }
    });
    const spreads = Object.fromEntries(Object.entries(nearest).map(([name, list]) =>
        [name, !list.length || list.every(v => v === null) ? 0 : list.some(v => v === null) ? null : Math.max(...list) - Math.min(...list)]));
    assert('reachability', unreached === 0, {...id, pairs, unreached});
    assert('spread-within-4', Object.values(spreads).every(s => s !== null && s <= 4), {...id, spreads, nearest});
    matrix.push({size, humans, seed, attempt, radius: R, playable, counts, maxLayer, freeComponents: conn.components,
        detachedObjects: conn.detachedObjects, conflicts, nearest, spreads, maxSpread: Math.max(...Object.values(spreads))});
    reachability.push({size, humans, seed, radius: R, towns: towns.length, portals: portals.length, neutralTowns: neutral.length,
        goldmines: mines.length, pairsChecked: pairs, unreached, allReached: unreached === 0});
}
assert('matrix-complete', matrix.length === 36 * SEEDS.length, {rows: matrix.length});

// Determinism: same seed after clearing the memo cache gives byte-identical terrain;
// the next seed gives different terrain.
const determinism = [];
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
for (const [humans, size, seed] of [[1, 'tiny', 0], [6, 'tiny', 2], [2, 'normal', 0], [7, 'normal', 777], [4, 'big', 1], [12, 'big', 65535]]) {
    const run = s => { planner.clearCirclePlanCache(); const t = build(humans, size, s).terrain; return JSON.stringify([t.mountains, t.lakes, t.bushes]); };
    let first, second, other;
    try { first = run(seed); second = run(seed); other = run(seed + 1); }
    catch (error) { assert('determinism-throws', false, {humans, size, seed, error: error.message}); continue; }
    determinism.push({humans, size, seed, sha256First: hash(first), sha256Second: hash(second), identical: first === second,
        otherSeed: seed + 1, sha256OtherSeed: hash(other), differsFromOtherSeed: other !== first});
    assert('determinism', first === second, {humans, size, seed});
    assert('seed-varies', other !== first, {humans, size, seed});
}

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, cases: matrix.length, seeds: SEEDS, reachabilityCases: reachability.filter(r => r.allReached).length,
    determinismCases: determinism.length, failures: failures.length, failedAssertions: failedNames,
    firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, `terrain-matrix${suffix}.json`), JSON.stringify(matrix, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `reachability${suffix}.json`), JSON.stringify(reachability, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `determinism${suffix}.json`), JSON.stringify(determinism, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle terrain cases=${matrix.length} reachability=${summary.reachabilityCases} determinism=${determinism.length}`);
