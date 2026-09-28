'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {wire, createRecorder} = require('./terminal_ac2_provider');

// Source-tier wiring contracts. These deliberately have no real sockets,
// database, browser, or gameplay coverage and never grant criterion credit.
function fixture({fail = false, reconnectFailure = null, diagnostics = false} = {}) {
    const events = [], OBSERVE = () => {}, OTHER = () => {};
    const ps = ['p1', 'p2'].map(name => ({name, session: 'old-' + name,
        page: {waitForFunction: async () => events.push(name + ':wait-connected')},
        observe: async fn => { events.push(name + ':original-observe'); return fn === OTHER ? 'other' : 'legacy'; }}));
    const originals = ps.map(p => p.observe);
    const capture = {
        terminal: async () => true,
        snapshot: async (p, boundary) => {
            events.push(p.name + ':' + boundary);
            return {participant: p.name, session: p.session, gameId: 'game', recipientSlot: ps.indexOf(p) + 1, raw: {untouched: true}};
        },
        persistence: async (boundary, id) => events.push('db:' + boundary + ':' + id),
        pair: async boundary => {
            const rows = [];
            for (const p of ps) rows.push(await capture.snapshot(p, boundary));
            await capture.persistence(boundary, 'game'); return rows;
        }
    };
    if (diagnostics) capture.diagnostic = async (p,boundary) => events.push(p.name+':diagnostic-'+boundary);
    const reconnect = {reconnect: async p => { events.push(p.name + ':real-reconnect'); if(reconnectFailure) throw reconnectFailure; p.session = 'new-' + p.name; return 7; }};
    const browser = {run: async (c, out, check, t, hooks) => {
        events.push('original-browser-run'); await hooks.connected({ps}); return 9;
    }};
    const next = {run: async (ctx, mode, check) => {
        events.push('original-next-run:' + mode);
        const before = await ps[0].observe(OBSERVE);
        events.push('original-authenticated-replay-location');
        if (fail) throw Error('dispatch failed');
        const after = await ps[0].observe(OBSERVE);
        check('late-active-receipt-no-change', before, after);
        assert.equal(await ps[0].observe(OBSERVE), 'legacy');
        assert.equal(await ps[0].observe(OTHER), 'other');
        events.push('original-ac3-assertions'); return 11;
    }};
    wire({browser, next, reconnect, OBSERVE, recorder: () => capture});
    const connect = () => browser.run({id: 'case'}, '/unused', null, null,
        {connected: async () => events.push('original-connected-hook')});
    return {ps, events, originals, browser, next, reconnect, connect};
}

test('source wiring brackets the original replay with both participants and read-only persistence', async () => {
    const f = fixture(); assert.equal(await f.connect(), 9);
    let assertions = 0;
    assert.equal(await f.next.run({ps: f.ps}, 'coop', (id, before, after) => {
        assertions++; assert.equal(id, 'late-active-receipt-no-change'); assert.deepEqual(after, before);
        assert.deepEqual(before.passive.map(r => r.participant), ['p1', 'p2']);
    }), 11);
    assert.equal(assertions, 1);
    assert.deepEqual(f.events, ['original-browser-run', 'original-connected-hook', 'original-next-run:coop',
        'p1:replay-before', 'p2:replay-before', 'db:replay-before:game',
        'original-authenticated-replay-location', 'p1:replay-after', 'p2:replay-after', 'db:replay-after:game',
        'p1:original-observe', 'p1:original-observe', 'original-ac3-assertions']);
    assert.equal(f.ps[0].observe, f.originals[0]);
});

test('source wiring records each terminal reconnect with a new page session', async () => {
    const f = fixture(); await f.connect(); f.events.length = 0;
    for (const p of f.ps) assert.equal(await f.reconnect.reconnect(p, {}), 7);
    assert.deepEqual(f.events, ['p1', 'p2'].flatMap(p => [p + ':reconnect-before', 'db:reconnect-before:game',
        p + ':real-reconnect', p + ':wait-connected', p + ':reconnect-after', 'db:reconnect-after:game']));
});

test('source wiring restores observers and propagates replay failures', async () => {
    const f = fixture({fail: true}); await f.connect();
    await assert.rejects(f.next.run({ps: f.ps}, 'coop', () => assert.fail()), /dispatch failed/);
    assert.equal(f.ps[0].observe, f.originals[0]);
    assert(!f.events.includes('p1:replay-after'));
});

test('source wiring rejects next-game entry without provider connection', async () => {
    const f = fixture();
    await assert.rejects(f.next.run({ps: f.ps}, 'coop', () => {}), /connected hook required/);
});

test('real provider module wiring loads before reconnect consumers without launching services', () => {
    const {spawnSync} = require('node:child_process');
    const r = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        require('./ops/terminal_ac2_provider').install();
        const h = '/root/diplomacy_server/tests/reliability/helpers/';
        const browser = require(h + 'crisis-cleanup-browser');
        assert.equal(typeof browser.__ac2OriginalRun, 'function');
        assert.notEqual(browser.run, browser.__ac2OriginalRun);
        assert.match(require(h + 'movement-identity-reconnect').reconnect.toString(), /reconnect-before/);
        assert.match(require(h + 'terminal-flow-next-game').run.toString(), /replay-before/);
        console.log('PASS actual provider exports wired; no services launched');
    `], {cwd: '/root/diplomacy', encoding: 'utf8', timeout: 30000});
    process.stdout.write(r.stdout); process.stderr.write(r.stderr);
    assert.equal(r.status, 0, r.stderr);
});

test('source recorder waits for ordinary terminal delivery when persistence is ahead of the page', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-ac2-wiring-'));
    try {
        const file = path.join(dir, 'fixture.json'); fs.writeFileSync(file, '{}\n');
        const calls = [], gameId = 'fb2291ee-a285-4743-bd01-0e6b41c07efe';
        const service = {databaseName: 'fixture', mongo: {db(name) {
            assert.equal(name, 'fixture');
            return {collection(name) {
                assert.equal(name, 'games');
                return {async findOne(query) {
                    assert.deepEqual(query, {gameID: gameId}); calls.push('read');
                    return {rounds: [[{parallelTurnResult: {gameSettings: {coop: {result: 'defeat'}}}}]]};
                }};
            }};
        }}};
        const p = {page: {evaluate: async () => ({ended: false, gameId}),
            waitForFunction: async (_, args, options) => { assert.equal(options.timeout, 60000); calls.push('wait'); }}};
        const capture = createRecorder({ps: [p], service, trace() {}, dir, fixtureFile: file});
        assert.equal(await capture.terminal(p), true);
        assert.deepEqual(calls, ['read', 'wait']);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});


test('reconnect diagnostic precedes failure propagation and preserves original error', async () => {
    const error = new Error('reconnect slot had no observed effect');
    const f = fixture({reconnectFailure:error,diagnostics:true});
    await f.connect(); f.events.length=0;
    await assert.rejects(f.reconnect.reconnect(f.ps[0], {}), e=>e===error);
    assert.deepEqual(f.events,['p1:reconnect-before','db:reconnect-before:game',
        'p1:diagnostic-before','p1:real-reconnect','p1:diagnostic-failure']);
    assert(!f.events.some(e=>e.includes('reconnect-after')));
});
