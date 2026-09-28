'use strict';
// Source tests for ops/ac7_terminal_reader.js: the real reconnect-170 acquisition passes every
// AC7 clause, and one falsification control per clause (applied to an in-memory copy of the
// acquisition bytes) is rejected by exactly the targeted clause.
const assert = require('assert');
const test = require('node:test');
const {CLAUSES, load, evaluate} = require('./ac7_terminal_reader.js');

const RUN = '/root/diplomacy/artifacts/TASK-225/reconnect-170/run-01';
const real = load(RUN);

const copy = input => ({runDir: input.runDir, files: Object.fromEntries(Object.entries(input.files)
    .map(([k, v]) => [k, {path: v.path, bytes: Buffer.from(v.bytes)}]))});
const editJson = (input, key, fn) => {
    const d = JSON.parse(input.files[key].bytes);
    fn(d);
    input.files[key].bytes = Buffer.from(JSON.stringify(d, null, 2) + '\n');
};
const editLines = (input, key, fn) => {
    const rows = input.files[key].bytes.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    rows.forEach(fn);
    input.files[key].bytes = Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
};
const result = (report, id) => report.results.find(r => r.id === id).result;

test('real reconnect-170 acquisition establishes every AC7 clause', () => {
    const report = evaluate(real);
    assert.deepStrictEqual(report.results.map(r => r.id), CLAUSES.map(c => c[0]));
    for (const r of report.results) {
        assert.strictEqual(r.result, 'PASS', `${r.id}: ${r.failures.join('; ')}`);
        assert.ok(r.proofs.length > 0 && r.proofs.every(p => /^[0-9a-f]{64}$/.test(p.sha256)), r.id);
    }
    assert.strictEqual(report.pass, true);
});

const CONTROLS = {
    'retain-behaviors-tiered': input => editJson(input, 'provider/terminal-inventory.json',
        d => { d.rules.find(r => r.id === 'defeat').tier = 'synthetic source only'; }),
    'browser-journeys': input => {
        for (const f of ['declared-fixture.json', 'network-traces.jsonl', 'input-trace.jsonl', 'cleanup.json']) {
            input.files[`provider/terminal-extra/${f}`] = {path: `injected/terminal-extra/${f}`, bytes: Buffer.from(input.files[`provider/terminal-draw/${f}`].bytes)};
        }
        editJson(input, 'verification-plan.json', d => { d.cases.splice(6, 0, 'terminal-extra'); });
    },
    'two-humans': input => editLines(input, 'provider/terminal-to-coop/input-trace.jsonl',
        (r, i) => { if (i === 3) r.player = 'p3'; }),
    'smallest-maps': input => editLines(input, 'provider/terminal-to-competitive/network-traces.jsonl',
        r => { if (r.stage === 'ac7-menu-selected' && r.participant === 'p2') r.state.map = 'open field'; }),
    'seed-1': input => editLines(input, 'provider/terminal-to-coop/network-traces.jsonl',
        r => { if (r.event === 'gameStarted') r.board.gameSettings.coop.generation.seed = 2; }),
    'fog-join-spread': input => editLines(input, 'provider/terminal-to-competitive/network-traces.jsonl',
        r => { if (r.join) r.join = 'sequential'; }),
    'declared-fixtures': input => editJson(input, 'provider/terminal-victory/declared-fixture.json',
        d => { d.spec.generation.testFixture.purpose += ' (edited after the run)'; }),
    'diagnostics-excluded': input => editJson(input, 'verification-plan.json',
        d => { d.newCases.push('full-browser-cross-product'); }),
    // Stored pass stays true; only the recomputed comparison can reject it.
    'exact-assertions': input => editJson(input, 'provider/checkpoints.json',
        d => { const row = d.checkpoints.find(r => r.id === 'terminal-draw/terminal-result'); row.observed = 'victory-altered'; row.pass = true; }),
};

test('controls cover every AC7 clause', () => {
    assert.deepStrictEqual(Object.keys(CONTROLS), CLAUSES.map(c => c[0]));
});

for (const [id, falsify] of Object.entries(CONTROLS)) {
    test(`falsified ${id} is rejected`, () => {
        const input = copy(real);
        falsify(input);
        const report = evaluate(input);
        assert.strictEqual(result(report, id), 'FAIL', id);
        assert.strictEqual(report.pass, false);
        const others = report.results.filter(r => r.id !== id && r.result === 'FAIL').map(r => r.id);
        console.log(`# control ${id}: targeted FAIL; other failing clauses: ${JSON.stringify(others)}`);
        console.log(`#   ${report.results.find(r => r.id === id).failures.join('; ')}`);
        if (id !== 'browser-journeys') assert.deepStrictEqual(others, [], `${id} control is not isolated`);
    });
}

test('tested-source drift rejects the source-derived expectations', () => {
    const input = copy(real);
    input.files['client:ai/coop-map-scaling.js'].bytes = Buffer.concat([input.files['client:ai/coop-map-scaling.js'].bytes, Buffer.from('\n')]);
    const report = evaluate(input);
    assert.strictEqual(result(report, 'smallest-maps'), 'FAIL');
    assert.strictEqual(result(report, 'declared-fixtures'), 'FAIL');
});

test('reader is read-only and CLI refuses to overwrite a report', () => {
    const fs = require('fs'), os = require('os'), path = require('path'), {execFileSync} = require('child_process');
    const before = Object.fromEntries(Object.entries(load(RUN).files).map(([k, v]) => [k, v.bytes.toString('base64')]));
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac7-')), 'r.json');
    fs.writeFileSync(out, 'existing');
    assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'ac7_terminal_reader.js'), RUN, out], {stdio: 'pipe'}));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'existing');
    const after = Object.fromEntries(Object.entries(load(RUN).files).map(([k, v]) => [k, v.bytes.toString('base64')]));
    assert.deepStrictEqual(after, before);
});
