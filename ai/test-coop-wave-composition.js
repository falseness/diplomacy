'use strict';
const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {composeCoopWave} = require('./wave-composition');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const portals = [{x:9,y:2}, {x:12,y:6}];
// Literal sequences derived with unsigned integer cumulative intervals.
const sequences = [
  [null,null,null,'imp','imp','imp','brute','hound','bulwark','spitter','brute','ravager','bulwark','brute','demonLord','hexcaster','demonLord','ravager'],
  [null,null,null,'imp','clawling','hound','hound','emberArcher','emberArcher','clawling','spitter','bulwark','ravager','ravager','hexcaster','bulwark','bulwark','brute']
];
const weights = {imp:1,clawling:2,hound:3,brute:5,bulwark:7,spitter:2,emberArcher:4,hexcaster:6,ravager:8,demonLord:12};
const unlocks = {imp:3,clawling:4,hound:5,brute:6,bulwark:8,spitter:5,emberArcher:7,hexcaster:9,ravager:11,demonLord:14};
function compare(scenario, observed, expected) {
  console.log(JSON.stringify({scenario,expected,observed}));
  assert.deepEqual(observed,expected,scenario); console.log('PASS '+scenario);
}
function expectedWave(round, selectedPortals = portals) {
  const selections = selectedPortals.flatMap(p => {
    const type = sequences[portals.findIndex(q=>q.x===p.x&&q.y===p.y)][round];
    return type ? [{...p,type}] : [];
  });
  return {round,types:selections.map(s=>s.type),selections};
}
// Separate BigInt oracle: exact rational intervals, no floating point tickets,
// signed bit operations, Math.imul or production configuration imports.
function reference(seed, round, p) {
  const modulus = 4294967296n;
  let value = BigInt(seed) ^ (BigInt(round)*2654435761n%modulus);
  for (const coordinate of [p.x,p.y]) value=((value^BigInt(coordinate))*1664525n+1013904223n)%modulus;
  const pool=Object.keys(weights).filter(id=>unlocks[id]<=round);
  const total=pool.reduce((s,id)=>s+weights[id],0);
  let cumulative=0;
  return pool.find(id=>{cumulative+=weights[id];return value*BigInt(total)<BigInt(cumulative)*modulus;});
}
function run(fault) {
  for (let round=0;round<18;round++) {
    const observed=composeCoopWave(42,round,2,portals);
    if(fault&&round===5) observed.types[0]='demonLord';
    compare('literal-per-portal-round-'+round,observed,expectedWave(round));
  }
  for (const seed of [0,1,42,4294967295]) for (const humans of [2,3,4]) for(let round=0;round<=17;round++) {
    const actual=composeCoopWave(seed,round,humans,portals);
    const selections=portals.flatMap(p=>{const type=reference(seed,round,p);return type?[{...p,type}]:[];});
    compare(`weighted-seed-${seed}-humans-${humans}-round-${round}`,actual,{round,types:selections.map(s=>s.type),selections});
    compare(`collection-order-${seed}-${humans}-${round}`,composeCoopWave(seed,round,humans,[...portals].reverse()),actual);
    compare(`other-portal-blocked-${seed}-${humans}-${round}`,composeCoopWave(seed,round,humans,[portals[1]]).selections,
      selections.filter(s=>s.x===12));
    compare(`one-per-portal-${seed}-${humans}-${round}`,actual.types.length,round<3?0:2);
  }
  const frozen=Object.freeze(portals.map(p=>Object.freeze({...p})));
  const first=composeCoopWave(42,14,2,frozen);
  first.types.length=0; first.selections[0].type='imp';
  compare('pure-repeated-selection',composeCoopWave(42,14,2,frozen),expectedWave(14));
  compare('no-portals',composeCoopWave(42,14,4,[]),{round:14,types:[],selections:[]});
  for(const seed of [-1,1.5,4294967296,NaN,'42']) assert.throws(()=>composeCoopWave(seed,3,2,portals),RangeError);
  for(const [r,h] of [[-1,2],[1.5,2],[3,1],[3,5]]) assert.throws(()=>composeCoopWave(42,r,h,portals),RangeError);
  for(const p of [null,[null],[{x:-1,y:2}],[{x:1,y:0.5}],[{x:4294967296,y:0}],[portals[0],portals[0]]])
    assert.throws(()=>composeCoopWave(42,3,2,p),RangeError);
  console.log('PASS invalid-inputs expected=RangeError observed=RangeError cases=15');
  const c=defaultFixture(); c.coop=true; c.size={x:15,y:9};
  const f=createFixture(c);
  f.evaluate('new DemonPortal(9,2); new DemonPortal(12,6); undefined');
  const before=f.evaluate('JSON.stringify(getGameObject())');
  for(const round of [0,1,2,3,5,14]) compare('browser-saved-seed-round-'+round,f.evaluate(`generateCoopWave(${round},42)`),expectedWave(round));
  compare('selection-does-not-change-live-state',f.evaluate(`(()=>{const state=JSON.parse(JSON.stringify(getGameObject()));delete state.gameSettings.coop.waveGeneration;return JSON.stringify(state)})()`),before);
  f.evaluate('external.reverse(); undefined');
  compare('browser-collection-order',f.evaluate('generateCoopWave(14,999)'),expectedWave(14));
  f.evaluate('loadFromJson(JSON.stringify(getGameObject()));');
  compare('saved-generation-state',f.evaluate('gameSettings.coop.waveGeneration'),{version:1,seed:42,lastRound:14});
  compare('restored-portal-identities',f.evaluate('external.filter(p=>p.isDemonPortal).map(p=>({x:p.coord.x,y:p.coord.y})).sort((a,b)=>a.x-b.x)'),portals);
  compare('restored-continuation',f.evaluate('generateCoopWave(15,999)'),expectedWave(15));
  f.evaluate('new Imp(9,2); undefined');
  compare('browser-blocked-other-portal',f.evaluate('generateCoopWave(14)'),expectedWave(14,[portals[1]]));
  f.evaluate('grid.getUnit({x:9,y:2}).kill(); undefined');
  compare('browser-unblocked-current-selection',f.evaluate('generateCoopWave(14)'),expectedWave(14));
  const state=f.evaluate('gameSettings.coop.waveGeneration');
  assert.throws(()=>f.evaluate('generateCoopWave(-1)'),{name:'RangeError'});
  compare('invalid-generation-keeps-state',f.evaluate('gameSettings.coop.waveGeneration'),state);
  f.evaluate('gameSettings.coop.waveGeneration.version=2');
  assert.throws(()=>f.evaluate('generateCoopWave(3)'),{name:'RangeError'});
  console.log('PASS unsupported-generation-version expected=RangeError observed=RangeError');
  console.log('SCOPE selection queries do not execute rounds or placement; TASK-074 owns exact portal-tile spawning and round-controller coverage. No online/deployed evidence is claimed.');
  console.log('PASS wave-composition literal_rounds=18 types=10 weighted_fixtures=216 humans=2,3,4 seeds=4 persistence=1');
}
if(process.argv.includes('--fault')) run(true);
else {
  run(false);
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8'});
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/); assert.match(child.stderr,/literal-per-portal-round-5/);
  console.log('PASS rejects-composition-corruption expected_exit=1 observed_exit=1');
}
