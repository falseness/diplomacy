'use strict';
// A saved-evidence sufficiency check, not an AC7 reviewer or a coverage gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function boundRead(root, name, manifest) {
    assert(typeof manifest[name] === 'string', 'missing proof binding: ' + name);
    const base = fs.realpathSync(root), file = fs.realpathSync(path.join(base, name));
    const relative = path.relative(base, file);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'proof escape');
    const bytes = fs.readFileSync(file);
    assert.equal(hash(bytes), manifest[name], 'changed proof: ' + name);
    return bytes.toString();
}

function competitiveMaps(sources) {
    // Execute the shipped constructors and literal map definitions unchanged.
    // No game, network handler, board fixture or browser is constructed here.
    const context = vm.createContext({});
    for (const name of ['options/dictionaryToList.js', 'options/gamestart.js']) {
        assert(typeof sources[name] === 'string', 'missing map source');
        vm.runInContext(sources[name], context, {filename: name, timeout: 1000});
    }
    return JSON.parse(vm.runInContext(`JSON.stringify(Object.entries(maps).flatMap(
        ([name, variants]) => variants.filter(m => !m.coop && m.players.length === 3)
            .map(m => ({name, size: m.mapSize, humans: m.players.length - 1}))))`,
    context, {timeout: 1000}));
}

function nextBoard(trace) {
    const one = (rows, label) => { assert.equal(rows.length, 1, label); return rows[0]; };
    const terminal = one(trace.filter(r => r.stage === 'mongo-terminal'), 'terminal record count').stored;
    assert(typeof terminal?.gameID === 'string', 'terminal identity');
    const boundary = one(trace.filter(r => r.stage === 'ac3-passive' &&
        r.kind === 'persistence' && r.boundary === 'first-move-before'), 'next-game boundary count');
    assert.equal(boundary.mode, 'competitive', 'boundary mode');
    assert.equal(boundary.documents.length, 2, 'two persisted games');
    assert.deepEqual(one(boundary.documents.filter(d => d.gameID === terminal.gameID),
        'preserved terminal count'), terminal, 'preserved terminal document');
    const fresh = one(boundary.documents.filter(d => d.gameID !== terminal.gameID), 'new game count');
    assert(typeof fresh.gameID === 'string', 'new identity');
    const board = fresh.rounds?.[0]?.[0]?.parallelTurnResult;
    assert(board && !board.gameSettings?.coop, 'competitive new board');
    assert(board.gameSettings?.isOnline === true, 'online new board');
    assert.equal(board.players.length, 3, 'two humans plus neutral');
    assert(Array.isArray(board.grid) && board.grid.length > 0, 'grid columns');
    const height = board.grid[0].length;
    assert(height > 0 && board.grid.every(c => Array.isArray(c) && c.length === height), 'rectangular grid');
    return {gameID: fresh.gameID, size: {x: board.grid.length, y: height}};
}

function compareSize(maps, observed) {
    assert(maps.length > 0, 'supported two-human maps');
    for (const m of maps) assert(m.humans === 2 && Number.isInteger(m.size.x) &&
        Number.isInteger(m.size.y) && m.size.x > 0 && m.size.y > 0, 'valid map dimensions');
    const area = size => size.x * size.y;
    const minimum = Math.min(...maps.map(m => area(m.size)));
    const smallest = maps.filter(m => area(m.size) === minimum);
    return {expected: smallest, observed, minimumCells: minimum, observedCells: area(observed.size),
        pass: smallest.some(m => m.size.x === observed.size.x && m.size.y === observed.size.y)};
}

function inspect(selection, clientRoot) {
    const bindings = {}, read = name => {
        const text = boundRead(selection.original, name, selection.originalFiles);
        bindings[path.join(selection.original, name)] = selection.originalFiles[name];
        return text;
    };
    const identities = JSON.parse(read('source-identities.json')), sources = {};
    for (const name of ['options/dictionaryToList.js', 'options/gamestart.js']) {
        const file = path.join(clientRoot, name), bytes = fs.readFileSync(file);
        assert.equal(identities.before.client.files[name], identities.after.client.files[name], 'stable map source');
        assert.equal(hash(bytes), identities.after.client.files[name], 'current map source: ' + name);
        bindings[file] = hash(bytes); sources[name] = bytes.toString();
    }
    const trace = read('terminal-to-competitive/network-traces.jsonl').trim().split('\n').map(JSON.parse);
    const comparison = compareSize(competitiveMaps(sources), nextBoard(trace));
    return {target: 'TASK-221/AC7', clause: 'smallest supported maps', fullInvocation: false,
        wholeCriterionCredit: false, comparison, bindings,
        finding: comparison.pass ? 'map-size-clause-only-matches' : 'saved-proof-contradicts-smallest-map-clause',
        followUp: 'Select the smallest supported competitive map through the shipped menu before the next game; acquire new persistence and UI proof. Preserve this original trace. A map-only check cannot close AC7.'};
}

if (require.main === module) {
    const [selectionFile, output] = process.argv.slice(2);
    assert(selectionFile && output, 'usage: node ops/inspect_terminal_scope.js SELECTION_JSON OUTPUT_JSON');
    const bytes = fs.readFileSync(selectionFile);
    const result = inspect(JSON.parse(bytes), path.resolve(__dirname, '..'));
    result.bindings[path.resolve(selectionFile)] = hash(bytes);
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    console.log(`${result.comparison.pass ? 'MATCH' : 'INSUFFICIENT'} TASK-221/AC7 smallest-map expectedCells=${result.comparison.minimumCells} observedCells=${result.comparison.observedCells} wholeCriterionCredit=false`);
    process.exitCode = result.comparison.pass ? 0 : 2;
}
module.exports = {boundRead, competitiveMaps, nextBoard, compareSize, inspect};
