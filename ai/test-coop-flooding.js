const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function run(terminal = false, reverse = false) {
  const name = terminal ? `simultaneous-${reverse ? 'reverse' : 'forward'}` : 'cadence';
  const c = defaultFixture(); c.coop = true; c.size = {x:9,y:9};
  c.actors.forEach(a => {a.towns=[];a.units=[];});
  const rows = terminal ? [
    ['h1',1,0,4],['h2',2,8,4],['d',3,4,0]
  ] : [
    ['h1-edge',1,0,4],['h1-inner',1,1,4],['h1-safe',1,3,4],
    ['h2-edge',2,8,4],['h2-inner',2,7,4],['h2-safe',2,5,4],
    ['d-edge',3,4,0],['d-inner',3,4,1],['d-safe',3,4,4]
  ];
  rows.forEach(([,owner,x,y]) => c.actors[owner].units.push({x,y,hp:2}));
  const f = createFixture(c);
  const initial = rows.map(([id,owner,x,y])=>({id,owner,x,y,kind:'unit',name:'noob'}));
  f.evaluate('new DemonPortal(0,0,"melee"); undefined');
  initial.push({id:'portal',owner:3,x:0,y:0,kind:'portal',name:'demonPortal'});
  // Block every radius-1/2 destination at this corner until the portal floods.
  // The oversized square is deliberate: this fixture is about flooding, not
  // deriving the production hex-distance implementation a second time.
  for(let x=0;x<=2;x++) for(let y=0;y<=3;y++) if(x||y) {
    f.evaluate(`new Mountain(${x},${y}); undefined`);
    initial.push({id:`m-${x}-${y}`,owner:0,x,y,kind:'nature',name:'mountain'});
  }
  const entities=createEntityLedger(f,initial);
  const economy=createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),{salary:{noob:1}});
  f.compare(`${name}-salary-rule`,f.evaluate("Noob.salary"),1);
  const turns=createTurnLedger([1,2]);
  let round=0, prefix=1, serial=0;
  const live=new Map(initial.map(row=>[row.id,row]));
  const flooded=new Set();
  function check(label) {
    entities.check(`${name}-${label}-entities`); economy.check(`${name}-${label}-economy`);
    const ended=terminal && round===2;
    turns.check(`${name}-${label}-turn`,f.evaluate('({round:gameRound,terminal:gameExit,events:trace})'),
      round,ended,ended?undefined:prefix);
  }
  f.context.income = owner => {
    const count=terminal?1:round<2?3:round<4?2:1;
    economy.record({id:`salary-${serial++}`,owner,type:'salary',rule:'noob',count});
    check(`refresh-${owner}-${serial}`);
  };
  // No typed wave before round 4; the portal floods at round 2. An
  // independent integer oracle: 1111, 1122, 2231, 325, 3454.
  f.context.wave = result => {
    f.compare(`${name}-wave-${round+1}`,JSON.parse(JSON.stringify(result)),{spawned:[],skipped:0});
    prefix++;check(`wave-${round+1}`);
  };
  f.context.demon = () => {prefix++;check(`demon-${round+1}`);};
  f.context.saved = () => {prefix++;check(`human-${round}`);};
  f.context.completed = () => {
    round++;
    // Independent square-boundary oracle. Existing cadence floods complete
    // rows/columns at layer 0, then layer 1 two rounds later (including old sea).
    if(round===2 || round===4) {
      const layer=round===2?0:1;
      const affected=(x,y)=>x===layer||x===8-layer||y===layer||y===8-layer;
      for(const [id,row] of live) if(affected(row.x,row.y)) {
        entities.record({type:'death',id}); live.delete(id);
      }
      for(let x=0;x<9;x++) for(let y=0;y<9;y++) if(affected(x,y)) {
        const row={id:`sea-${round}-${x}-${y}`,owner:0,x,y,kind:'nature',name:'sea'};
        entities.record({type:'spawn',entity:row});entities.bind(row.id,`grid.getBuilding({x:${x},y:${y}})`);
        live.set(row.id,row);flooded.add(`${x},${y}`);
      }
    }
    prefix=turns.expected(round).length-1;
    check(`complete-${round}`);
    const expectedSea=[...flooded].sort();
    f.compare(`${name}-boundary-${round}`,f.evaluate(`grid.arr.flat().filter(c=>c.building.name==='sea').map(c=>c.coord.x+','+c.coord.y).sort()`),
      process.argv.includes('--fault') && round===2 ? [] : expectedSea);
    const survivors=terminal?(round<2?1:0):round<2?3:round<4?2:1;
    f.compare(`${name}-casualties-${round}`,f.evaluate('({units:players.map(p=>p.units.filter(u=>!u.killed).length),portals:external.filter(p=>p.isDemonPortal).length})'),
      {units:[0,survivors,survivors,survivors],portals:round<2?1:0});
    console.log(`PASS ${name} casualties boundary=${round} expected_units=0,${survivors},${survivors},${survivors} observed_units=${f.evaluate('players.map(p=>p.units.filter(u=>!u.killed).length)').join(',')} expected_portals=${round<2?1:0} observed_portals=${f.evaluate('external.filter(p=>p.isDemonPortal).length')}`);
    const result=terminal&&round===2?'draw':null;
    f.compare(`${name}-result-${round}`,f.evaluate('({result:gameSettings.coop.result,exit:gameExit,ends,threshold:suddenDeathRound})'),
      {result,exit:result!==null,ends:result===null?0:1,threshold:2});
    console.log(`PASS ${name} boundary=${round} expected_sea=${expectedSea.length} observed_sea=${f.evaluate("grid.arr.flat().filter(c=>c.building.name==='sea').length")} expected_result=${result} observed_result=${f.evaluate('gameSettings.coop.result')}`);
  };
  f.evaluate(`suddenDeathRound=2; gameSettings.isOnline=false;
    globalThis.ends=0;menuBack=()=>{ends++;gameExit=true};
    globalThis.trace=[{type:'human',round:0,player:1}];
    AiRuntime.trainFromHumanCommands=()=>{};gameEvent.nextTurn=()=>{};
    timer={pauseAndSaveTime(){},setNextTurnTime(){}};nextTurnPauseInterface={visible:false};
    globalThis.saveManager={save(){trace.push({type:'human',round:gameRound,player:whooseTurn});saved()}};
    for(const owner of [1,2]) {
      const next=players[owner].nextTurn.bind(players[owner]);
      players[owner].nextTurn=()=>{next();income(owner)};
    }
    const spawn=spawnCoopWave;
    spawnCoopWave=r=>{trace.push({type:'wave',round:gameRound});const result=spawn(r);wave(result);return result};
    // Stationary demon fixture isolates environmental casualties; production
    // turn refresh, wave generation, placement and neutral flooding all run.
    players[3].play=()=>{trace.push({type:'demon',round:gameRound});demon()};
    const neutral=players[0].nextTurn.bind(players[0]);
    players[0].nextTurn=()=>{neutral();trace.push({type:'complete',round:gameRound-1});completed()};
    globalThis.cellOrder=[];
    const flood=players[0].floodCell.bind(players[0]);
    const sudden=players[0].suddenDeath.bind(players[0]);
    players[0].suddenDeath=()=>{
      const cells=[];players[0].floodCell=(x,y)=>cells.push([x,y]);
      try {sudden()} finally {players[0].floodCell=flood}
      if(${reverse}) cells.reverse();
      for(const [x,y] of cells) {cellOrder.push([x,y]);flood(x,y)}
    }; undefined`);
  check('initial');
  for(let r=0;r<(terminal?2:5);r++) {
    f.evaluate('nextTurn()');check(`human-action-${r}-1`);
    f.evaluate('nextTurn()');check(`human-action-${r}-2`);
  }
  if(terminal) {
    f.compare(`${name}-terminal-idempotent`,f.evaluate('nextTurn(); nextTurn(); ({ends,round:gameRound,result:gameSettings.coop.result})'),
      {ends:1,round:2,result:'draw'});check('terminal-idempotent');
  } else {
    f.compare('flooded-portal-no-spawn',f.evaluate('placeCoopWave({selections:[{type:"imp",x:0,y:0},{type:"brute",x:0,y:1},{type:"demonLord",x:0,y:2}]})'),{spawned:[],skipped:3});
    check('post-flood-spawn');
    f.compare('both-sides-casualties',f.evaluate('players.map(p=>p.units.filter(u=>!u.killed).length)'),[0,1,1,1]);
    f.compare('portal-removed',f.evaluate('external.filter(p=>p.isDemonPortal).length'),0);
  }
  return f.evaluate('cellOrder');
}
run();
const forward=run(true,false), reverse=run(true,true);
assert.deepStrictEqual(reverse,[...forward].reverse(),'actual flood traversal reversed');
console.log('PASS simultaneous-order expected=reverse(forward) observed=reverse(forward) forward_result=draw reverse_result=draw');
console.log('INAPPLICABLE online committed convergence: offline fixtures have no online committed revisions. Shared entity checks include serialized live entities. No purchases, production or income-producing assets; independent salary events check each human. Demon combat selection is a stationary fixture stub; real demon refresh, wave generation/placement, flooding and dispatcher run.');
if(!process.argv.includes('--fault')) {
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  process.stderr.write(child.stderr);
  assert.equal(child.status,1);assert.match(child.stderr,/AssertionError/);assert.match(child.stderr,/cadence-boundary-2/);
  console.log('PASS rejects-wrong-flood-boundary expected_exit=1 observed_exit=1');
}
