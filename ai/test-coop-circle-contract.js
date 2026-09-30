#!/usr/bin/env node
// Independent co-op Circle contract. verifyCircle(map) re-measures an assembled
// circle map from its raw cell lists with its own hex layer, lattice-free region
// and BFS code; it never calls the circle planner (ai/coop-circle-plan.js) and
// never trusts planner labels (regions, masks, reservations, spreads).
// The driver below the contract is the only planner user: it runs the five stages
// (plan, starts, expansions, portals, terrain) over the full size x humans matrix,
// dumps the assembled maps and applies the production balance retry.
// Usage: node ai/test-coop-circle-contract.js [--output-dir DIR] [--fault town-off-ring|mask-overlap]
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const scaling = require('./coop-map-scaling.js');
const {circleTestBands} = require('./coop-circle-test-bands');

// COOP_START_BALANCE is read from ai/generateMap.js (a browser global script) so
// the contract follows the production bound without loading the generator.
const COOP_START_BALANCE = (() => {
    const source = fs.readFileSync(path.join(__dirname, 'generateMap.js'), 'utf8');
    const match = /const COOP_START_BALANCE = Object\.freeze\(\{assetDisparity: (\d+), pathDisparity: (\d+)\}\)/.exec(source);
    if (!match) throw new Error('COOP_START_BALANCE not found in ai/generateMap.js');
    return Object.freeze({assetDisparity: Number(match[1]), pathDisparity: Number(match[2])});
})();
const ELITE = ['chaos', 'heavy', 'siege', 'mage'];
const COMMON = ['melee', 'ranged', 'support'];
const MAX_GROWTH = 8;
const BALANCE_ASSERTIONS = ['starting-asset-balance', 'nearest-objective-balance'];
const RETRYABLE = [...BALANCE_ASSERTIONS, 'planner-throws'];

// Offset columns (odd columns lower) -> axial q = x, r = y - floor(x/2); cube distance.
const key = c => `${c.x},${c.y}`;
const axialR = c => c.y - Math.floor(c.x / 2);
const layerOf = (c, center) => {
    const dq = c.x - center.q, dr = axialR(c) - center.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const around = c => DIRS.map(([dq, dr]) => {
    const q = c.x + dq;
    return {x: q, y: axialR(c) + dr + Math.floor(q / 2)};
});
const humansOf = map => map.players.slice(1, 1 + map.coop.initialHumanCount);

// Smallest R >= min with R*R >= scale*scale*h (no sqrt), as in the TASK-262 test.
function expectedBaseline(humans, size) {
    const preset = scaling.COOP_HEX_RADIUS[size];
    let R = preset.min;
    while (R * R < preset.scale * preset.scale * humans) R++;
    return R;
}

function geometry(map) {
    const R = map.mapShape.radius, center = {q: R, r: Math.ceil(R / 2)};
    const inBounds = c => Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 &&
        c.x < map.mapSize.x && c.y < map.mapSize.y;
    const open = c => inBounds(c) && layerOf(c, center) <= R;
    const {E, ringOuter} = circleTestBands(R, map.coop.initialHumanCount, map.coop.generation.size);
    return {R, center, E, ringOuter, inBounds, open, layer: c => layerOf(c, center)};
}

// BFS over open (unmasked) cells: blocked cells are never entered, endpoint cells
// are entered but never expanded (except the origin).
function bfs(g, origin, blocked, endpoints) {
    const dist = new Map();
    if (!g.open(origin) || blocked.has(key(origin))) return dist;
    const queue = [origin];
    dist.set(key(origin), 0);
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        if (i > 0 && endpoints.has(key(c))) continue;
        for (const n of around(c)) {
            const id = key(n);
            if (dist.has(id) || !g.open(n) || blocked.has(id)) continue;
            dist.set(id, dist.get(key(c)) + 1);
            queue.push(n);
        }
    }
    return dist;
}

