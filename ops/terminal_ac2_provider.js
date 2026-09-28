'use strict';

// Optional acquisition instrumentation for the existing terminal-flow provider.
// No gameplay rules, input actions, packet delivery, or assertions are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createTerminalCapture} = require('./terminal_passive_capture');
const {installTerminalPageCapture} = require('./terminal_page_capture');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const installExpression = `(${installTerminalPageCapture})(${createTerminalCapture})`;

function createRecorder({ps, service, trace, dir, fixtureFile}) {
    const sessions = new WeakMap();
    let sequence = 0;
    const fixtureSha256 = hash(fs.readFileSync(fixtureFile));
    const emit = record => {
        const row = {schema: 'terminal-ac2-capture-v1', sequence: ++sequence,
            caseId: path.basename(dir), fixtureSha256, ...record};
        // Use the provider's redactor for persisted documents and network IDs.
        trace('ac2-passive', row);
        return row;
    };
    async function readDocument(gameId) {
        assert.equal(typeof gameId, 'string', 'passive game ID required');
        const {ObjectId} = require('node:module')
            .createRequire('/root/diplomacy_server/server/index.js')('mongodb');
        return service.mongo.db(service.databaseName).collection('games')
            .findOne({_id: new ObjectId(gameId)});
    }
    async function terminal(p) {
        const current = await p.page.evaluate(() => ({
            ended: typeof gameSettings !== 'undefined' && !!gameSettings.coop?.result,
            gameId: typeof onlineCommit !== 'undefined' ? onlineCommit?.gameID : null
        }));
        if (current.ended) return true;
        if (!current.gameId) return false;
        // The provider can observe a committed terminal DB before the browser
        // receives that commit. Wait for its ordinary delivery before reload;
        // otherwise a race could silently omit the terminal before-boundary.
        const doc = await readDocument(current.gameId);
        if (!doc?.rounds.at(-1)?.[0]?.parallelTurnResult?.gameSettings?.coop?.result) return false;
        await p.page.waitForFunction(() => !!gameSettings.coop?.result, null, {timeout: 60000});
        return true;
    }
    async function snapshot(p, boundary) {
        const installed = await p.page.evaluate(() => Object.hasOwn(globalThis, '__terminalPassive'));
        if (!installed) {
            await p.page.evaluate(installExpression);
            sessions.set(p.page, crypto.randomUUID());
        }
        assert(sessions.has(p.page), 'unowned passive page session');
        const raw = await p.page.evaluate(() => globalThis.__terminalPassive.read());
        return emit({kind: 'page', boundary, participant: p.name,
            session: sessions.get(p.page), gameId: raw.state.commit?.gameID,
            recipientSlot: raw.state.whooseTurn, raw});
    }
    async function persistence(boundary, gameId) {
        // Read only; use the exact game ID captured from the authenticated page.
        const stored = await readDocument(gameId);
        assert(stored, 'passive persisted game required');
        return emit({kind: 'persistence', boundary, gameId, stored});
    }
    async function pair(boundary) {
        const rows = [];
        for (const p of ps) rows.push(await snapshot(p, boundary));
        assert.equal(new Set(rows.map(r => r.gameId)).size, 1, 'shared passive game');
        await persistence(boundary, rows[0].gameId);
        return rows;
    }
    return {snapshot, persistence, pair, terminal};
}

// Dependencies are injectable for source-tier wiring tests. Production passes
// the actual existing modules, retaining their authenticated network lifecycle.
function wire({browser, next, reconnect, OBSERVE, recorder = createRecorder}) {
    const contexts = new WeakMap();
    const originalRun = browser.run;
    const originalReconnect = reconnect.reconnect;
    const originalNext = next.run;
    reconnect.reconnect = async function(p, options) {
        const capture = contexts.get(p);
        const isTerminal = capture && await capture.terminal(p);
        const before = isTerminal ? await capture.snapshot(p, 'reconnect-before') : null;
        if (before) await capture.persistence('reconnect-before', before.gameId);
        const result = await originalReconnect(p, options);
        if (before) {
            await p.page.waitForFunction(() => onlineSocket.connected &&
                !menu.visible && !!gameSettings.coop?.result, null, {timeout: 60000});
            const after = await capture.snapshot(p, 'reconnect-after');
            assert.notEqual(after.session, before.session, 'reconnect creates a new page session');
            assert.equal(after.gameId, before.gameId, 'reconnect preserves game binding');
            assert.equal(after.recipientSlot, before.recipientSlot, 'reconnect preserves recipient');
            await capture.persistence('reconnect-after', after.gameId);
        }
        return result;
    };
    browser.run = async function(c, out, check, t, hooks = {}) {
        const connected = hooks.connected;
        const wrapped = {...hooks, connected: async ctx => {
            if (connected) await connected(ctx);
            const dir = path.join(out, c.id);
            const capture = recorder({...ctx, dir, fixtureFile: path.join(dir, 'declared-fixture.json')});
            for (const p of ctx.ps) contexts.set(p, capture);
        }};
        return originalRun(c, out, check, t, wrapped);
    };
    next.run = async function(ctx, mode, check) {
        const p = ctx.ps[0], capture = contexts.get(p);
        assert(capture, 'terminal provider connected hook required');
        const observe = p.observe;
        let reads = 0;
        // The first two OBSERVE calls in the pinned next-game helper are the
        // existing replay before/after assertion. Replace only those reads;
        // retain its actual packet dispatch and all subsequent AC3 assertions.
        p.observe = async function(fn, ...args) {
            if (fn !== OBSERVE || reads >= 2) return observe.call(this, fn, ...args);
            const boundary = reads++ === 0 ? 'replay-before' : 'replay-after';
            const rows = await capture.pair(boundary);
            return {passive: rows.map(({participant, session, gameId, recipientSlot, raw}) =>
                ({participant, session, gameId, recipientSlot, raw}))};
        };
        try {
            const result = await originalNext(ctx, mode, check);
            assert.equal(reads, 2, 'both pinned replay reads executed');
            return result;
        } finally { p.observe = observe; }
    };
    return {contexts};
}

function install() {
    const root = '/root/diplomacy_server/tests/reliability/helpers/';
    // Fail closed if the location/order of the two replaced reads changes.
    const nextFile = root + 'terminal-flow-next-game.js';
    assert.equal(hash(fs.readFileSync(nextFile)),
        '31eff97d53f66a02be409405456c70e65397fdd029327f3d357ca861769d79e8',
        'unreviewed terminal provider: replay read positions');
    // Reconnect must be wrapped BEFORE consumers destructure its export.
    const reconnect = require(root + 'movement-identity-reconnect');
    assert(!require.cache[require.resolve(root + 'crisis-cleanup-browser')], 'provider loaded before capture preload');
    assert(!require.cache[require.resolve(root + 'terminal-flow-flood')], 'flood loaded before capture preload');
    const next = require(nextFile);
    // Defer loading browser until wire replaces reconnect's export.
    const browser = {run: (...args) => require(root + 'crisis-cleanup-browser').__ac2OriginalRun(...args)};
    wire({browser, next, reconnect, OBSERVE: require(root + 'observation-game').OBSERVE});
    const actual = require(root + 'crisis-cleanup-browser');
    actual.__ac2OriginalRun = actual.run;
    actual.run = browser.run;
}

if (process.env.TERMINAL_AC2_CAPTURE === '1' &&
    path.basename(process.argv[1] || '') === 'terminal-flow.test.js') install();
module.exports = {wire, createRecorder, install};
