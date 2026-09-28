'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const S = require('./inspect_terminal_scope');
const source = Object.fromEntries(['options/dictionaryToList.js', 'options/gamestart.js']
    .map(n => [n, fs.readFileSync(path.join(__dirname, '..', n), 'utf8')]));

test('shipped two-human map definitions reject the larger default and accept the smallest dimensions', () => {
    const maps = S.competitiveMaps(source);
    const small = S.compareSize(maps, {size: {x: 20, y: 10}});
    assert.equal(small.pass, true);
    assert.deepEqual(small.expected.map(m => m.name), ['tiny deathmatch']);
    assert.equal(S.compareSize(maps, {size: {x: 21, y: 21}}).pass, false);
    assert.throws(() => S.compareSize([], {size: {x: 20, y: 10}}), /supported two-human maps/);
});

// Synthetic corruption controls prove checker behavior only, never gameplay.
function trace() {
    const terminal = {gameID: 'old'};
    return [{stage: 'mongo-terminal', stored: terminal}, {stage: 'ac3-passive', kind: 'persistence',
        boundary: 'first-move-before', mode: 'competitive', documents: [terminal,
            {gameID: 'new', rounds: [[{parallelTurnResult: {gameSettings: {isOnline: true},
                players: [{}, {}, {}], grid: [[0, 0], [0, 0]]}}]]}]}];
}
test('new-board selection rejects missing, duplicate, wrong-mode and altered old-game records', () => {
    assert.deepEqual(S.nextBoard(trace()), {gameID: 'new', size: {x: 2, y: 2}});
    assert.throws(() => S.nextBoard(trace().slice(0, 1)), /boundary count/);
    assert.throws(() => S.nextBoard([...trace(), trace()[1]]), /boundary count/);
    const wrong = trace(); wrong[1].mode = 'coop';
    assert.throws(() => S.nextBoard(wrong), /boundary mode/);
    const changed = trace(); changed[1].documents[0] = {gameID: 'old', changed: true};
    assert.throws(() => S.nextBoard(changed), /preserved terminal document/);
    const board = trace(); board[1].documents[1].rounds[0][0].parallelTurnResult.gameSettings.coop = {};
    assert.throws(() => S.nextBoard(board), /competitive new board/);
});
test('proof reader rejects changed, missing, unbound and escaping files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-scope-'));
    try {
        const file = path.join(dir, 'proof'); fs.writeFileSync(file, 'original');
        const sha = crypto.createHash('sha256').update('original').digest('hex');
        assert.equal(S.boundRead(dir, 'proof', {proof: sha}), 'original');
        assert.throws(() => S.boundRead(dir, 'proof', {}), /missing proof binding/);
        fs.writeFileSync(file, 'changed');
        assert.throws(() => S.boundRead(dir, 'proof', {proof: sha}), /changed proof/);
        fs.unlinkSync(file);
        assert.throws(() => S.boundRead(dir, 'proof', {proof: sha}), /ENOENT/);
        fs.symlinkSync(__filename, file);
        assert.throws(() => S.boundRead(dir, 'proof', {proof: sha}), /proof escape/);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