// Production transit model plus the mask: mountains, lakes, masked cells and other
// humans' towns block; neutral towns and portals are endpoints; goldmines transit.
function transit(map, g, index) {
    const blocked = new Set([...map.mountains, ...map.lakes,
        ...humansOf(map).flatMap((p, j) => j === index ? [] : p.towns)].map(key));
    const endpoints = new Set([...map.players[0].towns, ...map.portals].map(key));
    return bfs(g, humansOf(map)[index].towns[0], blocked, endpoints);
}

const ASSERTIONS = [
    ['radius-growth', map => {
        const h = map.coop.initialHumanCount, size = map.coop.generation.size, R = map.mapShape.radius;
        const baseline = expectedBaseline(h, size);
        return {expected: {min: baseline, max: baseline + MAX_GROWTH}, observed: R,
            pass: Number.isInteger(R) && R >= baseline && R <= baseline + MAX_GROWTH};
    }],
    ['dimensions', map => {
        const R = map.mapShape.radius;
        return {expected: {x: 2 * R + 1, y: 2 * R + 1}, observed: map.mapSize,
            pass: map.mapSize.x === 2 * R + 1 && map.mapSize.y === 2 * R + 1};
    }],
    ['map-shape', map => {
        const R = map.mapShape.radius;
        const expected = {type: 'hexagonal', center: {q: R, r: Math.ceil(R / 2)}, radius: R, offset: {x: 0, y: 0}};
        const s = map.mapShape;
        return {expected, observed: s, pass: s.type === 'hexagonal' && s.center && s.center.q === R &&
            s.center.r === Math.ceil(R / 2) && s.offset && s.offset.x === 0 && s.offset.y === 0};
    }],
    ['mask-geometry', map => {
        const g = geometry(map);
        let playable = 0, masked = 0;
        for (let x = 0; x < map.mapSize.x; x++) for (let y = 0; y < map.mapSize.y; y++)
            g.layer({x, y}) <= g.R ? playable++ : masked++;
        const expected = {playable: 3 * g.R * g.R + 3 * g.R + 1, masked: g.R * g.R + g.R};
        return {expected, observed: {playable, masked},
            pass: playable === expected.playable && masked === expected.masked};
    }],
    ['mask-solid', map => {
        const g = geometry(map);
        const all = [...map.players.flatMap(p => p.towns), ...map.goldmines, ...map.portals,
            ...map.mountains, ...map.lakes, ...map.bushes, ...map.hills];
        const outside = all.filter(c => !g.open(c)).map(key);
        const duplicates = all.length - new Set(all.map(key)).size;
        const maxLayer = all.length ? Math.max(...all.map(g.layer)) : null;
        return {expected: {maxLayer: `<= ${g.R}`, onMask: 0, duplicates: 0},
            observed: {cells: all.length, maxLayer, onMask: outside, duplicates},
            pass: !outside.length && !duplicates};
    }],
    ['counts', map => {
        const c = scaling.getCoopMapScaling(map.coop.initialHumanCount, map.coop.generation.size).counts;
        const observed = {humanTowns: humansOf(map).length, neutralTowns: map.players[0].towns.length,
            goldmines: map.goldmines.length, portals: map.portals.length};
        const expected = {humanTowns: map.coop.initialHumanCount, neutralTowns: c.neutralTowns,
            goldmines: c.goldmines, portals: c.portals};
        return {expected, observed, pass: JSON.stringify(expected) === JSON.stringify(observed)};
    }],
    ['portal-category-counts', map => {
        const expected = scaling.getCoopMapScaling(map.coop.initialHumanCount, map.coop.generation.size).counts.portalCategories;
        const observed = {};
        for (const p of map.portals) observed[p.category] = (observed[p.category] || 0) + 1;
        const cats = new Set([...Object.keys(expected), ...Object.keys(observed)]);
        return {expected, observed, pass: [...cats].every(k => (expected[k] || 0) === (observed[k] || 0))};
    }],
    ['human-town-ring', map => {
        const g = geometry(map);
        const observed = humansOf(map).map(p => p.towns.map(g.layer));
        return {expected: {layer: g.R - 3, townsPerHuman: 1}, observed,
            pass: observed.every(l => l.length === 1 && l[0] === g.R - 3)};
    }],
    ['elite-portals-in-core', map => {
        const g = geometry(map);
        const bad = map.portals.filter(p => ELITE.includes(p.category) && g.layer(p) > g.E)
            .map(p => ({...p, layer: g.layer(p)}));
        return {expected: {maxLayer: g.E}, observed: {violations: bad}, pass: !bad.length};
    }],
    ['common-portals-in-ring', map => {
        const g = geometry(map), outer = g.ringOuter;
        const bad = map.portals.filter(p => !ELITE.includes(p.category) &&
            (!COMMON.includes(p.category) || g.layer(p) <= g.E || g.layer(p) > outer)).map(p => ({...p, layer: g.layer(p)}));
        return {expected: {layerAbove: g.E, layerAtMost: outer}, observed: {violations: bad}, pass: !bad.length};
    }],
    ['neutral-towns-mines-outside-core', map => {
        const g = geometry(map);
        const bad = [...map.players[0].towns, ...map.goldmines].filter(c => g.layer(c) <= g.E)
            .map(c => ({...c, layer: g.layer(c)}));
        return {expected: {layerAbove: g.E}, observed: {violations: bad}, pass: !bad.length};
    }],
    ['free-region-connected', map => {
        const g = geometry(map);
        const objects = [...map.players.flatMap(p => p.towns), ...map.goldmines, ...map.portals];
        const solid = new Set([...map.mountains, ...map.lakes, ...objects].map(key));
        const free = [];
        for (let x = 0; x < map.mapSize.x; x++) for (let y = 0; y < map.mapSize.y; y++)
            if (g.open({x, y}) && !solid.has(key({x, y}))) free.push({x, y});
        const seen = new Set(), sizes = [];
        for (const origin of free) {
            if (seen.has(key(origin))) continue;
            const reached = bfs(g, origin, solid, new Set());
            for (const id of reached.keys()) seen.add(id);
            sizes.push(reached.size);
        }
        const detached = objects.filter(o => !around(o).some(n => seen.has(key(n)))).map(key);
        return {expected: {components: 1, detachedObjects: 0},
            observed: {components: sizes.length, sizes: sizes.sort((a, b) => b - a), detachedObjects: detached},
            pass: sizes.length === 1 && !detached.length};
    }],
    ['route-reachability', map => {
        const g = geometry(map), targets = [...map.portals, ...map.players[0].towns, ...map.goldmines];
        const missing = humansOf(map).map((_, i) => {
            const d = transit(map, g, i);
            return targets.filter(c => !d.has(key(c))).length;
        });
        return {expected: {unreachablePerHuman: 0}, observed: missing, pass: missing.every(n => n === 0)};
    }],
    ['starting-asset-balance', map => {
        const observed = humansOf(map).map((p, i) => {
            const mines = map.goldmines.filter(m => m.owner === i + 1);
            return {gold: p.gold, towns: p.towns.length, units: p.units.length + p.towns.length,
                ownedMines: mines.length, income: mines.reduce((s, m) => s + m.income, 0)};
        });
        const disparity = Object.fromEntries(['gold', 'towns', 'units', 'ownedMines', 'income'].map(k => {
            const v = observed.map(o => o[k]);
            return [k, Math.max(...v) - Math.min(...v)];
        }));
        return {expected: {maxDisparity: COOP_START_BALANCE.assetDisparity}, observed: {assets: observed, disparity},
            pass: Object.values(disparity).every(d => d <= COOP_START_BALANCE.assetDisparity)};
    }],
    ['nearest-objective-balance', map => {
        const g = geometry(map);
        const groups = {goldmines: map.goldmines, neutralTowns: map.players[0].towns, portals: map.portals};
        const nearest = humansOf(map).map((_, i) => {
            const d = transit(map, g, i);
            return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k,
                v.length && v.every(c => d.has(key(c))) ? Math.min(...v.map(c => d.get(key(c)))) : null]));
        });
        const disparity = Object.fromEntries(Object.keys(groups).map(k => {
            const v = nearest.map(n => n[k]);
            return [k, v.every(Number.isFinite) ? Math.max(...v) - Math.min(...v) : null];
        }));
        return {expected: {maxDisparity: COOP_START_BALANCE.pathDisparity}, observed: {nearest, disparity},
            pass: Object.values(disparity).every(d => d !== null && d <= COOP_START_BALANCE.pathDisparity)};
    }]
];

