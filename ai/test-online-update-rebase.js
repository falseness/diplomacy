'use strict';
// Source-level merge checks. Protocol and UI claims belong to the real browser
// movement-updates suite; this VM only exercises the shipped pure merge helper.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function run(check = (id, expected, observed) => assert.deepEqual(observed, expected, id)) {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../options/onlineLogic.js'), 'utf8'), context);
    const merge = (base, local, remote) => {
        context.input = structuredClone({base, local, remote});
        return JSON.parse(vm.runInContext('JSON.stringify(rebaseOnlineValue(input.base, input.local, input.remote))', context));
    };
    for (const name of ['noob', 'normchel', 'KOHb', 'archer', 'catapult']) {
        const base = {players: [{units: [{name, coord: {x: 1, y: 1}, moves: 2, hp: 2}]},
            {units: [{name, coord: {x: 8, y: 8}, moves: 2, hp: 2}]}], grid: [[1, 0], [0, 2]]};
        const local = structuredClone(base), remote = structuredClone(base);
        local.players[0].units[0].coord.y = 2;
        local.players[0].units[0].moves = 1;
        local.grid[0][1] = 1;
        remote.players[1].units[0].coord.y = 7;
        remote.players[1].units[0].moves = 1;
        remote.grid[1][0] = 2;
        const expected = {players: [local.players[0], remote.players[1]], grid: [[1, 1], [2, 2]]};
        check(`source/${name}/disjoint-moves-and-paint`, expected, merge(base, local, remote));
        check(`source/${name}/repeated-authority`, expected, merge(remote, expected, remote));
    }
    const entity = (x, hp = 2) => ({coord: {x, y: 1}, hp});
    check('source/entity-death-and-birth', [entity(2), entity(3)],
        merge([entity(1), entity(2)], [entity(2)], [entity(1), entity(2), entity(3)]));
    check('source/two-disjoint-entity-edits', [entity(1, 1), entity(2, 1)],
        merge([entity(1), entity(2)], [entity(1, 1), entity(2)], [entity(1), entity(2, 1)]));
    check('source/authoritative-conflict-wins', {gold: 7}, merge({gold: 10}, {gold: 8}, {gold: 7}));
    const base = [{units: [{x: 1, y: 1}], towns: []}, {units: [{x: 8, y: 8}], towns: []}];
    const historical = [{units: [{x: 1, y: 2}], towns: []}, base[1]];
    const remote = [base[0], {units: [{x: 8, y: 7}], towns: []}];
    check('source/undo-registry-keeps-earlier-local-and-new-peer', [historical[0], remote[1]], merge(base, historical, remote));
}
if (require.main === module) {
    run((id, expected, observed) => { assert.deepEqual(observed, expected, id); console.log('PASS ' + id); });
}
module.exports = {run};
