'use strict';
const assert = require('node:assert/strict');

// Independent source-tier boundary checker, not a whole AC2/AC3 coverage row.
// A hash binding authenticates bytes, never substitutes for these semantics.
function complete(value, path = '$') {
    assert(value !== undefined, 'missing ' + path);
    if (!value || typeof value !== 'object') return;
    assert(!Object.hasOwn(value, 'unavailable'), 'unavailable ' + path + ': ' + value.unavailable);
    for (const [key, child] of Object.entries(value)) complete(child, path + '.' + key);
}
function reviewBoundary(record, {callbacks = false} = {}) {
    assert.equal(record.tier, callbacks ? 'source-executed-callbacks' : 'captured-network-replay');
    assert.equal(typeof record.session, 'string');
    assert(record.session.length > 0);
    assert.equal(record.beforeSession, record.session, 'before page session');
    assert.equal(record.afterSession, record.session, 'after page session');
    for (const side of ['before', 'after']) {
        const snapshot = record[side];
        complete(snapshot);
        assert.equal(snapshot.schema, 'terminal-page-v1');
        for (const key of ['players', 'grid', 'result', 'waiting', 'next', 'undo', 'commit', 'socket',
            'oldSocket', 'timer', 'oldTimer', 'timerStorage', 'whooseTurn', 'gameRound', 'gameSlot', 'undoLength'])
            assert(Object.hasOwn(snapshot.state, key), 'missing state.' + key);
        for (const key of ['towns', 'external', 'externalProduction', 'nature', 'goldmines'])
            assert(Array.isArray(snapshot.extended[key]?.items), 'missing registry ' + key);
        assert.equal(typeof snapshot.ui.menu, 'boolean');
        assert.equal(typeof snapshot.ui.pause, 'boolean');
        assert.equal(typeof snapshot.state.waiting, 'boolean');
        assert.equal(typeof snapshot.state.next.canClick, 'boolean');
        assert.equal(typeof snapshot.state.undo.canClick, 'boolean');
        assert.equal(typeof snapshot.state.timer.isTick, 'boolean');
    }
    assert.deepEqual(record.after, record.before, 'raw boundary state changed');
    if (callbacks) {
        const events = ['gameStarted', 'playYourTurn', 'waitYouTurn'];
        assert(Array.isArray(record.retained) && Array.isArray(record.invoked));
        for (const event of events) {
            const rows = record.retained.filter(row => row.event === event);
            assert(rows.length > 0, 'empty retained event: ' + event);
            rows.forEach((row, i) => assert.equal(row.index, i));
        }
        assert(record.retained.every(row => events.includes(row.event)));
        assert.deepEqual(record.invoked, record.retained.map(row => ({...row, returned: true})), 'callback invocation receipts');
        const s = record.before.state;
        assert.equal(s.oldSocket.connected, false);
        assert.equal(s.oldTimer.isTick, false);
        assert.notEqual(s.oldSocket.identity, s.socket.identity, 'replacement socket');
        assert.notEqual(s.oldTimer.identity, s.timer.identity, 'replacement timer');
    } else {
        assert.equal(record.before.state.waiting, true);
        assert.equal(record.before.state.next.canClick, false);
        assert.equal(record.before.state.undo.canClick, false);
        assert.equal(record.before.state.timer.isTick, false);
        assert.equal(record.dispatch.confirmed, true);
        assert.equal(record.dispatch.packet, record.captured.packet);
        assert(record.captured.packet.startsWith('42['));
    }
    return {pass: true, tier: record.tier, wholeCriterionCredit: false};
}
module.exports = {complete, reviewBoundary};
