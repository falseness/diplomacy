const assert = require('assert').strict;
const {createFixture} = require('../../diplomacy_server/tests/client/test-coop-harness');
const {initialEntities} = require('../../diplomacy_server/tests/client/test-coop-generation-fixtures');
const {createEntityLedger} = require('../../diplomacy_server/tests/client/test-coop-entity-ledger');
const {getHumanSlots} = require('../../diplomacy_server/server/matchmakingSlots');
const {checkGeneratedMap} = require('../../diplomacy_server/tests/client/test-coop-current-generation');
const {composeTypedCoopWave} = require('./wave-composition');

function generated(count) {
  const f = createFixture(undefined, line => {
    if (!line.includes('fixture-initial-state')) console.log(line);
  });
  f.context.fixtureConfig = {actors: [{role:'neutral'}, ...Array.from({length:count},()=>({role:'human'})), {role:'demon'}]};
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{seed:42});
    generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);
    whooseTurn=1; actionManager.clear(); gameSettings.isOnline=false;
    gameEvent.nextTurn=()=>offlineNextTurn();
    nextTurnPauseInterface={visible:false}; timer=new Timer(); timer.setNextTurnTime();
    globalThis.saveManager={save(){offlineNextTurn()}};
    globalThis.phases=[]; const spawn=spawnCoopWave;
    spawnCoopWave=r=>{const result=spawn(r);phases.push({round:r,spawned:result.spawned.length});offlineNextTurn();return result};
    globalThis.demonPhases=0; const play=DemonPlayer.prototype.play;
    DemonPlayer.prototype.play=function(){demonPhases++;offlineNextTurn();play.call(this)};
    globalThis.ends=0; menuBack=()=>{ends++;gameSettings.coop.result=players[0].coopResult;gameExit=true}; undefined`);
  const map=f.evaluate('JSON.parse(JSON.stringify(generated))');
  checkGeneratedMap(map,count,42);
  createEntityLedger(f,initialEntities(map)).check(`generated-${count}-entities`);
  f.compare(`roster-${count}`, f.evaluate('players.map(p=>p.role)'),['NEUTRAL',...Array(count).fill('HUMAN'),'DEMONS']);
  return f;
}
// Typed schedule: the first wave is round 4 (melee imp, ranged spitter per portal).
function firstWave(g) {
  const types=composeTypedCoopWave(4,g.evaluate('external.filter(p=>p.isDemonPortal).map(p=>({x:p.coord.x,y:p.coord.y,category:p.category}))')).types;
  assert(types.length>0&&types.every(t=>t==='imp'||t==='spitter'),'first wave is imp/spitter only');
  return types;
}
const f=generated(1);
// Online co-op settings live on the lobby flow's create-lobby screen (TASK-300; Menu.online was removed).
f.compare('local-online-settings',f.evaluate(`(()=>{const m=new Menu(); globalThis.menu=m;
  m.play.toggleMode(); m.createLobby.toggleMode(); return [m.play.playersSlider.minimumValue(),m.play.playersSlider.maximumValue(),m.createLobby.playersSlider.minimumValue(),m.createLobby.playersSlider.maximumValue()]})()`),[1,12,2,12]);
for(const count of [0,1.5,13]) {
  f.compare(`reject-local-${count}`,f.evaluate(`(()=>{try{generateCoopGame(${count});return false}catch(e){return /integer from 1 to 12/.test(e.message)}})()`),true);
}
for(const count of [0,1.5,13]) {
  assert.throws(()=>getHumanSlots({gameSettings:{coop:{initialHumanCount:count}}}),/Unsupported online co-op human count/);
  console.log(`PASS reject-online-${count} expected=rejection observed=rejection`);
}
for(const count of [2,3,4]) {
  const peer=generated(count);
  const slots=Array.from({length:count},(_,i)=>i+1);
  f.compare(`online-valid-${count}`,getHumanSlots(peer.evaluate('JSON.parse(JSON.stringify(getGameObject()))')),slots);
  const wave=firstWave(peer).length;
  for(let round=1;round<=4;round++) {
    for(let i=0;i<count;i++) peer.evaluate('nextTurn()');
    peer.compare(`local-round-${count}-${round}`,peer.evaluate('({round:gameRound,turn:whooseTurn,demonPhases,phases})'),
      {round,turn:1,demonPhases:round,phases:Array.from({length:round},(_,i)=>({round:i+1,spawned:i===3?wave:0}))});
  }
}
const soloWave=firstWave(f);
for(let round=1;round<=4;round++) {
  // Fourth (first wave) round is dispatched by the actual timer expiration path.
  f.evaluate(round===4?'timer.lastPause=Date.now()-timer.time-1; timer.check()':'nextTurn()');
  f.compare(`solo-round-${round}`,f.evaluate('({round:gameRound,turn:whooseTurn,demonPhases,phases,gold:players[2].gold,units:players[2].units.map(u=>u.name)})'),
    {round,turn:1,demonPhases:round,phases:Array.from({length:round},(_,i)=>({round:i+1,spawned:i===3?soloWave.length:0})),gold:0,units:round===4?soloWave:[]});
  f.compare(`solo-timer-${round}`,f.evaluate('timer.time'),(12+10+Math.floor((100+round*10)/3))*1000);
  f.evaluate('globalThis.saved=JSON.stringify(getGameObject());loadFromJson(saved);');
  f.compare(`solo-save-load-${round}`,f.evaluate('JSON.stringify(getGameObject())===saved'),true);
}
f.compare('solo-fixed-portal-count-independent-of-strength',composeTypedCoopWave(4,[{x:1,y:1,category:'melee'},{x:2,y:2,category:'melee'}]).types,['imp','imp']);
for(const result of ['victory','defeat']) {
  const g=generated(1);
  g.evaluate(result==='victory'?'for(const p of external.filter(e=>e.name==="demonPortal")) p.kill();':'for(const u of [...players[1].units])u.kill();for(const t of [...players[1].towns])t.destroy();');
  g.compare(`solo-${result}`,g.evaluate('players[0].coopResult'),result);
  g.evaluate('nextTurn();nextTurn();');
  g.compare(`solo-${result}-terminal-once`,g.evaluate('({gameExit,ends,round:gameRound})'),{gameExit:true,ends:1,round:0});
  g.evaluate('loadFromJson(JSON.stringify(getGameObject()));');
  g.compare(`solo-${result}-restored`,g.evaluate('gameSettings.coop.result'),result);
}
console.log('PASS solo generation rounds=4 demon_phases=4 timer_dispatch=1 save_load=4 results=2 online_minimum=2');
