const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

// Independent odd-column offset -> cube distance oracle. Production uses BFS.
function distance(a, b) {
  const az = a.y - (a.x - (a.x & 1)) / 2;
  const bz = b.y - (b.x - (b.x & 1)) / 2;
  return (Math.abs(a.x-b.x) + Math.abs(az-bz) + Math.abs(a.x+az-b.x-bz))/2;
}
function ring(p) {
  const result=[];
  for(let x=0;x<15;x++) for(let y=0;y<9;y++) {
    if(distance(p,{x,y})>=1 && distance(p,{x,y})<=2) result.push({x,y});
  }
  return result;
}
function setup(label, portals) {
  const c=defaultFixture(); c.coop=true; c.size={x:15,y:9};
  c.actors[0].towns=[]; c.actors[1].units=[];
  c.actors[2].towns=[{x:1,y:7}]; c.actors[3].units=[];
  const f=createFixture(c);
  const initial=[
    {id:'town1',kind:'town',name:'town',owner:1,x:1,y:1},
    {id:'unit1',kind:'unit',name:'noob',owner:1,x:1,y:1},
    {id:'town2',kind:'town',name:'town',owner:2,x:1,y:7},
    {id:'unit2',kind:'unit',name:'noob',owner:2,x:1,y:7}
  ];
  const entities=createEntityLedger(f,initial);
  const economy=createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),{});
  const turns=createTurnLedger([1,2]);
  let serial=0;
  function check(step) {
    entities.check(label+'-'+step+'-entities'); economy.check(label+'-'+step+'-economy');
    turns.check(label+'-'+step+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
  }
  function add(kind,name,ctor,coord,id='added-'+serial++) {
    f.evaluate(`new ${ctor}(${coord.x},${coord.y}); undefined`);
    entities.record({type:'spawn',entity:{id,kind,name,owner:kind==='nature'?0:3,...coord}});
    entities.bind(id,`grid.${kind==='unit'?'getUnit':'getBuilding'}(${JSON.stringify(coord)})`);
    check('add-'+id); return id;
  }
  function remove(id, flood=false) {
    const row=entities.expected().find(e=>e.id===id);
    f.evaluate(flood ? `players[0].floodCell(${row.x},${row.y}); undefined` :
      `grid.${row.kind==='unit'?'getUnit':'getBuilding'}(${JSON.stringify({x:row.x,y:row.y})}).kill(); undefined`);
    entities.record({type:'death',id});
    if(flood) {
      entities.record({type:'spawn',entity:{id:'flood-'+id,kind:'nature',name:'sea',owner:0,x:row.x,y:row.y}});
      entities.bind('flood-'+id,`grid.getBuilding({x:${row.x},y:${row.y}})`);
    }
    check((flood?'flood-':'remove-')+id);
  }
  function wave(step,round,types,expectedCount, direct=false) {
    // Expectations use only declarations and recorded events, never the runtime map.
    const before=entities.expected();
    const alive=before.filter(e=>e.kind==='portal');
    const available=[];
    for(let x=0;x<15;x++) for(let y=0;y<9;y++) {
      if(!before.some(e=>e.x===x&&e.y===y) &&
        alive.some(p=>distance(p,{x,y})>=1&&distance(p,{x,y})<=2)) available.push({x,y});
    }
    const wanted={spawned:types.slice(0,available.length).map((type,i)=>({type,...available[i]})),
      skipped:Math.max(0,types.length-available.length)};
    assert.equal(wanted.spawned.length,expectedCount,'independent fixture capacity');
    const observed=f.evaluate(direct?`placeCoopWave({types:${JSON.stringify(types)}})`:`spawnCoopWave(${round},42)`);
    if(process.argv.includes('--fault') && label==='partial-availability') observed.spawned.push({type:'imp',x:6,y:4});
    f.compare(label+'-'+step+'-placement',observed,wanted);
    for(const row of wanted.spawned) {
      const id='wave-'+serial++;
      entities.record({type:'spawn',entity:{id,kind:'unit',name:row.type,owner:3,x:row.x,y:row.y}});
      entities.bind(id,`grid.getUnit({x:${row.x},y:${row.y}})`);
    }
    f.compare(label+'-'+step+'-legal-unique',{
      inRadius:observed.spawned.every(p=>alive.some(a=>distance(a,p)>=1&&distance(a,p)<=2)),
      unoccupied:observed.spawned.every(p=>!before.some(e=>e.x===p.x&&e.y===p.y)),
      unique:new Set(observed.spawned.map(p=>p.x+','+p.y)).size
    },{inRadius:true,unoccupied:true,unique:expectedCount});
    check(step);
    console.log(`PASS ${label}-${step} expected_spawned=${expectedCount} observed_spawned=${observed.spawned.length} expected_skipped=${wanted.skipped} observed_skipped=${observed.skipped}`);
  }
  check('initial');
  portals.forEach((p,i)=>add('portal','demonPortal','DemonPortal',p,'portal'+i));
  return {f,add,remove,wave,check,entities};
}
const a={x:6,y:4}, b={x:12,y:4};
const first=['imp','imp','imp','imp'], second=['imp','clawling','clawling','imp'];
function block(s,portal,keep=[]) {
  const ids=[];
  ring(portal).filter(p=>!keep.some(k=>p.x===k.x&&p.y===k.y)).forEach((p,i)=>{
    // Mix occupied units and all three impassable terrain classes.
    const kind=i%4===3?'unit':'nature';
    const ctor=['Mountain','Lake','Sea','Imp'][i%4];
    ids.push(s.add(kind,ctor[0].toLowerCase()+ctor.slice(1),ctor,p));
  });
  return ids;
}
function run() {
  {
    const s=setup('one-blocked-portal',[a,b]); block(s,a);
    s.wave('round1',1,first,4);
  }
  {
    const s=setup('all-blocked-portals',[a,b]);
    const ids=[...block(s,a),...block(s,b)];
    s.wave('round1',1,first,0); s.wave('round2',2,second,0);
    ids.forEach(id=>s.remove(id));
    s.wave('round3-no-backlog',3,['clawling','hound','hound'],3);
    s.f.compare('no-persisted-backlog',s.f.evaluate('gameSettings.coop.waveGeneration'),{version:1,seed:42,lastRound:3});
  }
  {
    const s=setup('partial-availability',[a]);
    const ids=block(s,a,[{x:4,y:3},{x:4,y:4}]);
    s.wave('round1',1,first,2);
    ids.forEach(id=>s.remove(id));
    s.wave('round2-no-backlog',2,second,4);
  }
  for(const flood of [false,true]) {
    const label=flood?'flooded-portals':'destroyed-portals';
    const s=setup(label,[a,b]);
    s.remove('portal0',flood); s.wave('survivor-round1',1,first,4);
    s.remove('portal1',flood); s.wave('none-round2',2,second,0);
    s.add('portal','demonPortal','DemonPortal',{x:8,y:7},'replacement');
    s.wave('replacement-round3-no-backlog',3,['clawling','hound','hound'],3);
  }
  {
    const s=setup('overlapping-radii',[a,{x:7,y:4}]);
    const types=['imp','clawling','hound','brute','bulwark','spitter','emberArcher','hexcaster','ravager','demonLord'];
    s.wave('all-ten-types',12,types,10,true);
    assert.throws(()=>s.f.evaluate("placeCoopWave({types:['imp','unknown']})"),{name:'RangeError'});
    s.check('invalid-type-atomic-rejection');
  }
  {
    const s=setup('map-edge',[{x:0,y:0}]);
    s.wave('round1',1,first,4);
  }
  console.log('INAPPLICABLE completed game rounds/phase counts: wave round arguments exercise placement only; every action and wave checks unchanged game round 0 and human order. TASK-019 owns turn-loop integration.');
  console.log('INAPPLICABLE income/expenses: no economic actions or turn hooks; shared economy ledger checks independently declared human balances 100,75 and zero demon gold/assets after every action and wave.');
  console.log('INAPPLICABLE online committed convergence: offline runtime has no committed online revisions; shared entity ledger verifies serialized live entities after every action and wave.');
  console.log('PASS wave-placement scenarios=7 no-backlog=all-blocked,partial,destroyed,flooded types=10');
}
run();
if(!process.argv.includes('--fault')) {
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  // Retain the failure diagnostic without duplicating the successful setup logs.
  process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
  assert.match(child.stderr,/partial-availability-round1-placement/);
  console.log('PASS rejects-placement-corruption expected_exit=1 observed_exit=1 marker=partial-availability-round1-placement');
}
