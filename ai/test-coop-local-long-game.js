const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const out = path.resolve(__dirname, '../artifacts/TASK-050');
fs.mkdirSync(out, {recursive:true});

// Independent integer wave oracle: literal costs/unlocks, rational selection.
// Do not import the production composer or derive expectations from its output.
function waveOracle(seed, round, humans) {
  const rules = [['imp',1,1],['clawling',2,2],['hound',3,3],['brute',5,4],
    ['bulwark',7,6],['spitter',2,3],['emberArcher',4,5],['hexcaster',6,7],
    ['ravager',8,9],['demonLord',12,12]];
  const strength = (4+2*(round-1)+(round>=13?12:round>=9?8:round>=5?4:0))*humans/2;
  let remaining = strength, random = BigInt(seed)^((BigInt(round)*2654435761n)%4294967296n);
  const types = [];
  while (remaining) {
    const pool = rules.filter(([,cost,unlock])=>cost<=remaining && unlock<=round);
    const total = pool.reduce((sum,[,cost])=>sum+cost,0);
    random = (random*1664525n+1013904223n)%4294967296n;
    let cumulative = 0;
    const [type,cost] = pool.find(([,cost])=>{
      cumulative += cost; return random*BigInt(total)<BigInt(cumulative)*4294967296n;
    });
    types.push(type); remaining -= cost;
  }
  return {round,strength,types};
}

