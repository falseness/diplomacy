#!/usr/bin/env node
// Per-player neutral town checks for placeCircleExpansions (ai/coop-circle-plan.js).
// Kinds, bands, hex distances, ownership, clearances and connectivity are re-derived
// here with an axial-coordinate hex metric and the test's own BFS, never the planner's helpers.
// Usage: node ai/test-coop-circle-neutrals.js [--output-dir DIR] [--fault far-gap|elite-on-normal|near-far]
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
    'far-gap': [['const CIRCLE_GAP_HEX = Object.freeze({min: 5, max: 9})', 'const CIRCLE_GAP_HEX = Object.freeze({min: 5, max: 30})']],
    'elite-on-normal': [["normal: Object.freeze(['gap', 'far', 'ring'])", "normal: Object.freeze(['gap', 'far', 'ring', 'elite'])"]],
    'near-far': [['const CIRCLE_FAR_GAP_HEX = Object.freeze({min: 10', 'const CIRCLE_FAR_GAP_HEX = Object.freeze({min: 5']]
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
const KINDS = {tiny: ['gap', 'far'], normal: ['gap', 'far', 'ring'], big: ['gap', 'far', 'ring', 'elite']};
const GAP = [5, 9], FAR = [10, 15], RING = [5, 10], NEUTRAL_SPACING = 5, DISPARITY = 4;
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
const box = c => [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({x: c.x + dx, y: c.y + dy})));
const within = (d, [lo, hi]) => d >= lo && d <= hi;

// Path distances from one human town: layer > R and other human towns are solid,
// neutral towns are endpoints (reached but not walked through).
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

// Free region (layer <= R minus every object) is one component and every object touches it.
function connected(R, objects) {
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
    return count === 1 && objects.every(o => neighbours(o, side).some(n => seen.has(key(n))));
}

// Band of a kind for a site: every box cell in bounds and inside the radius, plus the kind's layer rule
// ('far' shares the gap band).
function inBand(kind, c, R, E, ringOuter) {
    const side = 2 * R + 1, cells = box(c);
    if (!cells.every(b => b.x >= 0 && b.y >= 0 && b.x < side && b.y < side && layerAt(b, R) <= R)) return false;
    const l = layerAt(c, R), boxLayers = cells.map(b => layerAt(b, R));
    if (kind === 'gap' || kind === 'far') return boxLayers.every(v => v > ringOuter);
    if (kind === 'ring') return l > E && l <= ringOuter && boxLayers.every(v => v > E);
    return l <= E;
}

const owns = (c, owner, towns) => towns.every(t => hexDistance(c, t) >= hexDistance(c, owner));

// Sites of `kind` for `owner` that pass every static rule against the earlier
// neutral towns `prev` and are connected, with hex distance from the owner in [lo, hi].
function scanSites(kind, owner, prev, ctx, lo, hi) {
    const {R, E, ringOuter, towns, startReserved} = ctx, side = 2 * R + 1;
    const prevBoxes = new Set(prev.flatMap(p => box(p).map(key)));
    const found = [];
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const c = {x, y}, d = hexDistance(c, owner);
        if (d < lo || d > hi || layerAt(c, R) > R || !inBand(kind, c, R, E, ringOuter)) continue;
        if (box(c).some(b => startReserved.has(key(b)) || prevBoxes.has(key(b)))) continue;
        if (prev.some(p => hexDistance(c, p) < NEUTRAL_SPACING)) continue;
        if (kind !== 'elite' && !owns(c, owner, towns)) continue;
        if (!connected(R, [...towns, ...prev, c])) continue;
        found.push({x, y, hexDistance: d});
    }
    return found;
}

