'use strict';
const assert = require('node:assert/strict');

// Independent interpretation of passive storage. Policy comes from the declared
// initial fixture, never from a captured expected/observed assertion. This module
// does not authenticate the policy, packets, persistence or execution lifecycle.
function deriveTerminalState(snapshot, policy) {
    assert.equal(snapshot.schema, 'terminal-page-v1');
    const s = snapshot.state;
    const list = (value, label) => {
        assert(value && Array.isArray(value.items), 'missing ' + label);
        return value.items;
    };
    const players = list(s.players, 'players');
    assert(players.length >= 2, 'player count');
    assert.equal(policy.neutralSlot, 0, 'neutral slot');
    assert(['coop', 'competitive'].includes(policy.mode), 'mode');
    if (policy.mode === 'coop') {
        assert(Number.isSafeInteger(policy.demonSlot) && policy.demonSlot > 0 && policy.demonSlot < players.length, 'demon slot');
    }
    const identities = new Map();
    const positiveID = id => assert(Number.isSafeInteger(id) && id > 0, 'identity required');
    const entity = row => {
        positiveID(row.identity);
        if (identities.has(row.identity)) assert.deepEqual(row, identities.get(row.identity), 'inconsistent identity alias');
        else identities.set(row.identity, row);
    };
    const grid = list(s.grid, 'grid').map(c => list(c, 'grid column'));
    assert(grid.length && grid.every(c => c.length === grid[0].length && c.length), 'rectangular grid');
    const at = coord => {
        assert(Number.isSafeInteger(coord?.x) && Number.isSafeInteger(coord?.y), 'coordinate required');
        const cell = grid[coord.x]?.[coord.y];
        assert(cell, 'coordinate outside grid');
        return cell;
    };
    const playerIDs = new Set();
    for (const p of players) {
        positiveID(p.identity);
        assert(!playerIDs.has(p.identity), 'duplicate player identity'); playerIDs.add(p.identity);
        assert(Number.isFinite(p.gold), 'gold required');
        for (const key of ['units', 'towns']) for (const row of list(p[key], key)) {
            entity(row);
            assert.equal(typeof row.name, 'string', 'entity name required');
            assert.equal(typeof row.killed, 'boolean', 'killed required');
            assert(Number.isFinite(row.hp), 'hp required');
            if (key === 'units') assert(Number.isFinite(row.moves), 'moves required');
            at(row.coord);
        }
    }
    for (const [x, column] of grid.entries()) for (const [y, cell] of column.entries()) {
        assert(Number.isSafeInteger(cell.hexagon?.playerColor) && cell.hexagon.playerColor >= 0 &&
            cell.hexagon.playerColor < players.length, 'owner slot required');
        assert.equal(typeof cell.hexagon.isSuburb, 'boolean', 'suburb flag required');
        for (const key of ['unit','building']) {
            entity(cell[key]);
            // Empty and unplaced production storage legitimately lack a name.
            if (typeof cell[key].name === 'string' && cell[key].killed === false)
                assert.deepEqual(cell[key].coord, {x,y}, 'live occupant coordinate');
        }
    }
    const living = players.map((p, slot) => {
        const units = p.units.items.filter(u => !u.killed);
        // Production isLost prunes killed units, not zero-HP units; keep that
        // distinction. Town ownership comes from its coordinate's raw hexagon.
        const towns = p.towns.items.filter(t => !t.killed && at(t.coord).hexagon.playerColor === slot);
        for (const [rows, key] of [[units,'unit'],[towns,'building']]) for (const row of rows)
            assert.equal(at(row.coord)[key].identity, row.identity, 'live registry occupancy');
        return {slot, units:units.length, towns:towns.length, lost:units.length === 0 && towns.length === 0};
    });
    let result = null, ended;
    if (policy.mode === 'coop') {
        const humans = living.filter(p => p.slot !== 0 && p.slot !== policy.demonSlot);
        assert(humans.length, 'human slots required');
        const external = list(snapshot.extended.external, 'external');
        for (const row of external) {
            assert.equal(typeof row.name, 'string', 'external name required');
            assert.equal(typeof row.killed, 'boolean', 'external killed required');
            assert(Number.isFinite(row.hp), 'external hp required');
        }
        const humansGone = humans.every(p => p.lost);
        const enemiesGone = !external.some(p => p.name === 'demonPortal' && !p.killed && p.hp > 0) &&
            !players[policy.demonSlot].units.items.some(u => !u.killed && u.hp > 0);
        result = humansGone ? (enemiesGone ? 'draw' : 'defeat') : (enemiesGone ? 'victory' : null);
        ended = result !== null;
    } else ended = living.slice(1).every(p => p.lost);
    return {living, result, ended, gold:players.map(p => p.gold)};
}

function reviewTerminalState(snapshot, policy) {
    const derived = deriveTerminalState(snapshot, policy);
    assert(derived.ended, 'terminal condition not reached');
    assert.equal(snapshot.state.result, derived.result, 'stored result disagrees with raw outcome');
    assert.equal(snapshot.state.waiting, true, 'terminal waiting');
    assert.equal(snapshot.state.next.canClick, false, 'terminal next disabled');
    assert.equal(snapshot.state.undo.canClick, false, 'terminal undo disabled');
    assert.equal(snapshot.state.timer.isTick, false, 'terminal timer stopped');
    return {pass:true, derived, wholeCriterionCredit:false};
}
module.exports = {deriveTerminalState, reviewTerminalState};