function run(humans, seed, fault) {
  const name = `humans-${humans}-seed-${seed}`;
  const journal = path.join(out, name+(fault?'-fault':'')+'-ledger.jsonl');
  fs.writeFileSync(journal, '');
  const report = line => {
    fs.appendFileSync(journal,line+'\n');
    if (line.startsWith('PASS ')) console.log(line);
  };
  const compare = (label, observed, expected) => {
    report(JSON.stringify({scenario:name+'-'+label,expected,observed}));
    assert.deepStrictEqual(observed,expected,name+'-'+label);
    console.log(`PASS ${name}-${label} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
  };
  const towns = [[4,4],[10,4],[4,10],[10,10]].slice(0,humans);
  const actors = [{role:'neutral',gold:0,rgb:{r:100,g:100,b:100},towns:[],units:[]},
    ...towns.map(([x,y],i)=>({role:'human',gold:100,rgb:{r:50+i*40,g:100,b:180},towns:[{x,y}],units:[]})),
    {role:'demon',gold:0,economyEnabled:false,rgb:{r:160,g:40,b:180},towns:[],
      units:[{x:4,y:6,hp:2},{x:7,y:7,hp:2}]}];
  const demon = humans+1;
  const f = createFixture({coop:true,size:{x:15,y:15},actors},report);
  const initial = towns.flatMap(([x,y],i)=>[
    {id:'town'+(i+1),kind:'town',name:'town',owner:i+1,x,y},
    {id:'guard'+(i+1),kind:'unit',name:'noob',owner:i+1,x,y}]);
  initial.push({id:'victim',kind:'unit',name:'noob',owner:demon,x:4,y:6},
    {id:'sentinel',kind:'unit',name:'noob',owner:demon,x:7,y:7},
    {id:'portal',kind:'portal',name:'demonPortal',owner:demon,x:0,y:0});
  f.evaluate('new DemonPortal(0,0); undefined');
  // Exactly one vacant corner spawn cell; mountains keep the wave army bounded.
  for(let x=0;x<=2;x++) for(let y=0;y<=3;y++) if((x||y) && !(x===0&&y===1)) {
    f.evaluate(`new Mountain(${x},${y}); undefined`);
    initial.push({id:`mountain-${x}-${y}`,kind:'nature',name:'mountain',owner:0,x,y});
  }
  const entities = createEntityLedger(f,initial,report);
  const economy = createEconomyLedger(f,actors.map(({role,gold})=>({role,gold})),
    {income:{town:4,suburb:1},salary:{noob:1},purchase:{wall:2},production:{noob:20}},report);
  const turns = createTurnLedger(towns.map((_,i)=>i+1),report);
  let round=0, prefix=1, serial=0, checks=0;
  const sea = new Set();
  function check(label) {
    checks++;
    entities.check(name+'-'+label+'-entities');
    economy.check(name+'-'+label+'-economy');
    turns.check(name+'-'+label+'-turns',f.evaluate('({round:gameRound,terminal:gameExit,events:trace})'),
      round,round===48,round===48?undefined:prefix);
    compare(label+'-threshold',f.evaluate('suddenDeathRound'),40);
  }
  function birth(row,type='spawn') {
    entities.record({type,entity:row});
    entities.bind(row.id,`grid.get${row.kind==='unit'?'Unit':'Building'}(${JSON.stringify(row)})`);
  }
  function action(label, code, expectedChanges=()=>{}) {
    report(JSON.stringify({scenario:name,action:label,round,command:code}));
    f.evaluate(code); expectedChanges(); check(label);
  }
  function expense(id,type,rule) {economy.record({id,owner:1,type,rule,count:1});}
  f.context.refreshed = owner => {
    const [x,y] = towns[owner-1];
    // All fixture towns have even columns; these are their seven initial cells.
    const suburbs = [[x,y],[x,y-1],[x,y+1],[x-1,y-1],[x-1,y],[x+1,y-1],[x+1,y]];
    const count = suburbs.filter(([a,b])=>!sea.has(`${a},${b}`)).length;
    const id = `refresh-${serial++}`;
    economy.record({id:id+'-town',owner,type:'income',rule:'town',count:1});
    if(count) economy.record({id:id+'-suburb',owner,type:'income',rule:'suburb',count});
    economy.record({id:id+'-salary',owner,type:'salary',rule:'noob',count:owner===1&&round>=2?2:1});
    if(owner===1 && round===1) {
      birth({id:'produced',kind:'unit',name:'noob',owner:1,x:4,y:4},'production');
      compare('production-completed',f.evaluate('grid.getBuilding({x:4,y:4}).unitProduction.isEmpty()'),true);
    }
    if(owner===1 && round===4) {
      // Completed queues are removed from runtime containers, not marked killed.
      // Assert retirement before removing that test-only identity binding.
      compare('wall-queue-retired',f.evaluate(`(() => {
        const queue=[...ledgerObjects].find(([,id])=>id==='wall-queue')[0];
        return !externalProduction.includes(queue) && grid.getBuilding(queue.coord)!==queue;
      })()`),true);
      f.evaluate(`for(const [object,id] of ledgerObjects) if(id==='wall-queue') ledgerObjects.delete(object); undefined`);
      entities.record({type:'death',id:'wall-queue'});
      birth({id:'wall',kind:'building',name:'wall',owner:1,x:5,y:4});
    }
    check(id);
  };
  f.context.wave = result => {
    const expected = waveOracle(seed,round+1,humans);
    compare('wave-composition-'+(round+1),f.evaluate('lastWave'),expected);
    compare('wave-placement-'+(round+1),JSON.parse(JSON.stringify(result)),
      {spawned:round===0?[{type:'imp',x:0,y:1}]:[],skipped:expected.types.length-(round===0?1:0)});
    if(round===0) birth({id:'wave-imp',kind:'unit',name:'imp',owner:demon,x:0,y:1});
    prefix++;check('wave-'+(round+1));
  };
  f.context.demonPhase = () => {prefix++;check('demon-'+(round+1));};
  f.context.saved = () => {prefix++;check('human-ready-'+round);};
  f.context.completed = () => {
    round++;
    if(round>=40 && round%2===0) {
      const layer=(round-40)/2;
      const affected=(x,y)=>x===layer||x===14-layer||y===layer||y===14-layer;
      for(const row of entities.expected()) if(affected(row.x,row.y)) entities.record({type:'death',id:row.id});
      for(let x=0;x<15;x++) for(let y=0;y<15;y++) if(affected(x,y)) {
        birth({id:`sea-${round}-${x}-${y}`,kind:'nature',name:'sea',owner:0,x,y});
        sea.add(`${x},${y}`);
      }
    }
    prefix=turns.expected(round).length-1;
    check('round-'+round);
    compare('flood-boundary-'+round,f.evaluate("grid.arr.flat().filter(c=>c.building.name==='sea').map(c=>c.coord.x+','+c.coord.y).sort()"),[...sea].sort());
    compare('result-'+round,f.evaluate('({result:gameSettings.coop.result,ends,portals:external.filter(e=>e.isDemonPortal).length})'),
      {result:round===48?'defeat':null,ends:round===48?1:0,portals:round<40?1:0});
  };
  f.evaluate(`gameSettings.isOnline=false;gameSettings.coop.waveGeneration={version:1,seed:${seed},lastRound:0};
    globalThis.trace=[{type:'human',round:0,player:1}];globalThis.ends=0;
    menuBack=()=>{ends++;gameExit=true};AiRuntime.trainFromHumanCommands=()=>{};
    gameEvent.nextTurn=()=>{};timer={pauseAndSaveTime(){},setNextTurnTime(){}};
    nextTurnPauseInterface={visible:false};
    globalThis.saveManager={save(){trace.push({type:'human',round:gameRound,player:whooseTurn});saved()}};
    for(let owner=1;owner<=${humans};owner++) {
      const next=players[owner].nextTurn.bind(players[owner]);players[owner].nextTurn=()=>{next();refreshed(owner)};
    }
    const generate=generateCoopWave;generateCoopWave=(...args)=>{globalThis.lastWave=generate(...args);return lastWave};
    const spawn=spawnCoopWave;spawnCoopWave=r=>{trace.push({type:'wave',round:gameRound});const result=spawn(r);wave(result);return result};
    // Deterministic stationary demon policy isolates this long environmental
    // trajectory. Human commands below still execute real melee and movement.
    players[${demon}].play=()=>{trace.push({type:'demon',round:gameRound});demonPhase()};
    const neutral=players[0].nextTurn.bind(players[0]);
    players[0].nextTurn=()=>{neutral();trace.push({type:'complete',round:gameRound-1});completed()}; undefined`);
  check('initial');
  function move(from,to,label) {
    compare(label+'-legal',f.evaluate(`grid.getUnit(${JSON.stringify(from)}).getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,${JSON.stringify(to)}))`),true);
    action(label,`grid.getUnit(${JSON.stringify(from)}).sendInstructions(grid.getCell(${JSON.stringify(to)}));`,()=>entities.record({type:'move',id:'guard1',destination:to}));
  }
  move({x:4,y:4},{x:4,y:5},'opening-move');
  action('undo-move','actionManager.undo()',()=>{
    entities.record({type:'move',id:'guard1',destination:{x:4,y:4}});
    entities.bind('guard1','grid.getUnit({x:4,y:4})');
  });
  compare('undo-restored-health-movement',f.evaluate('({hp:grid.getUnit({x:4,y:4}).hp,moves:grid.getUnit({x:4,y:4}).moves})'),{hp:2,moves:2});
  move({x:4,y:4},{x:4,y:5},'opening-replay');
  action('purchase-wall',`if(!grid.getBuilding({x:4,y:4}).prepare('wall')) throw Error('wall rejected');
    grid.getBuilding({x:4,y:4}).sendInstructions(grid.getCell({x:5,y:4}));`,()=>{
    expense('wall','purchase','wall');birth({id:'wall-queue',kind:'production',name:'wall',owner:1,x:5,y:4});
  });
  action('prepare-unit',`if(!grid.getBuilding({x:4,y:4}).prepare('noob')) throw Error('unit rejected')`,()=>expense('unit','production','noob'));
  for(let r=0;r<48;r++) {
    if(r<2) {
      compare('combat-legal-'+r,f.evaluate('grid.getUnit({x:4,y:5}).getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,{x:4,y:6}))'),true);
      action('combat-'+r,'grid.getUnit({x:4,y:5}).sendInstructions(grid.getCell({x:4,y:6}));',()=>{
        if(r===1) {entities.record({type:'death',id:'victim'});entities.record({type:'move',id:'guard1',destination:{x:4,y:6}});}
      });
      compare('combat-health-'+r,f.evaluate('grid.getUnit({x:4,y:6}).playerColor==='+demon+' ? grid.getUnit({x:4,y:6}).hp : 0'),r===0?1:0);
    } else {
      const from={x:4,y:r%2===0?6:5}, to={x:4,y:r%2===0?5:6};
      move(from,to,'patrol-'+r);
    }
    if(fault && r===2) f.evaluate('players[1].gold++');
    for(let owner=1;owner<=humans;owner++) {
      compare(`cursor-${r}-${owner}`,f.evaluate('whooseTurn'),owner);
      action(`end-turn-${r}-${owner}`,'nextTurn()');
    }
  }
  action('terminal-noop','nextTurn();nextTurn()');
  compare('terminal',f.evaluate('({round:gameRound,result:gameSettings.coop.result,ends,units:players.map(p=>p.units.filter(u=>!u.killed).length)})'),
    {round:48,result:'defeat',ends:1,units:[0,...Array(humans).fill(0),1]});
  fs.writeFileSync(path.join(out,name+'-terminal.json'),JSON.stringify({scenario:name,checks,
    expected:{round:48,result:'defeat',threshold:40},observed:f.evaluate('({round:gameRound,result:gameSettings.coop.result,threshold:suddenDeathRound})'),
    state:f.evaluate('JSON.parse(JSON.stringify(getGameObject()))')},null,2)+'\n');
  console.log(`PASS long-game ${name} expected_rounds=48 observed_rounds=${round} threshold=40 combat=2 purchases=1 production=1 undo=1 flooding_layers=5 portal_removed_round=40 checks=${checks}`);
}
if(process.argv.includes('--fault')) run(2,0,true);
else {
  for(const humans of [2,4]) for(const seed of [0,42]) run(humans,seed,false);
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  fs.writeFileSync(path.join(out,'corruption-probe.log'),child.stdout+child.stderr+'\nexit_status='+child.status+'\n');
  assert.equal(child.status,1);assert.ok(child.stderr.includes('AssertionError')&&child.stderr.includes('human 1 balance'));
  console.log('PASS rejects-corrupt-balance expected_exit=1 observed_exit=1 marker=human 1 balance');
  console.log('INAPPLICABLE online committed convergence: these offline local games have no online revisions. Demon AI selection uses an explicitly stationary policy; real wave generation/placement, demon refresh, human combat/economy, round dispatcher and flooding execute.');
  console.log('PASS local-long-game scenarios=4 completed_rounds=192');
}