const failures = [];
const assert = (name, ok, detail) => { if (!ok) failures.push({name, detail}); };
const matrix = [], relaxedCases = {ringTowns: [], farTowns: []};
// How far a hex distance lies outside the far window.
const farMiss = d => Math.max(FAR[0] - d, d - FAR[1]);
for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
    const id = {size, humans, seed};
    let plan, starts, layout, attempt;
    try {
        // Production retry sequence: the first attempt seed whose stages build wins.
        ({plan, starts, layout, attempt} = withCircleTestAttempts(seed, s => {
            const plan = planner.planCoopCircle(humans, size, s), starts = planner.placeCircleStarts(plan, colorOf);
            return {plan, starts, layout: planner.placeCircleExpansions(plan, starts)};
        }));
    } catch (error) { assert('planner-throws', false, {...id, error: error.message}); continue; }
    const R = plan.radius, {E, ringOuter} = circleTestBands(R, humans, size), side = 2 * R + 1;
    const towns = layout.players.slice(1).map(p => p.towns[0]), neutral = layout.players[0].towns;
    const assignments = layout.expansions.neutralAssignments || [];
    const startReserved = new Set(starts.reserved.map(key)), ctx = {R, E, ringOuter, towns, startReserved};
    const kinds = KINDS[size];
    assert('neutral-count', neutral.length === humans * kinds.length && assignments.length === neutral.length,
        {...id, placed: neutral.length, assignments: assignments.length, expected: humans * kinds.length});
    assert('assignments-match-towns', JSON.stringify(assignments.map(a => ({x: a.x, y: a.y}))) === JSON.stringify(neutral)
        && JSON.stringify(layout.expansions.neutralTowns) === JSON.stringify(neutral), id);
    // Per human exactly the kinds of the size, once each.
    const kindsBySlot = towns.map((_, i) => assignments.filter(a => a.slot === i + 1).map(a => a.kind).sort());
    assert('kinds-per-human', kindsBySlot.every(k => JSON.stringify(k) === JSON.stringify(kinds.slice().sort()))
        && assignments.every(a => a.slot >= 1 && a.slot <= humans), {...id, kindsBySlot});
    assert('elite-big-only', size === 'big' || assignments.every(a => a.kind !== 'elite'), {...id, kinds: assignments.map(a => a.kind)});
    const rows = [];
    assignments.forEach((a, k) => {
        const c = {x: a.x, y: a.y}, owner = towns[a.slot - 1], d = owner ? hexDistance(c, owner) : null;
        const detail = {...id, assignment: a, hex: d, E, ringOuter, layer: layerAt(c, R)};
        assert('hex-distance-reported', d === a.hexDistance, detail);
        assert(`band-${a.kind}`, inBand(a.kind, c, R, E, ringOuter), detail);
        if (a.kind === 'gap') assert('gap-distance', within(d, GAP), detail);
        if (a.kind === 'far') {
            assert('far-band', box(c).every(b => layerAt(b, R) > ringOuter && layerAt(b, R) <= R), detail);
            assert('far-distance', a.relaxed ? !within(d, FAR) : within(d, FAR), detail);
        }
        if (a.kind === 'ring') assert('ring-distance', a.relaxed ? d > RING[1] : within(d, RING), detail);
        assert('relaxed-ring-or-far-only', !a.relaxed || a.kind === 'ring' || a.kind === 'far', detail);
        if (a.kind !== 'elite') assert('ownership', owner && owns(c, owner, towns), {...detail, hexToTowns: towns.map(t => hexDistance(c, t))});
        // Placement order is assignment order: the scans see only the earlier neutral towns.
        const prev = assignments.slice(0, k).map(p => ({x: p.x, y: p.y}));
        if (a.relaxed && a.kind === 'far') {
            const preferred = scanSites('far', owner, prev, ctx, FAR[0], FAR[1]);
            // Valid connected gap-band sites strictly less far outside the window than the chosen one.
            const miss = farMiss(d), nearer = scanSites('far', owner, prev, ctx, FAR[0] - miss + 1, FAR[1] + miss - 1);
            assert('far-relaxed-justified', preferred.length === 0, {...detail, preferred: preferred.slice(0, 3)});
            assert('far-relaxed-nearest', nearer.length === 0, {...detail, nearer: nearer.slice(0, 3)});
            relaxedCases.farTowns.push({size, humans, seed, attempt, radius: R, E, ringOuter, slot: a.slot, x: a.x, y: a.y,
                hexDistance: d, validFarSites10to15: preferred.length, lessOutsideValidSites: nearer.length});
        }
        if (a.relaxed && a.kind === 'ring') {
            const preferred = scanSites('ring', owner, prev, ctx, RING[0], RING[1]);
            const nearer = scanSites('ring', owner, prev, ctx, RING[1] + 1, d - 1);
            assert('relaxed-justified', preferred.length === 0, {...detail, preferred: preferred.slice(0, 3)});
            assert('relaxed-nearest', nearer.length === 0, {...detail, nearer: nearer.slice(0, 3)});
            relaxedCases.ringTowns.push({size, humans, seed, attempt, radius: R, E, ringOuter, slot: a.slot, x: a.x, y: a.y,
                hexDistance: d, validRingSites5to10: preferred.length, nearerValidSites: nearer.length});
        }
        if (a.kind === 'elite') {
            const nearer = scanSites('elite', owner, prev, ctx, 0, d - 1);
            assert('elite-nearest', nearer.length === 0, {...detail, nearer: nearer.slice(0, 3)});
        }
        rows.push({...a, layer: layerAt(c, R)});
    });
    // Boxes clear of start reservations and pairwise disjoint; towns pairwise at hex >= NEUTRAL_SPACING.
    const boxKeys = neutral.flatMap(t => box(t).map(key));
    const onReserved = boxKeys.filter(k => startReserved.has(k)).length;
    const overlaps = boxKeys.length - new Set(boxKeys).size;
    const pairs = neutral.flatMap((a, i) => neutral.slice(i + 1).map(b => hexDistance(a, b)));
    const minNeutralHex = pairs.length ? Math.min(...pairs) : null;
    assert('box-clear', onReserved === 0, {...id, onReserved});
    assert('box-disjoint', overlaps === 0, {...id, overlaps});
    assert('neutral-spacing', pairs.every(d => d >= NEUTRAL_SPACING), {...id, minNeutralHex});
    const allObjects = [...towns, ...neutral, ...layout.goldmines.map(m => ({x: m.x, y: m.y}))];
    assert('connectivity', connected(R, allObjects) && connected(R, [...towns, ...neutral]), id);
    const endpoints = new Set(neutral.map(key));
    const nearest = towns.map((t, i) => {
        const f = pathField(R, t, new Set(towns.filter((_, j) => j !== i).map(key)), endpoints);
        return Math.min(...neutral.map(n => f.has(key(n)) ? f.get(key(n)) : Infinity));
    });
    const spread = Math.max(...nearest) - Math.min(...nearest);
    assert('neutral-spread', nearest.every(Number.isFinite) && spread <= DISPARITY, {...id, nearest, spread});
    matrix.push({size, humans, seed, attempt, radius: R, eliteLayer: E, ringOuter, side,
        neutralCount: neutral.length, relaxed: rows.filter(r => r.relaxed).length, minNeutralHex,
        nearestNeutralDistance: nearest, neutralSpread: spread, assignments: rows});
}
assert('matrix-complete', matrix.length === 36 * SEEDS.length, {rows: matrix.length});

const failedNames = [...new Set(failures.map(f => f.name))];
const summary = {fault: fault || null, cases: matrix.length, seeds: SEEDS, relaxedRingTowns: relaxedCases.ringTowns.length,
    relaxedFarTowns: relaxedCases.farTowns.length,
    failures: failures.length, failedAssertions: failedNames, firstFailures: failures.slice(0, 5), pass: failures.length === 0};
if (outputDir) {
    const suffix = fault ? `-${fault}` : '';
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, `neutrals-matrix${suffix}.json`), JSON.stringify(matrix, null, 1) + '\n');
    fs.writeFileSync(path.join(outputDir, `relaxed-cases${suffix}.json`), JSON.stringify(relaxedCases, null, 1) + '\n');
}
console.log(JSON.stringify(summary));
for (const name of failedNames) console.error(`FAIL ${name}`);
if (failures.length) process.exit(1);
console.error(`PASS co-op circle neutrals cases=${matrix.length} relaxedRing=${relaxedCases.ringTowns.length} relaxedFar=${relaxedCases.farTowns.length}`);
