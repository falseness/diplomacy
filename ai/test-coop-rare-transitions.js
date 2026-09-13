const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const out = path.resolve(__dirname, '../artifacts/TASK-051');
fs.mkdirSync(out, {recursive:true});
const fault = process.argv.includes('--fault');
const states = [];
function setup(name, flood=false, blocked=false) {
  const config=defaultFixture(); config.coop=true;
  config.actors[0].towns=[]; config.actors[1].units=[];
  let rows=[['t1','town',1,1,1],['h1','unit',1,1,1],
    ['t2','town',2,7,1],['h2','unit',2,7,1],['d','unit',3,7,5],['p','portal',3,4,4]];
  if(flood) {
    config.actors[1].towns=[];config.actors[2].towns=[];
    config.actors[1].units=[{x:0,y:1,hp:2}];config.actors[2].units=[{x:0,y:3,hp:2}];
    config.actors[3].units=[{x:0,y:5,hp:2}];
    rows=[['h1','unit',1,0,1],['h2','unit',2,0,3],['d','unit',3,0,5],['p','portal',3,0,6]];
  }
  if(blocked) {
    config.size={x:15,y:9};config.actors[2].towns=[{x:1,y:7}];config.actors[3].units=[];
    rows=[['t1','town',1,1,1],['h1','unit',1,1,1],['t2','town',2,1,7],['h2','unit',2,1,7],
      ['p','portal',3,6,4],['p2','portal',3,12,4]];
  }
  const f=createFixture(config);
  const initial=rows.map(([id,kind,owner,x,y])=>({id,kind,owner,x,y,name:kind==='unit'?'noob':kind==='portal'?'demonPortal':'town'}));
  for(const p of initial.filter(e=>e.kind==='portal')) f.evaluate(`new DemonPortal(${p.x},${p.y}); undefined`);
  // Independent cube-distance formula; no production neighbour/placement helper.
  if(blocked) for(let x=0;x<15;x++) for(let y=0;y<9;y++) {
    const z=y-(x-(x&1))/2;
    if([6,12].some(px=>{
      const pz=4-px/2, d=(Math.abs(x-px)+Math.abs(z-pz)+Math.abs(x+z-px-pz))/2;
      return d>=1&&d<=2;
    })) {
      initial.push({id:`block-${x}-${y}`,kind:'nature',name:'mountain',owner:0,x,y});
      f.evaluate(`new Mountain(${x},${y}); undefined`);
    }
  }
  const entities=createEntityLedger(f,initial);
  const economy=createEconomyLedger(f,config.actors.map(({role,gold})=>({role,gold})),{});
  const turns=createTurnLedger([1,2]);
  f.evaluate('gameSettings.isOnline=false; globalThis.ends=0; menuBack=()=>{ends++;gameExit=true}; undefined');
  function compare(label,actual,expected) {
    assert.deepStrictEqual(actual,expected,name+'-'+label);
    console.log(`PASS ${name}-${label} expected=${JSON.stringify(expected)} observed=${JSON.stringify(actual)}`);
  }
  function check(step,result=null,terminal=false) {
    const label=name+'-'+step;
    entities.check(label+'-entities');economy.check(label+'-economy');
    turns.check(label+'-turns',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:gameExit?[]:[{type:'human',round:gameRound,player:whooseTurn}]})`),0,terminal);
    const expectedRows=entities.expected();
    const expected={result,ended:result!==null,exit:terminal,ends:terminal?1:0,
      units:[0,1,2,3].map(owner=>expectedRows.filter(e=>e.owner===owner&&e.kind==='unit').length),
      towns:[0,1,2,3].map(owner=>expectedRows.filter(e=>e.owner===owner&&e.kind==='town').length),
      portals:expectedRows.filter(e=>e.kind==='portal').length,gold:[0,100,75,0]};
    const observed=f.evaluate(`({result:players[0].coopResult,ended:players[0].isGameEnded,
      exit:gameExit,ends,units:players.map(p=>p.units.filter(u=>!u.killed).length),
      towns:players.map(p=>p.towns.filter(t=>!t.killed).length),
      portals:external.filter(e=>e.isDemonPortal&&!e.killed).length,gold:players.map(p=>p.gold)})`);
    if(fault && name==='last-portal' && step==='remove-p') expected.result='victory';
    compare(step,observed,expected);
    states.push({checkpoint:label,expected,observed,expectedEntities:expectedRows,
      state:f.evaluate('JSON.parse(JSON.stringify(getGameObject()))')});
  }
  function remove(id,result=null) {
    const row=entities.expected().find(e=>e.id===id);
    f.evaluate(`grid.get${row.kind==='unit'?'Unit':'Building'}({x:${row.x},y:${row.y}}).${row.kind==='town'?'destroy':'kill'}(); undefined`);
    entities.record({type:'death',id});check('remove-'+id,result);
  }
  function birth(row) {
    entities.record({type:'spawn',entity:row});
    entities.bind(row.id,`grid.get${row.kind==='unit'?'Unit':'Building'}({x:${row.x},y:${row.y}})`);
  }
  function finish(result) {
    for(let i=1;i<=2;i++) {f.evaluate('nextTurn(); undefined');check('terminal-call-'+i,result,true);}
  }
  check('initial');return {f,entities,check,remove,birth,finish,compare};
}
{
  const s=setup('last-portal');s.remove('p');s.remove('d','victory');s.finish('victory');
}
{
  const s=setup('last-demon');s.remove('d');s.remove('p','victory');s.finish('victory');
}
{
  const s=setup('individual-human-elimination');s.remove('h2');s.remove('t2');
  s.compare('lost-human',s.f.evaluate('players.slice(1,3).map(p=>p.isLost)'),[false,true]);
  s.remove('p');s.remove('d','victory');s.finish('victory');
}
for(const remaining of ['portal','demon']) {
  const s=setup('defeat-'+remaining);s.remove(remaining==='portal'?'d':'p');
  for(const id of ['h1','t1','h2','t2']) s.remove(id,id==='t2'?'defeat':null);
  s.finish('defeat');
}
{
  const s=setup('simultaneous-total-elimination',true);
  // Focused environmental batch, not a shortened replacement for TASK-050's
  // unchanged-threshold full-duration games. Results are checked after the batch.
  s.f.evaluate('suddenDeathRound=0; players[0].suddenDeath(); undefined');
  for(const id of ['h1','h2','d','p']) s.entities.record({type:'death',id});
  for(let x=0;x<9;x++) for(let y=0;y<7;y++) if(x===0||x===8||y===0||y===6)
    s.birth({id:`sea-${x}-${y}`,kind:'nature',name:'sea',owner:0,x,y});
  s.check('flood-batch','draw');s.finish('draw');
}
{
  const s=setup('all-portals-blocked',false,true);
  function wave(round,expected) {
    const observed=s.f.evaluate(`spawnCoopWave(${round},42)`);
    s.compare('wave-'+round,observed,expected);
    for(const [i,row] of expected.spawned.entries()) s.birth({id:`wave-${round}-${i}`,kind:'unit',
      name:row.type,owner:3,x:row.x,y:row.y});
    s.check('after-wave-'+round);
    s.compare('generation-'+round,s.f.evaluate('gameSettings.coop.waveGeneration'),{version:1,seed:42,lastRound:round});
  }
  wave(1,{spawned:[],skipped:4});wave(2,{spawned:[],skipped:4});
  // Reopen ALL 36 cells: enough space for the three new entries PLUS the eight
  // discarded entries, so capacity cannot hide an accidental backlog replay.
  const blockers=s.entities.expected().filter(e=>e.kind==='nature');
  s.compare('blocked-cell-count',blockers.length,36);
  for(const row of blockers) s.remove(row.id);
  wave(3,{spawned:[{type:'clawling',x:4,y:3},{type:'hound',x:4,y:4},{type:'hound',x:4,y:5}],skipped:0});
  s.compare('unblock-without-backlog-count',s.f.evaluate('players[3].units.length'),3);
}
if(!fault) {
  fs.writeFileSync(path.join(out,'transition-states.json'),JSON.stringify(states,null,2)+'\n');
  console.log(`PASS complete-transition-states checkpoints=${states.length} file=transition-states.json`);
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(out,'corruption-probe.log'),child.stdout+child.stderr+'\nexit_status='+child.status+'\n');
  assert.equal(child.status,1);assert.match(child.stderr,/AssertionError.*last-portal-remove-p/);
  console.log('PASS rejects-premature-victory expected_exit=1 observed_exit=1 marker=last-portal-remove-p');
  console.log('INAPPLICABLE online committed convergence: offline fixtures have no online revisions. Income/expense events and completed rounds/phase counts are inapplicable: direct lifecycle/flood/wave actions leave round 0 unchanged; terminal dispatcher calls are checked individually. Shared ledgers check every action, fixed human balances, zero demon economy and serialization references. Full-duration coverage remains in TASK-050.');
  console.log('PASS rare-transitions scenarios=7');
}
