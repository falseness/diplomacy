'use strict';
// Read-only review of the smallest-supported competitive map selection recorded by one
// terminal acquisition's next-game traces (TASK-225-7). The minimum is derived from the
// shipped catalog in options/gamestart.js, whose bytes must equal the acquisition's
// recorded source identity; the traces' embedded catalog is only cross-checked.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT = '/root/diplomacy';
const TRACES = 'provider/next-game-traces.jsonl';
const CASE_TRACES = 'provider/terminal-to-competitive/network-traces.jsonl';
const IDENTITIES = 'provider/source-identities.json';
const CATALOG = 'options/gamestart.js';
const MENU = 'menu/menu.js';
const PLAYERS = ['p1', 'p2'];
const STAGES = ['ac7-menu-before', 'ac7-menu-tap', 'ac7-menu-selected'];

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function load(runDir, client = CLIENT) {
    const files = {};
    for (const rel of [TRACES, CASE_TRACES, IDENTITIES]) {
        const abs = path.join(runDir, rel);
        files[rel] = {path: abs, bytes: fs.readFileSync(abs)};
    }
    for (const rel of [CATALOG, MENU]) {
        const abs = path.join(client, rel);
        files[rel] = {path: abs, bytes: fs.readFileSync(abs)};
    }
    return {runDir, files};
}

// Evaluate only the `maps = {...}` literal with a GameMap stub that records mapSize, so the
// ordering is the object key order the menu's map slider walks (getKeyByIndexDictionary).
function shippedCatalog(source) {
    const start = source.indexOf('\nmaps = {');
    if (start < 0) throw new Error('catalog-unparsed: no top-level maps literal');
    let depth = 0, end = -1;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    const sandbox = {
        GameMap: class { constructor(mapSize) { this.mapSize = mapSize; } },
        coordDictionary: l => l.map(([x, y]) => ({x, y})),
    };
    vm.runInNewContext('result = ' + source.slice(start + '\nmaps = '.length, end), sandbox);
    return Object.entries(sandbox.result).map(([name, variants], index) => ({
        name, index, sizes: Array.from(variants, v => ({x: v.mapSize.x, y: v.mapSize.y})),
    }));
}

