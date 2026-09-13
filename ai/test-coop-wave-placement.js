const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function setup(label, portals) {
  const c=defaultFixture(); c.coop=true; c.size={x:15,y:9};
  c.actors[0].towns=[]; c.actors[1].units=[];
  c.actors[2].towns=[{x:1,y:7}]; c.actors[3].units=[];
  const f=createFixture(c);
  // Spy at the constructor entry, before even the inherited registration path.
  f.evaluate(`const OriginalImp=Imp;
    Imp=class extends OriginalImp {
      constructor(x,y) {
        if(globalThis.checkSpawnOwnership && grid.getCell({x,y}).playerColor!==3)
          throw Error('coordinate ownership must precede construction');
        super(x,y);
      }
    }; undefined`);
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
    entities.record({type:'spawn',entity:{id,kind,name,owner:kind==='nature'?0:3,x:coord.x,y:coord.y}});
    entities.bind(id,`grid.${kind==='unit'?'getUnit':'getBuilding'}(${JSON.stringify(coord)})`);
    check('add-'+id); return id;
  }
  function remove(id, flood=false) {
    const row=entities.expected().find(e=>e.id===id);
    f.evaluate(flood ? `players[0].floodCell(${row.x},${row.y}); undefined` :
      `grid.${row.kind==='unit'?'getUnit':'getBuilding'}(${JSON.stringify({x:row.x,y:row.y})}).kill(); undefined`);
    entities.record({type:'death',id});
    if(flood) {
      for(const unit of entities.expected().filter(e=>e.kind==='unit' && e.x===row.x && e.y===row.y))
        entities.record({type:'death',id:unit.id});
      entities.record({type:'spawn',entity:{id:'flood-'+id,kind:'nature',name:'sea',owner:0,x:row.x,y:row.y}});
      entities.bind('flood-'+id,`grid.getBuilding({x:${row.x},y:${row.y}})`);
    }
    check((flood?'flood-':'remove-')+id);
  }
  function wave(step,round,selections, direct=false) {
    const before=entities.expected();
    f.evaluate('globalThis.checkSpawnOwnership=true');
    const observed=f.evaluate(direct ? `placeCoopWave({selections:${JSON.stringify(selections)}})` : `spawnCoopWave(${round},42)`);
    f.evaluate('globalThis.checkSpawnOwnership=false');
    const wanted={spawned:selections,skipped:0};
    if(process.argv.includes('--fault') && step==='first') observed.spawned[0].x++;
    console.log(JSON.stringify({scenario:label+'-'+step+'-before',entities:before}));
    f.compare(label+'-'+step+'-placement',observed,wanted);
    for(const row of selections) {
      const id='wave-'+serial++;
      entities.record({type:'spawn',entity:{id,kind:'unit',name:row.type,owner:3,x:row.x,y:row.y}});
      entities.bind(id,`grid.getUnit({x:${row.x},y:${row.y}})`);
      f.compare(label+'-'+step+'-coordinate-owner',f.evaluate(`({tile:grid.getCell(${JSON.stringify(row)}).playerColor,
        registered:players[3].units.includes(grid.getUnit(${JSON.stringify(row)}))})`),{tile:3,registered:true});
    }
    check(step);
    console.log(`PASS ${label}-${step} expected_spawned=${selections.length} observed_spawned=${observed.spawned.length}`);
  }
  check('initial');
  portals.forEach((p,i)=>add('portal','demonPortal','DemonPortal',p,'portal'+i));
  return {f,add,remove,wave,check,entities};
}
const a={x:6,y:4}, b={x:12,y:4};
const imp=p=>({type:'imp',...p});
function run() {
  {
    const s=setup('multiple-portals',[a,b]);
    for(const r of [0,1,2]) s.wave('warmup-'+r,r,[]);
    s.wave('first',3,[imp(a),imp(b)]);
    s.wave('occupied-round3',3,[]);
    s.wave('occupied',4,[]);
    const units=s.entities.expected().filter(e=>e.kind==='unit' && e.owner===3);
    units.forEach(e=>s.remove(e.id));
    // Literal seed-42 round-four selections differ by portal.
    s.wave('cleared-no-backlog',4,[imp(a),{type:'clawling',...b}]);
    s.f.compare('no-persisted-backlog',s.f.evaluate('gameSettings.coop.waveGeneration'),{version:1,seed:42,lastRound:4});
  }
  {
    const s=setup('mixed-blocked-live-destroyed',[a,b,{x:8,y:7}]);
    s.add('unit','imp','Imp',a,'occupant');
    s.remove('portal2');
    s.wave('round3',3,[imp(b)]);
    s.remove('occupant');
    s.wave('cleared-current-round',3,[imp(a)]);
  }
  for(const flood of [false,true]) {
    const s=setup(flood?'flooded':'destroyed',[a,b]);
    s.remove('portal0',flood);
    s.wave('survivor',3,[imp(b)]);
    s.remove('portal1',flood);
    s.wave('none',4,[]);
  }
  {
    const s=setup('no-portals',[]); s.wave('empty',3,[]);
  }
  {
    const s=setup('map-edge',[{x:0,y:0}]); s.wave('round3',3,[imp({x:0,y:0})]);
  }
  {
    const s=setup('all-ten-types',[]);
    const types=['imp','clawling','hound','brute','bulwark','spitter','emberArcher','hexcaster','ravager','demonLord'];
    const selections=types.map((type,i)=>({type,x:4+i,y:4}));
    selections.forEach((p,i)=>s.add('portal','demonPortal','DemonPortal',p,'type-portal-'+i));
    s.wave('direct',14,selections,true);
    assert.throws(()=>s.f.evaluate("placeCoopWave({selections:[{type:'unknown',x:6,y:4}]})"),{name:'RangeError'});
    assert.throws(()=>s.f.evaluate("placeCoopWave({selections:[{type:'imp',x:6,y:4},{type:'imp',x:6,y:4}]})"),{name:'RangeError'});
    s.check('invalid-atomic-rejection');
  }
  // Stale selections must not act on dead, unregistered, replaced, foreign,
  // or occupied portals; preserve the entire serialized game and occupants.
  for(const [name,mutation] of [
    ['zero-hp','portal.hp=0'], ['killed','portal.killed=true'],
    ['removed','external.splice(external.indexOf(portal),1)'],
    ['replaced','grid.setBuilding(new Empty(),portal.coord)'],
    ['foreign',"Object.defineProperty(portal,'playerColor',{value:1})"],
    ['flooded','players[0].floodCell(6,4)'],
    ['human-building','portal.kill(); grid.getHexagon({x:6,y:4}).sudoPaint(1); new Town(6,4)'],
    ['occupied','new Imp(6,4)'],
    ['human-occupied','grid.getHexagon({x:6,y:4}).sudoPaint(1); new Noob(6,4)']
  ]) {
    const s=setup('stale-'+name,[a]);
    s.f.evaluate(`globalThis.portal=grid.getBuilding({x:6,y:4}); ${mutation}; undefined`);
    const snapshot='JSON.stringify({game:{grid,players,external,gameSettings},owner:grid.getCell({x:6,y:4}).playerColor})';
    const before=s.f.evaluate(snapshot);
    s.f.compare('stale-'+name+'-result',s.f.evaluate('placeCoopWave({selections:[{type:"imp",x:6,y:4}]})'),{spawned:[],skipped:1});
    s.f.compare('stale-'+name+'-unchanged',s.f.evaluate(snapshot),before);
    console.log('PASS stale-'+name+' no-replacement no-ownership-change');
  }
  console.log('PASS wave-placement exact-portal-coordinates no-nearby-placement no-backlog types=10');
}
run();
if(!process.argv.includes('--fault')) {
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
  assert.match(child.stderr,/multiple-portals-first-placement/);
  console.log('PASS rejects-placement-corruption expected_exit=1 observed_exit=1 marker=multiple-portals-first-placement');
}
