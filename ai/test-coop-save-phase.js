const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const copy = x => JSON.parse(JSON.stringify(x));
// Independent seed-42 fixtures; round-local randomness needs no mutable RNG cursor.
const waves = [['imp','imp','imp','imp'], ['imp','clawling','clawling','imp'], ['clawling','hound','hound']];
const slots = [];
for (let x=0;x<19;x++) for (let y=0;y<11;y++) {
  const z=y-(x-(x&1))/2, pz=5-7;
  const d=(Math.abs(x-14)+Math.abs(z-pz)+Math.abs(x+z-14-pz))/2;
  if (d>=1 && d<=2) slots.push({x,y});
}
function run(saved, fault) {
  const c=defaultFixture(); c.coop=true; c.size={x:19,y:11};
  c.actors.forEach(a=>{a.towns=[];a.units=[];});
  c.actors[1].units=[{x:1,y:1,hp:2}]; c.actors[2].units=[{x:1,y:8,hp:2}];
  const f=createFixture(c);
  const initial=[{id:'h1',kind:'unit',name:'noob',owner:1,x:1,y:1},
    {id:'h2',kind:'unit',name:'noob',owner:2,x:1,y:8},
    {id:'portal',kind:'portal',name:'demonPortal',owner:3,x:14,y:5}];
  let model=saved ? copy(saved.model) : {round:0,prefix:1,births:0,waves:0,phases:0,salaries:[],live:initial};
  if(saved) {
    const packed=JSON.parse(saved.json);
    if(fault==='duplicate-wave') packed.gameSettings.coop.localPhase.stage='wave';
    if(fault==='skip-phase') packed.gameSettings.coop.localPhase.stage='complete';
    if(fault==='seed') packed.gameSettings.coop.waveGeneration.seed=1;
    f.context.savedInput=JSON.stringify(packed); f.evaluate('loadFromJson(savedInput)');
  } else f.evaluate(`new DemonPortal(14,5); gameSettings.coop.waveGeneration={version:1,seed:42,lastRound:0};
    gameSettings.aiActionLimit=1; gameSettings.mapShape={type:'rectangular'}; undefined`);
  let entities=createEntityLedger(f,model.live);
  const economy=createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),{salary:{noob:1}});
  model.salaries.forEach(e=>economy.record(e));
  const turns=createTurnLedger([1,2]);
  const snapshots={};
  function check(label) {
    entities.check(label+'-entities'); economy.check(label+'-economy');
    turns.check(label+'-turn',f.evaluate('({round:gameRound,terminal:gameExit,events:turnEvents})'),model.round,false,model.prefix);
  }
  function snapshot(stage) {
    check('snapshot-'+stage);
    f.compare('checkpoint-'+stage,f.evaluate('gameSettings.coop.localPhase'),{round:1,stage});
    model.live=entities.expected();
    snapshots[stage]={json:f.evaluate('JSON.stringify(getGameObject())'),model:copy(model)};
  }
  f.context.initialTrace=turns.expected(model.round+1).slice(0,model.prefix);
  f.context.afterWave=result=>{
    const types=waves[model.waves]; assert.ok(types,'no duplicate wave');
    const wanted=types.map((type,i)=>({type,...slots[model.births+i]}));
    f.compare('future-wave-'+(model.waves+1),copy(result),{spawned:wanted,skipped:0});
    for(const row of wanted) {
      const entity={id:'spawn-'+model.births++,kind:'unit',name:row.type,owner:3,x:row.x,y:row.y};
      entities.record({type:'spawn',entity}); entities.bind(entity.id,`grid.getUnit({x:${row.x},y:${row.y}})`);
    }
    model.waves++; model.prefix++; check('spawned-'+model.waves);
  };
  f.context.afterPlay=()=>{model.phases++; model.prefix++; check('demon-phase-'+model.phases);};
  f.context.afterIncome=owner=>{
    const event={id:'salary-'+model.salaries.length,owner,type:'salary',rule:'noob',count:1};
    model.salaries.push(event); economy.record(event); check('income-'+owner);
  };
  f.context.afterNeutral=()=>{model.round++; model.prefix++; check('round-'+model.round);};
  f.context.afterSave=()=>{model.prefix++; check('human-ready-'+model.round);};
  f.context.capture=stage=>{if(!saved && model.round===0) snapshot(stage);};
  f.evaluate(`globalThis.turnEvents=initialTrace;
    AiRuntime.trainFromHumanCommands=()=>{};
    gameEvent.nextTurn=()=>{}; nextTurnPauseInterface={visible:false}; menuBack=()=>{gameExit=true};
    timer.pauseAndSaveTime=()=>{}; timer.setNextTurnTime=()=>{};
    globalThis.saveManager={save(){turnEvents.push({type:'human',round:gameRound,player:whooseTurn});afterSave()}};
    for(const owner of [1,2]) {
      const next=players[owner].nextTurn.bind(players[owner]);
      players[owner].nextTurn=()=>{next();afterIncome(owner)};
    }
    const neutral=players[0].nextTurn.bind(players[0]);
    players[0].nextTurn=()=>{neutral();turnEvents.push({type:'complete',round:gameRound-1});afterNeutral()};
    const spawn=spawnCoopWave;
    spawnCoopWave=r=>{turnEvents.push({type:'wave',round:gameRound});const result=spawn(r);afterWave(result);return result};
    // Isolate persistence from AI movement selection; production demon refresh,
    // wave composition/placement, human economy and the dispatcher all run.
    players[3].play=()=>{turnEvents.push({type:'demon',round:gameRound});afterPlay()};
    const step=advanceCoopLocalPhase;
    advanceCoopLocalPhase=()=>{if(gameSettings.coop.localPhase.stage==='wave')capture('wave');
      step();capture(gameSettings.coop.localPhase.stage)}; undefined`);
  check(saved?'restored-'+JSON.parse(saved.json).gameSettings.coop.localPhase.stage:'initial');
  f.compare('restored-options',f.evaluate('({seed:gameSettings.coop.waveGeneration.seed,version:gameSettings.coop.waveGeneration.version,humans:gameSettings.coop.initialHumanCount,limit:gameSettings.aiActionLimit,shape:gameSettings.mapShape})'),
    {seed:42,version:1,humans:2,limit:1,shape:{type:'rectangular'}});
  if(saved) {f.evaluate('nextTurn()');check('resumed-boundary');}
  while(model.round<3) {f.evaluate('nextTurn()'); check('dispatch');}
  f.compare('completed-progression',f.evaluate('({round:gameRound,turn:whooseTurn,generation:gameSettings.coop.waveGeneration,pending:gameSettings.coop.localPhase||null,result:gameSettings.coop.result||null})'),
    {round:3,turn:1,generation:{version:1,seed:42,lastRound:3},pending:null,result:null});
  assert.deepEqual([model.waves,model.phases,model.births],[3,3,11]);
  const final=JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
  // All branches must also reproduce the same terminal result after explicit deaths.
  for(const entity of entities.expected().filter(e=>e.owner===3)) {
    f.evaluate(entity.kind==='unit'?`grid.getUnit({x:${entity.x},y:${entity.y}}).kill(); undefined`:'external.find(p=>p.isDemonPortal).destroy(); undefined');
    entities.record({type:'death',id:entity.id}); check('remove-'+entity.id);
  }
  f.evaluate('nextTurn()');
  f.compare('future-result',f.evaluate('gameSettings.coop.result'),'victory');
  entities.check('terminal-entities'); economy.check('terminal-economy');
  const terminal=f.evaluate('({round:gameRound,turn:whooseTurn,events:turnEvents})');
  f.evaluate('nextTurn(); nextTurn()');
  f.compare('terminal-no-duplicate-progression',f.evaluate('({round:gameRound,turn:whooseTurn,events:turnEvents})'),terminal);
  console.log(`PASS continuation ${saved?JSON.parse(saved.json).gameSettings.coop.localPhase.stage:'baseline'} expected_waves=3 observed_waves=${model.waves} expected_phases=3 observed_phases=${model.phases} expected_births=11 observed_births=${model.births} result=victory`);
  return {snapshots,final};
}
if(process.argv[2]==='--fault') {
  const baseline=run(); run(baseline.snapshots.demon,process.argv[3]);
} else {
  const baseline=run();
  for(const stage of ['wave','demon','complete']) {
    const resumed=run(baseline.snapshots[stage]);
    assert.deepEqual(resumed.final,baseline.final,'full continuation state '+stage);
    console.log('PASS full-saved-continuation-'+stage+' expected=baseline observed=identical');
  }
  console.log('INAPPLICABLE online committed revisions: local save/load fixtures have no network commits. Full persisted continuation state compared across fresh runtimes. Demon combat selection is stationary in these persistence fixtures; real combat dispatcher is covered by the local-round regression. No purchases, production or income assets; one independently declared noob salary per human refresh. Wave RNG is round-local seed/version, so no mutable random cursor exists.');
  for(const fault of ['duplicate-wave','skip-phase','seed']) {
    const child=spawnSync(process.execPath,[__filename,'--fault',fault],{encoding:'utf8',maxBuffer:32*1024*1024});
    process.stderr.write(child.stderr);
    assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
    console.log(`PASS rejects-${fault} expected_exit=1 observed_exit=${child.status}`);
  }
  console.log('PASS co-op save-phase snapshots=3 restored=3 future_rounds=3 fault_probes=3');
}
