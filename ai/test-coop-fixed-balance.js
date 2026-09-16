'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const selected = require('./coop-balance-selected.json');
// Literal schedules: selected.json is historical tuning data, not live unlocks.
const schedules = {
  1: {imp:3,clawling:4,hound:5,brute:6,bulwark:8,spitter:5,emberArcher:7,hexcaster:9,ravager:11,demonLord:14},
  2: {imp:1,clawling:3,hound:6,brute:10,bulwark:20,spitter:6,emberArcher:15,hexcaster:24,ravager:30,demonLord:35}
};
// Explicit current version-2 stats [health,damage,movement,range,salary,healSpeed]
// (c20 table: ranged reach 4/5/6, movement +1 and the raised damage column); selected.json keeps
// the historical stats and live weights.
const tunedStats = {
  imp:[3,3,4,1,0,0], clawling:[4,3,5,1,0,0], hound:[6,5,6,1,0,0], brute:[12,10,3,1,0,0],
  bulwark:[20,10,3,1,0,0], spitter:[3,3,4,4,0,0], emberArcher:[5,5,4,5,0,0],
  hexcaster:[6,10,3,6,0,0], ravager:[10,12,5,1,0,0], demonLord:[24,16,4,1,0,0]
};
const copy = x => JSON.parse(JSON.stringify(x));
const probe = `(() => {
 const specimens=[Imp,Clawling,Hound,Brute,Bulwark,Spitter,EmberArcher,Hexcaster,Ravager,DemonLord].map(C=>{
   grid.getHexagon({x:grid.arr.length-2,y:grid.arr[0].length-2}).repaint(gameSettings.coop.demonSlot,false);
   const u=new C(grid.arr.length-2,grid.arr[0].length-2); const row=[u.hp,u.dmg,u.speed,u.range || 1,u.constructor.salary,u.constructor.healSpeed];
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
  const rounds=[...new Set([0,1,2,...Object.values(schedules).flatMap(s=>Object.values(s).flatMap(r=>[r-1,r,r+1])).concat(40)])].sort((a,b)=>a-b);
  for (const version of [1,2]) for(const humans of (process.argv.includes('--expanded') ? Array.from({length:12},(_,i)=>i+1) : [1,2,3,4])) for(const [preset,side] of [['tiny',15],['normal',25],['big',39]]) {
    const c=defaultFixture(); c.coop=true; c.size=process.argv.includes('--expanded') && version===2 ? require('./coop-map-scaling').getCoopMapScaling(humans,preset).mapSize : {x:side,y:side};
    c.actors=[c.actors[0],...Array.from({length:humans},(_,i)=>({...copy(c.actors[1]),units:[{x:1+i%6*2,y:1+Math.floor(i/6)*2,hp:2}],towns:[]})),{role:'demon',gold:0,economyEnabled:false,units:[],towns:[]}];
    const f=createFixture(c);
    assert.equal(f.evaluate('gameSettings.coop.balanceVersion'),2);
    f.evaluate(`gameSettings.coop.size='${preset}'; ${version===1?'delete gameSettings.coop.balanceVersion;':''} new DemonPortal(10,10);`);
    if(process.argv.includes('--expanded') && version===2) f.evaluate(`gameSettings.coop.generation={version:3,playerCount:${humans},seed:42,size:'${preset}',options:{seed:42,size:'${preset}'}}; undefined`);
    const initial=f.evaluate('JSON.stringify(getGameObject())');
    // Version 2 checks every completed round through 40, not just boundaries.
    for (const round of (version === 2 ? Array.from({length:41},(_,i)=>i) : rounds)) {
      f.context.initial=initial; f.evaluate(`loadFromJson(initial); gameRound=${round};`);
      inputs.push(f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'));
      const local=f.evaluate(probe); results.push(local);
      const expectedTypes=Object.keys(schedules[version]).filter(id=>schedules[version][id]<=round);
      assert.deepEqual(local.types,expectedTypes);
      assert.deepEqual(local.weights,Object.fromEntries(Object.entries(selected.types).map(([id,t])=>[id,t.weight])));
      if(version===2) {
        assert.deepEqual(local.specimens,local.stats);
        assert.deepEqual(local.stats,Object.keys(selected.types).map(id=>tunedStats[id]));
        for(const u of local.state.players[humans+1].units) {
          assert.equal(u.hp,tunedStats[u.name][0]);
        }
      }
      assert.equal(local.wave.spawned.length,round<schedules[version].imp?0:1);
      const saved=JSON.stringify(local.state); f.context.saved=saved;
      f.evaluate('loadFromJson(saved)');
      assert.deepEqual(f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'),local.state);
      assert.equal(f.evaluate(`spawnCoopWave(${round},999).spawned.length`),0);
      if(round>=schedules[version].imp) {
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
  console.log(`PASS fixed-balance local-server-identical cases=${results.length} versions=legacy-unversioned,2 types=10 presets=3 counts=${process.argv.includes('--expanded')?'1..12':'1,2,3,4'} all-unlock-boundaries=true actual-unit-hp=true save-map-phase=identical no-backlog=true human-competitive=unchanged unknown-version=rejected server_exit=${child.status}`);
}