function review(input) {
    const f = input.files;
    const failures = [];
    const fail = (reason, detail) => failures.push({reason, detail});

    // Catalog binding: the menu and catalog bytes reviewed now must be the bytes the
    // acquisition ran with, in both its before and after manifests.
    const identities = JSON.parse(f[IDENTITIES].bytes);
    const binding = {};
    for (const rel of [CATALOG, MENU]) {
        const observed = sha(f[rel].bytes);
        const recorded = ['before', 'after'].map(k => identities[k].client.files[rel]);
        binding[rel] = {observed, recordedBefore: recorded[0], recordedAfter: recorded[1]};
        if (recorded.some(r => r !== observed)) fail('catalog-rebound', `${rel} sha256 ${observed} is not the acquisition's recorded ${recorded.join('/')}`);
    }

    const catalog = shippedCatalog(f[CATALOG].bytes.toString('utf8'));
    const area = s => s.x * s.y;
    const ranked = catalog.map(m => ({...m, area: Math.min(...m.sizes.map(area))})).sort((a, b) => a.area - b.area);
    const minimum = ranked[0];
    if (ranked[1] && ranked[1].area === minimum.area) fail('catalog-minimum-ambiguous', `${minimum.name} ties ${ranked[1].name}`);

    const rows = f[TRACES].bytes.toString('utf8').split('\n').map((l, i) => ({line: i + 1, text: l}))
        .filter(r => r.text).map(r => ({...r, row: JSON.parse(r.text)}));
    const caseRows = f[CASE_TRACES].bytes.toString('utf8').split('\n').filter(Boolean);
    const players = {};
    for (const p of PLAYERS) {
        const pick = stage => rows.filter(r => r.row.stage === stage && r.row.participant === p && r.row.mode === 'competitive');
        const found = Object.fromEntries(STAGES.map(s => [s, pick(s)]));
        const missing = STAGES.filter(s => found[s].length !== 1);
        if (missing.length) {
            fail('selection-missing', `${p} has ${missing.map(s => `${found[s].length}x ${s}`).join(', ')}`);
            players[p] = {missing};
            continue;
        }
        const [before, tap, selected] = STAGES.map(s => found[s][0]);
        if (!(before.line < tap.line && tap.line < selected.line)) fail('selection-order', `${p} lines ${before.line}/${tap.line}/${selected.line}`);
        for (const r of [before, tap, selected]) {
            if (!caseRows.includes(r.text)) fail('case-trace-divergent', `${p} ${r.row.stage} line ${r.line} absent from ${CASE_TRACES}`);
            const s = r.row.state;
            const shipped = catalog[s.mapIndex];
            if (!shipped || shipped.name !== s.map) fail('index-name-mismatch', `${p} ${r.row.stage}: index ${s.mapIndex} is ${shipped && shipped.name} in the shipped catalog, trace says ${s.map}`);
            // The embedded catalog names one size per entry; it must be one the shipped entry offers.
            const embedded = s.catalog || [];
            if (embedded.length !== catalog.length || embedded.some((c, i) => c.name !== catalog[i].name || c.index !== i
                || !catalog[i].sizes.some(z => z.x === c.size.x && z.y === c.size.y))) fail('trace-catalog-differs', `${p} ${r.row.stage} line ${r.line} catalog differs from shipped`);
        }
        if (before.row.state.mapIndex !== 0) fail('before-not-default', `${p} before index ${before.row.state.mapIndex}`);
        if (tap.row.slider !== 'mapSlider' || tap.row.before !== before.row.state.mapIndex) fail('tap-unbound', `${p} tap ${tap.row.slider} from ${tap.row.before}`);
        // The index is held to the name by index-name-mismatch above.
        if (selected.row.state.map !== minimum.name) fail('selection-not-minimum', `${p} selected ${selected.row.state.map}@${selected.row.state.mapIndex}, minimum is ${minimum.name}@${minimum.index}`);
        if (selected.row.state.humans !== 2) fail('humans', `${p} selected with ${selected.row.state.humans} humans`);

        // The realized next game: raw page grid at the first competitive move.
        const pages = rows.filter(r => r.row.stage === 'ac3-passive' && r.row.mode === 'competitive' && r.row.kind === 'page'
            && r.row.boundary === 'first-move-before' && r.row.participant === p);
        let realized = null;
        if (pages.length !== 1) fail('realized-page-missing', `${p} has ${pages.length} first-move-before pages`);
        else {
            const grid = pages[0].row.raw.state.grid.items;
            const heights = [...new Set(grid.map(c => c.items.length))];
            realized = {line: pages[0].line, x: grid.length, y: heights.length === 1 ? heights[0] : heights};
            if (!minimum.sizes.some(s => s.x === realized.x && s.y === realized.y)) fail('realized-not-minimum', `${p} page ${realized.x}x${JSON.stringify(realized.y)}`);
        }
        const cite = r => ({line: r.line, stage: r.row.stage, map: r.row.state.map, mapIndex: r.row.state.mapIndex,
            ...(r.row.slider ? {slider: r.row.slider, direction: r.row.direction, before: r.row.before} : {})});
        players[p] = {before: cite(before), tap: cite(tap), selected: cite(selected), realizedPage: realized};
    }

    const proof = rel => ({path: f[rel].path, sha256: sha(f[rel].bytes)});
    return {
        schema: 'task225-7-map-review-v1',
        runDir: input.runDir,
        proofs: [TRACES, CASE_TRACES, IDENTITIES, CATALOG, MENU].map(proof),
        catalogBinding: binding,
        derivedCatalog: catalog,
        derivedMinimum: {name: minimum.name, index: minimum.index, sizes: minimum.sizes, area: minimum.area,
            nextSmallest: ranked[1] && {name: ranked[1].name, index: ranked[1].index, area: ranked[1].area}},
        players,
        failures,
        reasons: [...new Set(failures.map(x => x.reason))],
        pass: failures.length === 0,
    };
}

module.exports = {load, review, shippedCatalog, TRACES, CASE_TRACES, IDENTITIES, CATALOG};

if (require.main === module) {
    const [runDir, out] = process.argv.slice(2);
    const report = review(load(path.resolve(runDir)));
    const text = JSON.stringify(report, null, 2) + '\n';
    if (out) {
        if (fs.existsSync(out)) throw new Error('refusing to overwrite ' + out);
        fs.writeFileSync(out, text);
    }
    process.stdout.write(text);
    process.exitCode = report.pass ? 0 : 1;
}
