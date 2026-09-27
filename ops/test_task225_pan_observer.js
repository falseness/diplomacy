'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {install} = require('./task225-pan-observer');

for (const failed of [false, true]) test(`pan observer preserves ${failed ? 'failure' : 'success'} and exact inputs`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task225-pan-'));
    const calls = [], failure = new Error('original pan failure');
    class Player {
        constructor() { this.name = 'p1'; }
        async observe() { calls.push('observe'); return {offset: {x: 1, y: 2}}; }
        async screenshot(label) { calls.push(label); return {file: 'original.png'}; }
        async pan(...args) { calls.push(args); if (failed) throw failure; return 42; }
    }
    const original = Player.prototype.pan, restore = install(Player, dir);
    try {
        const p = new Player(), before = {x: 0, y: 0};
        if (failed) await assert.rejects(p.pan(12, 34, before), e => e === failure);
        else assert.equal(await p.pan(12, 34, before), 42);
        assert.deepEqual(calls, ['observe', [12, 34, before],
            ...(failed ? ['pan-failure-before-cleanup'] : []), 'observe']);
        const row = JSON.parse(fs.readFileSync(path.join(dir, 'pan-observations.jsonl'), 'utf8'));
        assert.equal(row.pass, !failed);
        assert.deepEqual(row.requested, {dx: 12, dy: 34, before});
        if (failed) assert.equal(row.error, failure.message);
    } finally { restore(); fs.rmSync(dir, {recursive: true, force: true}); }
    assert.equal(Player.prototype.pan, original);
});
