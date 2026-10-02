#!/usr/bin/env node
// Ring portal group checks for placeCirclePortals (ai/coop-circle-plan.js): per
// human one trio [support, melee, ranged] and two pairs [melee, ranged], members
// pairwise at hex distance 1-2, groups at hex distance >= 3. Groups are re-derived
// by clustering ring portals at hex distance <= 2 with an axial-coordinate metric,
// then compared with the planner's portalGroups.
// Usage: node ai/test-coop-circle-portal-groups.js [--output-dir DIR] [--fault split-trio]
'use strict';
const fs = require('fs'), path = require('path'), Module = require('module');
const {circleTestBands} = require('./coop-circle-test-bands');
const {withCircleTestAttempts} = require('./coop-circle-test-attempts');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Fault injections rewrite the planner source before it is loaded.
const FAULTS = {
    // The support portal becomes its own group, placed from the normal candidate order.
    'split-trio': [["Object.freeze({kind: 'trio', categories: Object.freeze(['support', 'melee', 'ranged'])}),",
        "Object.freeze({kind: 'trio', categories: Object.freeze(['melee', 'ranged'])}), Object.freeze({kind: 'pair', categories: Object.freeze(['support'])}),"]]
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
const ELITE = ['chaos', 'heavy', 'siege', 'mage'];
const TRIO = 'melee,ranged,support', PAIR = 'melee,ranged';
const colorOf = i => ({r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256});

// Independent hex metric: offset column -> axial, cube distance.
const axial = c => ({q: c.x, r: c.y - Math.floor(c.x / 2)});
const hexDistance = (a, b) => {
    const A = axial(a), B = axial(b), dq = A.q - B.q, dr = A.r - B.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
const layerAt = (c, R) => hexDistance(c, {x: R, y: R});

// Connected components of the "hex distance <= 2" graph over the given portal indices.
function clusters(portals, indices) {
    const parent = new Map(indices.map(i => [i, i]));
    const find = i => parent.get(i) === i ? i : find(parent.get(i));
    for (const i of indices) for (const j of indices) if (j > i && hexDistance(portals[i], portals[j]) <= 2)
        parent.set(find(i), find(j));
    const byRoot = new Map();
    for (const i of indices) {
        const root = find(i);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(i);
    }
    return [...byRoot.values()];
}

const build = (humans, size, seed) => withCircleTestAttempts(seed, s => {
    const plan = planner.planCoopCircle(humans, size, s);
    const layout = planner.placeCircleExpansions(plan, planner.placeCircleStarts(plan, colorOf));
    return {plan, layout, portals: planner.placeCirclePortals(plan, layout)};
});

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const matrix = [];
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
    const id = {size, humans, seed};
    let plan, result, attempt;
    try { ({plan, portals: result, attempt} = build(humans, size, seed)); }
    catch (error) { assert('planner-throws', false, {...id, error: error.message}); continue; }
    const R = plan.radius, {E, ringOuter} = circleTestBands(R, humans, size);
    const portals = result.portals;
    const ring = portals.map((p, i) => i).filter(i => !ELITE.includes(portals[i].category));
    const elite = portals.map((p, i) => i).filter(i => ELITE.includes(portals[i].category));
    assert('ring-in-band', ring.every(i => layerAt(portals[i], R) > E && layerAt(portals[i], R) <= ringOuter), id);
    // Groups from geometry alone.
    const found = clusters(portals, ring);
    const multiset = g => g.map(i => portals[i].category).sort().join();
    const shapes = found.map(multiset);
    const trios = shapes.filter(s => s === TRIO).length, pairs = shapes.filter(s => s === PAIR).length;
    assert('group-count', found.length === 3 * humans, {...id, groups: found.length, expected: 3 * humans});
    assert('group-categories', trios === humans && pairs === 2 * humans && trios + pairs === found.length,
        {...id, trios, pairs, shapes: shapes.filter(s => s !== TRIO && s !== PAIR)});
    let maxIntra = 0, minIntra = Infinity;
    for (const g of found) for (const i of g) for (const j of g) if (j > i) {
        const d = hexDistance(portals[i], portals[j]);
        maxIntra = Math.max(maxIntra, d); minIntra = Math.min(minIntra, d);
    }
    assert('intra-group-distance', found.every(g => g.length < 2) || (minIntra >= 1 && maxIntra <= 2), {...id, minIntra, maxIntra});
    let minInter = Infinity;
    found.forEach((g, a) => found.forEach((h, b) => {
        if (b > a) for (const i of g) for (const j of h) minInter = Math.min(minInter, hexDistance(portals[i], portals[j]));
    }));
    assert('inter-group-distance', minInter >= 3, {...id, minInter});
    // The planner's portalGroups: same partition, one trio and two pairs per slot, no elite member.
    const declared = Array.isArray(result.portalGroups) ? result.portalGroups : [];
    const members = declared.flatMap(g => g.members);
    assert('portal-groups-present', declared.length === 3 * humans, {...id, declared: declared.length});
    assert('ring-in-one-group', ring.every(i => members.filter(m => m === i).length === 1) && members.length === ring.length,
        {...id, members: members.length, ring: ring.length});
    assert('elite-not-grouped', elite.every(i => !members.includes(i)), id);
    const partition = list => list.map(g => g.slice().sort((a, b) => a - b).join()).sort().join('|');
    assert('groups-match-clusters', partition(declared.map(g => g.members)) === partition(found), id);
    const perSlot = Array.from({length: humans}, (_, s) => declared.filter(g => g.slot === s + 1));
    assert('groups-per-human', perSlot.every(list => list.length === 3 && list.filter(g => g.kind === 'trio').length === 1
        && list.filter(g => g.kind === 'pair').length === 2), id);
    assert('declared-kinds', declared.every(g => multiset(g.members) === (g.kind === 'trio' ? TRIO : PAIR)), id);
    matrix.push({size, humans, seed, attempt, radius: R, eliteLayer: E, ringOuter, ringPortals: ring.length,
        elitePortals: elite.length, groups: found.length, trios, pairs,
        maxIntraGroupDistance: Number.isFinite(minIntra) ? maxIntra : null,
        minIntraGroupDistance: Number.isFinite(minIntra) ? minIntra : null,
        minInterGroupDistance: Number.isFinite(minInter) ? minInter : null,
        portalGroups: declared.map(g => ({slot: g.slot, kind: g.kind,
            members: g.members.map(i => ({x: portals[i].x, y: portals[i].y, category: portals[i].category}))}))});
}
assert('matrix-complete', matrix.length === 36 * SEEDS.length, {rows: matrix.length});

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, cases: matrix.length, seeds: SEEDS, failures: failures.length,
    failedAssertions: failedNames, firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, `groups-matrix${suffix}.json`), JSON.stringify(matrix, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle portal groups cases=${matrix.length}`);
