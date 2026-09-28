'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const probe = require('./terminal_reconnect_probe_v1');
const source = fs.readFileSync(probe.FILE, 'utf8');
function driver() {
    const m = new Module(probe.FILE); m.filename = probe.FILE;
    m.paths = Module._nodeModulePaths(require('node:path').dirname(probe.FILE));
    m._compile(probe.instrument(source), probe.FILE);
    return m.exports.BrowserPlayer.prototype.settle;
}
test('probe adds only diagnostics to exact pinned driver bytes', () => {
    let actual = probe.instrument(source);
    for (const added of probe.ADDED) { assert.equal(actual.split(added).length, 2); actual = actual.replace(added, ''); }
    assert.equal(actual, source);
    assert.throws(() => probe.instrument(source + '\n'), /unreviewed browser driver/);
});
test('success retains one original eight-second predicate wait and records timing', async () => {
    const rows = [], calls = [];
    await driver().call({trace:r=>rows.push(r), page:{waitForFunction:async(...args)=>calls.push(args)}}, 'reconnect slot', '!menu.visible');
    assert.deepEqual(calls, [['!menu.visible', null, {timeout:8000,polling:50}]]);
    assert.deepEqual(rows.map(r=>r.boundary), ['before','success']);
    assert(rows[1].elapsedMs >= 0);
});
test('failure retains original error and captures underlying cause without retry', async () => {
    const rows = []; let calls = 0;
    const original = Object.assign(new Error('page.waitForFunction: Timeout 8000ms exceeded.'), {name:'TimeoutError'});
    await assert.rejects(driver().call({name:'p1',trace:r=>rows.push(r),page:{waitForFunction:async()=>{calls++;throw original;}}}, 'reconnect slot', '!menu.visible'), {message:'p1: input "reconnect slot" had no observed effect (!menu.visible)', cause:original});
    assert.equal(calls,1); assert.deepEqual(rows.map(r=>r.boundary),['before','failure']);
    assert.equal(rows[1].causeName,original.name); assert.equal(rows[1].causeMessage,original.message);
});
test('unrelated predicates and password controls retain behavior without diagnostics', async () => {
    for (const [label,until] of [['password digit [redacted]','menu.online.currentPassword.length === 1'],['reconnect slot','different predicate'],['other',null]]) {
        const rows=[],calls=[];
        await driver().call({input:'mouse',trace:r=>rows.push(r),page:{waitForFunction:async(...args)=>calls.push(args)}},label,until);
        assert.deepEqual(rows,[]);assert.equal(calls.length,until?1:0);
    }
});
test('real preload composes diagnostic driver with retained map and passive adapters', () => {
    require('node:child_process').execFileSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        process.argv[1] = '/root/diplomacy_server/tests/reliability/terminal-flow.test.js';
        require('./ops/terminal_reconnect_probe_v1');
        const root = '/root/diplomacy_server/tests/reliability/helpers/';
        assert.match(require(root+'browser-driver').BrowserPlayer.prototype.settle.toString(), /reconnect-wait/);
        assert.equal(typeof require(root+'crisis-cleanup-browser').__ac2OriginalRun, 'function');
        assert.match(require(root+'movement-identity-reconnect').reconnect.toString(), /capture/);
    `], {cwd:'/root/diplomacy', env:{...process.env, NODE_PATH:'/opt/diplomacy/node_modules', TERMINAL_MAP_CAPTURE:'1'}, stdio:'pipe'});
});