function verifyCircle(map) {
    const results = ASSERTIONS.map(([name, check]) => {
        let r;
        try { r = check(map); } catch (error) { r = {pass: false, error: error.message}; }
        return {name, ...r};
    });
    const failed = results.filter(r => !r.pass).map(r => r.name);
    return {valid: !failed.length, failed, assertions: ASSERTIONS.map(a => a[0]), results};
}

module.exports = {verifyCircle, ASSERTIONS: ASSERTIONS.map(a => a[0]), BALANCE_ASSERTIONS, COOP_START_BALANCE};

// ---------------------------------------------------------------------------
// Driver: the only code in this file that uses the planner.
if (require.main === module) {
    const planner = require('./coop-circle-plan.js');
    const args = process.argv.slice(2);
    const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const outputDir = path.resolve(option('--output-dir') || 'artifacts/TASK-268');
    const fault = option('--fault');
    // Same derivation as coopCircleAttemptSeed (ai/generateMap.js), the production retry sequence.
    const attemptSeed = (seed, attempt) => attempt ? (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0 : seed;
    const ATTEMPTS = 8, SIZES = ['tiny', 'normal', 'big'], SEEDS = [0, 1];
    const colorOf = i => ({r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256});
    const copy = c => ({x: c.x, y: c.y});

    function assemble(humans, size, seed, attempt) {
        const plan = planner.planCoopCircle(humans, size, attemptSeed(seed, attempt));
        const starts = planner.placeCircleStarts(plan, colorOf);
        const layout = planner.placeCircleTerrain(plan, planner.placeCirclePortals(plan, planner.placeCircleExpansions(plan, starts)));
        return {
            mapSize: {...plan.mapSize},
            players: layout.players.map(p => ({rgb: {...p.rgb}, gold: p.gold, units: p.units.slice(), towns: p.towns.map(copy)})),
            goldmines: layout.goldmines.map(m => ({...copy(m), owner: m.owner, income: m.income})),
            lakes: layout.lakes.map(copy), mountains: layout.mountains.map(copy),
            bushes: layout.bushes.map(copy), hills: layout.hills.map(copy),
            mapShape: JSON.parse(JSON.stringify(plan.mapShape)),
            coop: {initialHumanCount: humans, generation: {kind: 'circle', playerCount: humans, seed, size,
                attempt, attemptSeed: attemptSeed(seed, attempt)}},
            portals: layout.portals.map(p => ({...copy(p), category: p.category}))
        };
    }

    // Fault controls corrupt an assembled map after generation.
    const FAULTS = {
        // Move the first human town one layer inward onto a free cell.
        'town-off-ring': {assertion: 'human-town-ring', apply: map => {
            const R = map.mapShape.radius, center = map.mapShape.center, town = map.players[1].towns[0];
            const used = new Set([...map.players.flatMap(p => p.towns), ...map.goldmines, ...map.portals,
                ...map.mountains, ...map.lakes, ...map.bushes].map(key));
            const target = around(town).find(n => layerOf(n, center) === R - 4 && !used.has(key(n)));
            if (!target) throw new Error('town-off-ring: no free inner neighbour');
            town.x = target.x; town.y = target.y;
        }},
        // Put a mountain on a masked cell (layer > R).
        'mask-overlap': {assertion: 'mask-solid', apply: map => {
            const R = map.mapShape.radius, center = map.mapShape.center;
            for (let x = 0; x < map.mapSize.x; x++) for (let y = 0; y < map.mapSize.y; y++)
                if (layerOf({x, y}, center) > R) { map.mountains.push({x, y}); return; }
        }}
    };
    if (fault !== undefined && !FAULTS[fault]) { console.error(`unknown fault ${fault}; expected ${Object.keys(FAULTS).join(', ')}`); process.exit(2); }

    fs.mkdirSync(outputDir, {recursive: true});
    if (fault) {
        const rows = [];
        let allRejected = true;
        for (const size of SIZES) {
            // First attempt that assembles, as generateCoopGame would pick it.
            let map = null;
            for (let attempt = 0; !map && attempt < ATTEMPTS; attempt++) {
                try { map = assemble(4, size, 0, attempt); } catch (error) { if (attempt === ATTEMPTS - 1) throw error; }
            }
            FAULTS[fault].apply(map);
            const r = verifyCircle(map);
            const ok = !r.valid && r.failed.includes(FAULTS[fault].assertion);
            allRejected = allRejected && ok;
            console.log(`FAULT ${fault} scenario=${size}-4-0 valid=${r.valid} failed=${r.failed.join(',')} intended=${FAULTS[fault].assertion}`);
            rows.push({scenario: `${size}-4-0`, fault, intended: FAULTS[fault].assertion, valid: r.valid, failed: r.failed});
        }
        fs.writeFileSync(path.join(outputDir, `contract-${fault}.json`), JSON.stringify(rows, null, 2) + '\n');
        if (!allRejected) { console.log(`UNEXPECTED fault ${fault} not rejected by ${FAULTS[fault].assertion}`); process.exit(3); }
        console.log(`FAIL ${FAULTS[fault].assertion} (fault ${fault} rejected in ${rows.length}/${rows.length} scenarios)`);
        process.exit(1);
    }

    const mapsDir = path.join(outputDir, 'maps');
    fs.mkdirSync(mapsDir, {recursive: true});
    const rows = [], shas = [];
    for (const size of SIZES) for (let humans = 1; humans <= 12; humans++) for (const seed of SEEDS) {
        const scenario = `${size}-${humans}-${seed}`, history = [];
        let map, r, attempt = 0;
        for (; attempt < ATTEMPTS; attempt++) {
            try { map = assemble(humans, size, seed, attempt); r = verifyCircle(map); }
            catch (error) { r = {valid: false, failed: ['planner-throws'], assertions: ASSERTIONS.map(a => a[0]), error: error.message}; map = null; }
            history.push({attempt, attemptSeed: attemptSeed(seed, attempt), failed: r.failed});
            if (r.valid || r.failed.some(f => !RETRYABLE.includes(f))) break;
        }
        // Non-retryable failures on any attempt, or balance/planner throws still failing after 8 attempts,
        // invalidate the case. generateCoopGame retries planner throws too (random starts, TASK-334).
        const nonBalance = history.flatMap(h => h.failed.filter(f => !RETRYABLE.includes(f)));
        const valid = r.valid && !nonBalance.length;
        const failed = valid ? [] : [...new Set([...nonBalance, ...r.failed])];
        let sha = null;
        if (map) {
            const file = path.join(mapsDir, `${scenario}.json`), text = JSON.stringify(map, null, 1) + '\n';
            fs.writeFileSync(file, text);
            sha = crypto.createHash('sha256').update(text).digest('hex');
            shas.push(`${sha}  maps/${scenario}.json`);
        }
        const byName = Object.fromEntries((r.results || []).map(x => [x.name, x]));
        rows.push({scenario, size, humans, seed, valid, failed, assertions: r.assertions,
            balanceAttempts: history.length, attempts: history, radius: map && map.mapShape.radius,
            disparity: byName['nearest-objective-balance'] ? byName['nearest-objective-balance'].observed.disparity : null,
            mapSha256: sha});
        console.log(`${valid ? 'PASS' : 'FAIL'} ${scenario} R=${map && map.mapShape.radius} balanceAttempts=${history.length}` +
            (valid ? '' : ` failed=${failed.join(',')}`));
    }
    fs.writeFileSync(path.join(outputDir, 'contract.json'), JSON.stringify(rows, null, 2) + '\n');
    fs.writeFileSync(path.join(outputDir, 'maps-sha256.txt'), shas.join('\n') + '\n');
    const bad = rows.filter(row => !row.valid);
    const retried = rows.filter(row => row.balanceAttempts > 1).length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} co-op circle contract cases=${rows.length} valid=${rows.length - bad.length} ` +
        `retried=${retried} maxAttempts=${Math.max(...rows.map(row => row.balanceAttempts))} assertions=${ASSERTIONS.length}`);
    process.exit(bad.length ? 1 : 0);
}
