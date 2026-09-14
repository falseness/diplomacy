const assert = require('assert').strict;
const {expectedMap} = require('./test-coop-generation-fixtures');
const {audit} = require('./test-coop-terrain-audit');
const {check} = require('./test-coop-portal-layout');
const {evaluateBalance, balanced} = require('./test-coop-balance-evaluator');

// Check current placement against independent rules, without reproducing the
// generator's repair algorithm or treating its output as its own oracle.
function checkGeneratedMap(map, count, seed, size = 'normal') {
  const fixed = expectedMap(count, seed, size);
  for (const field of ['mapSize', 'players', 'mapShape', 'coop'])
    assert.deepEqual(map[field], fixed[field], 'generated independent '+field);
  assert.equal(map.goldmines.length, count);
  assert(map.goldmines.every(m => m.owner === 0 && m.income === 20));
  const terrain = audit(map, `focused-${size}-${count}-${seed}`);
  const portals = check(map, size, count);
  assert(balanced(evaluateBalance(map)), 'generated independent balance');
  console.log(JSON.stringify({scenario:`current-generation-${size}-${count}-${seed}`, terrain, portals}));
  console.log(`PASS current-generation size=${size} humans=${count} seed=${seed} portals=${count*({tiny:1,normal:2,big:3}[size])} independent_roster=true terrain=true balance=true`);
}
module.exports = {checkGeneratedMap};
