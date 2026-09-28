'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createTerminalCapture} = require('./terminal_passive_capture');

function fixture() {
    // Execute full production definitions. Construct declared source fixtures
    // without invoking rendering constructors; these are not browser evidence.
    const ctx = vm.createContext({});
    const files = ['player.js', 'sprites/sprite.js', 'sprites/entities/entity.js',
        'sprites/entities/units/unit/unit.js', 'sprites/empty.js', 'options/timer.js'];
    vm.runInContext(files.map(f => fs.readFileSync(f, 'utf8')).join('\n') +
        '\nglobalThis.types = {Player, Unit, Empty, Timer};', ctx);
    const {Player, Unit, Empty, Timer} = ctx.types;
    const unit = Object.assign(Object.create(Unit.prototype), {name: 'noob', hp: 0, killed: true,
        wasHitted: true, coord: {x: 0, y: 0}, interaction: {moves: 0}});
    const town = {name: 'town', hp: 0, killed: true, coord: {x: 0, y: 0}};
    const p = Object.assign(Object.create(Player.prototype), {gold: 17, units: [unit, unit], towns: [town]});
    const timer = Object.assign(Object.create(Timer.prototype), {time: 900, lastPause: 123, isTick: false});
    const root = {players: [p], grid: {arr: [[{hexagon: {playerColor: 0, isSuburb: true}, unit, building: town},
        {hexagon: {playerColor: 0, isSuburb: false}, unit: new Empty(), building: new Empty()}]]},
        gameSettings: {coop: {result: 'defeat'}}, gameEvent: {waitingMode: true},
        nextTurnButton: {canClick: false, unactive: false}, undoButton: {canClick: false},
        actionManager: {arr: []}, whooseTurn: 0, gameRound: 2, gameSlot: 'test', onlineCommit: {gameID: 1, revision: 3},
        onlineSocket: {id: 'socket-test', connected: true}, oldSocket: null, timer, oldTimer: null,
        timerStorage: ['{"time":900,"enable":true,"type":"classic"}']};
    return {root, p, unit, town, timer};
}

// Snapshot descriptors and references, without invoking any gameplay getters.
function descriptors(root) {
    const found = new Map();
    function visit(value) {
        if (!value || typeof value !== 'object' || found.has(value)) return;
        const ds = Object.getOwnPropertyDescriptors(value);
        found.set(value, ds);
        for (const d of Object.values(ds)) if ('value' in d) visit(d.value);
    }
    visit(root);
    return found;
}

test('production prototypes: raw killed and duplicate registries survive capture unchanged', () => {
    const {root, unit, p} = fixture(), capture = createTerminalCapture();
    const before = descriptors(root), result = capture(root);
    assert.deepEqual(descriptors(root), before);
    assert.equal(p.units[0], unit);
    assert.equal(result.players.items[0].units.items.length, 2);
    assert.equal(result.players.items[0].units.items[0].identity, result.players.items[0].units.items[1].identity);
    assert.equal(result.grid.items[0].items[0].unit.identity, result.players.items[0].units.items[0].identity);
    assert.equal(result.players.items[0].units.items[0].killed, true);
    assert.equal(result.players.items[0].units.items[0].moves, 0);
    assert.equal(result.result, 'defeat');
    assert.deepEqual(capture(root), result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('throwing mutation getters, methods and toJSON are never invoked', () => {
    const {root, p, unit, timer} = fixture();
    for (const obj of [p, unit, timer]) {
        for (const key of ['isLost', 'isGameEnded', 'playerColor', 'player', 'role', 'team', 'moves', 'timeLeft', 'timerText'])
            Object.defineProperty(obj, key, {get() { throw Error('forbidden getter ' + key); }});
        for (const key of ['toJSON', 'updateUnits', 'updateTowns', 'getGameObject', 'check'])
            obj[key] = () => { throw Error('forbidden method ' + key); };
    }
    const before = descriptors(root);
    const result = createTerminalCapture()(root);
    assert.equal(result.players.items[0].gold, 17);
    assert.equal(result.timer.time, 900);
    assert.deepEqual(descriptors(root), before);
    JSON.stringify(result);
});

test('same-content replacement and duplicate/swapped grid identities remain observable', () => {
    const {root, unit, p} = fixture(), capture = createTerminalCapture();
    const before = capture(root);
    p.units[0] = {...unit};
    const after = capture(root);
    assert.notEqual(before.players.items[0].units.items[0].identity, after.players.items[0].units.items[0].identity);
    assert.equal(after.grid.items[0].items[0].unit.identity, before.grid.items[0].items[0].unit.identity);
    root.grid.arr[0][0].unit = p.units[0];
    assert.notDeepEqual(capture(root), after);
});

test('resumed turn, income, resurrection, enabled control and ownership changes are retained', () => {
    const mutations = [r => r.whooseTurn++, r => r.gameRound++, r => r.players[0].gold++,
        r => r.players[0].units[0].killed = false, r => r.nextTurnButton.canClick = true,
        r => r.undoButton.canClick = true, r => r.timer.isTick = true,
        r => r.grid.arr[0][0].hexagon.playerColor = 1, r => r.gameSettings.coop.result = 'draw',
        r => r.onlineCommit.revision++, r => r.players[0].units[0].interaction.moves++,
        r => r.players[0].units[0].hp++, r => r.timerStorage[0] = '{"time":901}'];
    for (const mutate of mutations) {
        const {root} = fixture(), capture = createTerminalCapture(), before = capture(root);
        mutate(root);
        assert.notDeepEqual(capture(root), before);
    }
});

test('old socket and timer identity, connection and tick state persist across replacement', () => {
    const {root} = fixture(), capture = createTerminalCapture(), before = capture(root);
    root.oldSocket = root.onlineSocket; root.oldSocket.connected = false;
    root.oldTimer = root.timer;
    root.onlineSocket = {id: 'new-socket', connected: true};
    root.timer = {...root.timer};
    const after = capture(root);
    assert.equal(after.oldSocket.identity, before.socket.identity);
    assert.equal(after.oldTimer.identity, before.timer.identity);
    assert.equal(after.oldSocket.connected, false);
    assert.equal(after.oldTimer.isTick, false);
    assert.notEqual(after.socket.identity, before.socket.identity);
    assert.notEqual(after.timer.identity, before.timer.identity);
});

test('accessor fields, sparse registries, nonfinite scalars and missing timer slots fail closed', () => {
    for (const mutate of [r => Object.defineProperty(r.players[0], 'gold', {get() { throw Error('invoked'); }}),
        r => delete r.players[0].units[0], r => r.players[0].gold = NaN,
        r => r.timerStorage.pop(), r => r.timerStorage[0] = {}]) {
        const {root} = fixture(); mutate(root);
        assert.throws(() => createTerminalCapture()(root), /accessor refused|sparse array|finite scalar|timer slot|raw timer/);
    }
});

test('factory is self-contained for page evaluation and leaks no gameplay objects', () => {
    const factory = vm.runInNewContext('(' + createTerminalCapture.toString() + ')');
    const {root} = fixture();
    const result = factory()(root);
    result.players.items[0].units.items[0].coord.x = 77;
    assert.equal(root.players[0].units[0].coord.x, 0);
    assert.equal(result.next.canClick, false);
    assert.equal(result.next.unactive, false);
});
