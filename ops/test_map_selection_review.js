'use strict';
// Source tests for ops/map_selection_review.js: reconnect-170's next-game traces select the
// shipped minimum for both players, and each corruption control (applied to an in-memory copy
// of the reviewed bytes) is rejected for exactly its intended reason.
const assert = require('assert');
const test = require('node:test');
const {load, review, TRACES, CASE_TRACES, CATALOG} = require('./map_selection_review.js');

const RUN = '/root/diplomacy/artifacts/TASK-225/reconnect-170/run-01';
const real = load(RUN);

const copy = input => ({runDir: input.runDir, files: Object.fromEntries(Object.entries(input.files)
    .map(([k, v]) => [k, {path: v.path, bytes: Buffer.from(v.bytes)}]))});
// Edits keep the untouched lines byte-identical, so the case-trace cross-check stays quiet.
const editLines = (input, key, fn) => {
    const out = [];
    for (const line of input.files[key].bytes.toString('utf8').split('\n')) {
        if (!line) { out.push(line); continue; }
        const row = JSON.parse(line);
        const edited = fn(row);
        if (edited === null) continue;
        out.push(edited ? JSON.stringify(row) : line);
    }
    input.files[key].bytes = Buffer.from(out.join('\n'));
};
const both = (input, fn) => [TRACES, CASE_TRACES].forEach(k => editLines(input, k, fn));
const is = (r, stage, p) => r.stage === stage && r.participant === p && r.mode === 'competitive';

test('reconnect-170 selects the shipped minimum for both players', () => {
    const report = review(real);
    assert.deepStrictEqual(report.failures, []);
    assert.deepStrictEqual(report.derivedMinimum.sizes, [{x: 20, y: 10}]);
    assert.strictEqual(report.derivedMinimum.name, 'tiny deathmatch');
    for (const p of ['p1', 'p2']) {
        assert.deepStrictEqual([report.players[p].before.mapIndex, report.players[p].selected.mapIndex], [0, 1]);
        assert.deepStrictEqual([report.players[p].realizedPage.x, report.players[p].realizedPage.y], [20, 10]);
    }
    console.log(`POSITIVE pass=${report.pass} minimum=${report.derivedMinimum.name}@${report.derivedMinimum.index} ` +
        `p1=${report.players.p1.selected.line} p2=${report.players.p2.selected.line}`);
});

const CONTROLS = [
    ['swapped-map-index', ['index-name-mismatch'], input => both(input, r => {
        if (!is(r, 'ac7-menu-selected', 'p1')) return false;
        r.state.mapIndex = 0;
        return true;
    })],
    ['single-player-only-selection', ['selection-missing'], input => editLines(input, TRACES, r =>
        (is(r, 'ac7-menu-tap', 'p2') || is(r, 'ac7-menu-selected', 'p2')) ? null : false)],
    // Same catalog semantics, different bytes: only the hash binding can notice.
    ['rebound-catalog-bytes', ['catalog-rebound'], input => {
        input.files[CATALOG].bytes = Buffer.concat([input.files[CATALOG].bytes, Buffer.from('\n// rebound\n')]);
    }],
    // A catalog whose minimum moved: rejected as rebound, and the selection no longer matches it.
    ['rebound-catalog-minimum', ['catalog-rebound', 'selection-not-minimum', 'realized-not-minimum', 'trace-catalog-differs'], input => {
        const text = input.files[CATALOG].bytes.toString('utf8');
        const edited = text.replace('"stationary warfare":\n    [\n        new GameMap(\n            {x: 21, y: 21}',
            '"stationary warfare":\n    [\n        new GameMap(\n            {x: 9, y: 9}');
        assert.notStrictEqual(edited, text);
        input.files[CATALOG].bytes = Buffer.from(edited);
    }],
];

for (const [name, intended, mutate] of CONTROLS) {
    test(`control ${name} is rejected for ${intended.join('+')}`, () => {
        const input = copy(real);
        mutate(input);
        const report = review(input);
        console.log(`CONTROL ${name} pass=${report.pass} reasons=${JSON.stringify(report.reasons)} intended=${JSON.stringify(intended)}`);
        for (const f of report.failures) console.log(`  ${f.reason}: ${f.detail}`);
        assert.strictEqual(report.pass, false);
        assert.deepStrictEqual([...report.reasons].sort(), [...intended].sort());
    });
}

test('real bytes are unchanged by the controls', () => {
    assert.deepStrictEqual(review(load(RUN)), review(real));
});
