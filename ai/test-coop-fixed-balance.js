'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const selected = require('./coop-balance-selected.json');
const copy = x => JSON.parse(JSON.stringify(x));
const probe = `(() => {
 const specimens=[Imp,Clawling,Hound,Brute,Bulwark,Spitter,EmberArcher,Hexcaster,Ravager,DemonLord].map(C=>{
   grid.getHexagon({x:12,y:12}).repaint(gameSettings.coop.demonSlot,false);
   const u=new C(12,12); const row=[u.hp,u.dmg,u.speed,u.range || 1,u.constructor.salary,u.constructor.healSpeed];
   u.kill(); return row;
 });
 return {specimens,weights:Object.fromEntries(Object.entries(getCoopWaveConfig(gameSettings.coop.balanceVersion ?? 1).types).map(([id,t])=>[id,t.weight])),types:getUnlockedCoopDemonTypes(gameRound,gameSettings.coop.balanceVersion ?? 1),
 stats:[Imp,Clawling,Hound,Brute,Bulwark,Spitter,EmberArcher,Hexcaster,Ravager,DemonLord].map(C=>
 [C.maxHP,C.dmg,C.speed,C.range || 1,C.salary,C.healSpeed]),
 wave:spawnCoopWave(gameRound,42), state:JSON.parse(JSON.stringify(getGameObject()))};})()`;
if (process.argv.includes('--server')) {
  // The sibling loader predates the shared scaling script; supply its pure API
  // in this fixture without editing sibling production files.
  Object.assign(global, require('./coop-map-scaling'));
  require('../../diplomacy_server/server/loadGameCode');
  const vm = require('node:vm');
  const inputs = JSON.parse(require('node:fs').readFileSync(0,'utf8'));
  const results = inputs.map(s => {
    global.balanceInput = s;
    vm.runInThisContext('loadFromJson(JSON.stringify(balanceInput))');
    return vm.runInThisContext(probe);
  });
  console.log('BALANCE_RESULTS='+JSON.stringify(results));
} else {
  const inputs=[], results=[];
  const rounds=[...new Set([0,1,2,...Object.values(selected.types).flatMap(t=>[t.unlockRound-1,t.unlockRound,t.unlockRound+1])])].sort((a,b)=>a-b);
  for (const version of [1,2]) for(const humans of [1,2,3,4]) for(const [preset,side] of [['tiny',15],['normal',25],['big',39]]) {
    const c=defaultFixture(); c.coop=true; c.size={x:side,y:side};
    c.actors=[c.actors[0],...Array.from({length:humans},(_,i)=>({...copy(c.actors[1]),units:[{x:1+i*2,y:1,hp:2}],towns:[]})),{role:'demon',gold:0,economyEnabled:false,units:[],towns:[]}];
    const f=createFixture(c);
    assert.equal(f.evaluate('gameSettings.coop.balanceVersion'),2);
    f.evaluate(`gameSettings.coop.size='${preset}'; ${version===1?'delete gameSettings.coop.balanceVersion;':''} new DemonPortal(10,10);`);
    const initial=f.evaluate('JSON.stringify(getGameObject())');
    for (const round of rounds) {
      f.context.initial=initial; f.evaluate(`loadFromJson(initial); gameRound=${round};`);
      inputs.push(f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'));
      const local=f.evaluate(probe); results.push(local);
      const expectedTypes=Object.keys(selected.types).filter(id=>(selected.types[id].unlockRound - (version===1 && id!=='imp' ? 32 : 0))<=round);
      assert.deepEqual(local.types,expectedTypes);
      assert.deepEqual(local.weights,Object.fromEntries(Object.entries(selected.types).map(([id,t])=>[id,t.weight])));
      if(version===2) {
        assert.deepEqual(local.types,Object.keys(selected.types).filter(id=>selected.types[id].unlockRound<=round));
        assert.deepEqual(local.specimens,local.stats);
        assert.deepEqual(local.stats,Object.values(selected.types).map(t=>[t.health,t.damage,t.movement,t.range,t.salary,t.healSpeed]));
        for(const u of local.state.players[humans+1].units) {
          assert.equal(u.hp,selected.types[u.name].health);
        }
      }
      assert.equal(local.wave.spawned.length,round<3?0:1);
      const saved=JSON.stringify(local.state); f.context.saved=saved;
      f.evaluate('loadFromJson(saved)');
      assert.deepEqual(f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'),local.state);
      assert.equal(f.evaluate(`spawnCoopWave(${round},999).spawned.length`),0);
      if(round>=3) {
        f.evaluate('grid.getUnit({x:10,y:10}).kill()');
        assert.equal(f.evaluate(`spawnCoopWave(${round+1},999).spawned.length`),1);
      }
      console.log(`PASS fixed-balance version=${version} preset=${preset} humans=${humans} round=${round} expected_types=${JSON.stringify(expectedTypes)} observed_types=${JSON.stringify(local.types)} stats=${JSON.stringify(local.stats)} spawn=${local.wave.spawned.length} reload=identical occupied=0 unblocked=1`);
    }
  }
  const child=spawnSync(process.execPath,[__filename,'--server'],{input:JSON.stringify(inputs),encoding:'utf8',maxBuffer:128*1024*1024});
  assert.equal(child.status,0,child.stderr);
  const line=child.stdout.split('\n').find(s=>s.startsWith('BALANCE_RESULTS='));
  assert.ok(line); const server=JSON.parse(line.slice(16));
  assert.deepEqual(server,results);
  const f=createFixture(defaultFixture());
  assert.deepEqual(f.evaluate('[Noob,Normchel,KOHb,Archer,Catapult].map(C=>[C.maxHP,C.dmg,C.speed])'),[[2,1,2],[5,1,2],[3,1,4],[1,2,2],[1,0,2]]);
  assert.throws(()=>f.evaluate('getDemonTypes(999)'),{name:'RangeError'});
  console.log(`PASS fixed-balance local-server-identical cases=${results.length} versions=legacy-unversioned,2 types=10 presets=3 counts=1,2,3,4 all-unlock-boundaries=true actual-unit-hp=true save-map-phase=identical no-backlog=true human-competitive=unchanged unknown-version=rejected server_exit=${child.status}`);
}
