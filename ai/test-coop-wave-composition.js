const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {composeCoopWave} = require('./wave-composition');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

// Literal fixtures calculated independently with integer cumulative intervals
// and unbounded integer LCG arithmetic (not production output). Seed 42, humans 2.
const fixtures = [[0,{"round":0,"strength":0,"types":[]}],[1,{"round":1,"strength":4,"types":["imp","imp","imp","imp"]}],[2,{"round":2,"strength":6,"types":["imp","clawling","clawling","imp"]}],[3,{"round":3,"strength":8,"types":["clawling","hound","hound"]}],[4,{"round":4,"strength":10,"types":["hound","brute","clawling"]}],[5,{"round":5,"strength":16,"types":["hound","emberArcher","brute","emberArcher"]}],[6,{"round":6,"strength":18,"types":["brute","brute","bulwark","imp"]}],[7,{"round":7,"strength":20,"types":["bulwark","clawling","bulwark","emberArcher"]}],[8,{"round":8,"strength":22,"types":["bulwark","hexcaster","brute","emberArcher"]}],[9,{"round":9,"strength":28,"types":["bulwark","ravager","bulwark","hexcaster"]}],[10,{"round":10,"strength":30,"types":["bulwark","emberArcher","emberArcher","brute","emberArcher","imp","hound","clawling"]}],[11,{"round":11,"strength":32,"types":["spitter","brute","bulwark","clawling","bulwark","bulwark","clawling"]}],[12,{"round":12,"strength":34,"types":["hexcaster","hexcaster","clawling","hexcaster","brute","ravager","imp"]}],[13,{"round":13,"strength":40,"types":["hexcaster","ravager","brute","ravager","hexcaster","bulwark"]}],[14,{"round":14,"strength":42,"types":["hexcaster","brute","spitter","demonLord","clawling","demonLord","clawling","imp"]}]];
const costs = {imp:1,clawling:2,hound:3,brute:5,bulwark:7,spitter:2,emberArcher:4,hexcaster:6,ravager:8,demonLord:12};
const unlocks = {imp:1,clawling:2,hound:3,brute:4,bulwark:6,spitter:3,emberArcher:5,hexcaster:7,ravager:9,demonLord:12};
function compare(scenario, observed, expected) {
  console.log(JSON.stringify({scenario,expected,observed}));
  assert.deepEqual(observed,expected,scenario); console.log('PASS '+scenario);
}
// Separate exact integer oracle for additional seeds and human counts. Uses
// cumulative rational intervals, BigInt arithmetic and independent rule literals.
function reference(seed, round, humans) {
  const strength = round === 0 ? 0 : (4+2*(round-1)+(round>=13?12:round>=9?8:round>=5?4:0))*humans/2;
  let left=strength, x=BigInt(seed)^((BigInt(round)*2654435761n)%4294967296n);
  const types=[];
  while(left) {
    const pool=Object.keys(costs).filter(id=>unlocks[id]<=round&&costs[id]<=left);
    const total=pool.reduce((s,id)=>s+costs[id],0);
    x=(x*1664525n+1013904223n)%4294967296n;
    let cumulative=0;
    const selected=pool.find(id=>{cumulative+=costs[id]; return x*BigInt(total)<BigInt(cumulative)*4294967296n;});
    types.push(selected); left-=costs[selected];
  }
  return {round,strength,types};
}
function run(fault) {
  for(const [round,wanted] of fixtures) {
    const observed=composeCoopWave(42,round,2);
    if(fault&&round===5) observed.types[0]='demonLord';
    compare('exact-boundary-round-'+round,observed,wanted);
  }
  for(const seed of [0,1,42,4294967295]) for(const humans of [2,3,4]) for(let round=0;round<=14;round++) {
    const actual=composeCoopWave(seed,round,humans);
    compare(`weighted-seed-${seed}-humans-${humans}-round-${round}`,actual,reference(seed,round,humans));
    compare(`budget-unlocks-${seed}-${humans}-${round}`,{
      spent:actual.types.reduce((s,id)=>s+costs[id],0),unlocked:actual.types.every(id=>unlocks[id]<=round)
    },{spent:reference(seed,round,humans).strength,unlocked:true});
  }
  for(const seed of [-1,1.5,4294967296,NaN,'42']) assert.throws(()=>composeCoopWave(seed,1,2),RangeError);
  for(const [r,h] of [[-1,2],[1.5,2],[1,1],[1,5]]) assert.throws(()=>composeCoopWave(42,r,h),RangeError);
  console.log('PASS invalid-inputs expected=RangeError observed=RangeError cases=9');
  const c=defaultFixture(); c.coop=true; c.actors[2].towns=[]; c.actors[2].units=[{x:7,y:1,hp:2}];
  const f=createFixture(c);
  const initial=[
    {id:'neutral',kind:'town',name:'town',owner:0,x:4,y:5},
    {id:'town1',kind:'town',name:'town',owner:1,x:1,y:1},
    {id:'garrison',kind:'unit',name:'noob',owner:1,x:1,y:1},
    {id:'human1',kind:'unit',name:'noob',owner:1,x:2,y:2},
    {id:'human2',kind:'unit',name:'noob',owner:2,x:7,y:1},
    {id:'demon',kind:'unit',name:'noob',owner:3,x:7,y:5}
  ];
  let entities=createEntityLedger(f,initial);
  const economy=createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),{});
  const turns=createTurnLedger([1,2]);
  function check(label) {
    entities.check(label+'-entities'); economy.check(label+'-economy');
    turns.check(label+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
  }
  check('initial');
  for(const round of [5,2,5,13]) {
    compare('browser-saved-seed-round-'+round,f.evaluate(`generateCoopWave(${round},42)`),fixtures[round][1]); check('generated-'+round);
  }
  f.evaluate('loadFromJson(JSON.stringify(getGameObject()));');
  entities=createEntityLedger(f,initial); check('restored');
  compare('saved-generation-state',f.evaluate('gameSettings.coop.waveGeneration'),{version:1,seed:42,lastRound:13});
  compare('restored-continuation',f.evaluate('generateCoopWave(14,999)'),fixtures[14][1]); check('continued');
  f.evaluate('players[2].units[0].kill();');
  entities.record({type:'death',id:'human2'}); turns.eliminate(2,0); check('after-elimination');
  compare('real-human-elimination',f.evaluate('players[2].isLost'),true);
  compare('initial-human-scaling-retained',f.evaluate('gameSettings.coop.initialHumanCount'),2);
  compare('eliminated-human-same-composition',f.evaluate('generateCoopWave(14)'),fixtures[14][1]); check('generated-after-elimination');
  const state=f.evaluate('gameSettings.coop.waveGeneration');
  assert.throws(()=>f.evaluate('generateCoopWave(-1)'),{name:'RangeError'});
  compare('invalid-generation-keeps-state',f.evaluate('gameSettings.coop.waveGeneration'),state);
  f.evaluate('gameSettings.coop.waveGeneration.version=2');
  assert.throws(()=>f.evaluate('generateCoopWave(1)'),{name:'RangeError'});
  console.log('PASS unsupported-generation-version expected=RangeError observed=RangeError');
  console.log('INAPPLICABLE completed rounds/phase counts: composition round arguments do not advance the game; shared turn ledger checks round 0 after every generation and game mutation.');
  console.log('INAPPLICABLE income/expense events: no economic actions; independently declared starting balances plus zero events checked, demon gold/assets zero. Composition creates no entities; elimination records one death.');
  console.log('INAPPLICABLE online committed convergence: offline fixture has no online commits; actual save/load seed persistence and exact Node/browser compositions checked.');
  console.log('PASS wave-composition literal_rounds=15 boundaries=10 weighted_fixtures=180 humans=2,3,4 seeds=4 persistence=1 eliminations=1');
}
if(process.argv.includes('--fault')) run(true);
else {
  run(false);
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8'});
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/); assert.match(child.stderr,/exact-boundary-round-5/);
  console.log('PASS rejects-composition-corruption expected_exit=1 observed_exit=1');
}
