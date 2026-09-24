const assert = require('node:assert/strict');
const {verifyValley} = require('./test-coop-valley-contract');
function checkGeneratedMap(map, count, seed, size = 'normal') {
  assert.deepEqual(map.coop.generation, {version:4,playerCount:count,seed,size,options:{seed,size}});
  const categories=['melee','ranged','siege','heavy','support','chaos'];
  assert.deepEqual(categories.map(c=>map.portals.filter(p=>p.category===c).length),[3,3,1,1,1,1].map(n=>n*count));
  const result=verifyValley(map);
  assert.equal(result.valid,true,JSON.stringify(result));
  console.log(`PASS current-generation size=${size} humans=${count} seed=${seed} portals=${count*10}`);
}
module.exports = {checkGeneratedMap};
