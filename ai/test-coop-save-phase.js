'use strict';
// Current typed-wave persistence at each local phase boundary, with stationary
// combat to isolate dispatch/persistence. Fixtures are authored, not generated play.
const assert=require('node:assert/strict');
const {createFixture,defaultFixture}=require('./test-coop-harness');
function setup(saved) {
  const c=defaultFixture();c.coop=true;
  const f=createFixture(c,()=>{});
  if(saved){f.context.saved=saved;f.evaluate('loadFromJson(saved); undefined');}
  else f.evaluate(`new DemonPortal(3,3,'melee'); gameRound=3; whooseTurn=3;
    gameSettings.coop.localPhase={round:4,stage:'wave'}; undefined`);
  f.evaluate('players[3].play=()=>{}; undefined');
  return f;
}
const baseline=setup(),snapshots=[];
for(const stage of ['wave','demon','complete']) {
  assert.equal(baseline.evaluate('gameSettings.coop.localPhase.stage'),stage);
  snapshots.push({stage,save:baseline.evaluate('JSON.stringify(getGameObject())')});
  if(stage!=='complete')baseline.evaluate('advanceCoopLocalPhase(); undefined');
}
const final=baseline.evaluate('JSON.stringify(getGameObject())');
for(const {stage,save} of snapshots) {
  const f=setup(save);
  assert.equal(f.evaluate('JSON.stringify(getGameObject())'),save);
  for(let i=0;i<3;i++)f.evaluate('advanceCoopLocalPhase(); undefined');
  assert.equal(f.evaluate('JSON.stringify(getGameObject())'),final);
  assert.deepEqual(f.evaluate('({marker:gameSettings.coop.typedWaves,spawns:players[3].units.filter(u=>u.name==="imp").map(u=>({x:u.coord.x,y:u.coord.y,hp:u.hp}))})'),
    {marker:{lastRound:4},spawns:[{x:3,y:3,hp:2}]});
  console.log('PASS current-save-phase-'+stage+' exact-save=true continuation=identical spawns=1 hp=2 lastRound=4');
}
console.log('PASS co-op save-phase snapshots=3 restored=3 typed-wave-no-duplicate');
