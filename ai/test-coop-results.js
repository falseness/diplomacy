const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('../../diplomacy_server/tests/client/test-coop-entity-ledger');
const {createEconomyLedger} = require('../../diplomacy_server/tests/client/test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

// Usage: node ai/test-coop-results.js [--output-dir <dir>] [--fault]
const outIndex = process.argv.indexOf('--output-dir');
const output = outIndex < 0 ? null : process.argv[outIndex + 1];
const results = [];

function scenario(name, removals, expected, flood = false) {
  const c = defaultFixture(); c.coop = true;
  c.actors[0].towns = []; c.actors[1].units = [];
  if (flood) {
    c.actors[1].towns = []; c.actors[2].towns = [];
    c.actors[1].units = [{x:0,y:1,hp:2}];
    c.actors[2].units = [{x:0,y:3,hp:2}];
    c.actors[3].units = [{x:0,y:5,hp:2}];
  }
  const f = createFixture(c);
  const rows = flood ? [
    ['h1','unit',1,0,1],['h2','unit',2,0,3],['d','unit',3,0,5],['p','portal',3,0,6]
  ] : [
    ['t1','town',1,1,1],['h1','unit',1,1,1],['t2','town',2,7,1],
    ['h2','unit',2,7,1],['d','unit',3,7,5],['p','portal',3,4,4]
  ];
  f.evaluate(`new DemonPortal(${flood?'0,6':'4,4'},"melee"); undefined`);
  const initial = rows.map(([id,kind,owner,x,y]) => ({id,kind,owner,x,y,
    name:kind==='unit'?'noob':kind==='portal'?'demonPortal':'town'}));
  const entities = createEntityLedger(f,initial);
  const economy = createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),{});
  const turns = createTurnLedger([1,2]);
  const round = 0;
  f.evaluate(`globalThis.ends=0; menuBack=()=>{ends++;gameExit=true};
    gameSettings.isOnline=false; globalThis.turnTrace=[{type:'human',round:0,player:1}]; undefined`);
  function check(label, terminal=false) {
    entities.check(name+'-'+label+'-entities'); economy.check(name+'-'+label+'-economy');
    turns.check(name+'-'+label+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:gameExit ? [] : turnTrace})`),round,terminal);
  }
  function result(label, wanted) {
    f.compare(name+'-'+label,f.evaluate('({result:players[0].coopResult,ended:players[0].isGameEnded})'),
      {result:wanted,ended:wanted!==null});
  }
  check('initial'); result('initial-ongoing',null);
  for (const id of removals) {
    const row = initial.find(r=>r.id===id);
    const code = `grid.get${row.kind==='unit'?'Unit':'Building'}({x:${row.x},y:${row.y}}).${row.kind==='town'?'destroy':'kill'}(); undefined`;
    console.log(JSON.stringify({scenario:name,action:code,expectedDeath:id}));
    f.evaluate(code); entities.record({type:'death',id}); check('remove-'+id);
  }
  if (flood) {
    // One real sudden-death batch removes both sides. No per-death result hook
    // may end the game before the entire environmental action has resolved.
    console.log(JSON.stringify({scenario:name,action:'players[0].suddenDeath()',expectedDeaths:['h1','h2','d','p']}));
    f.evaluate('suddenDeathRound=0; players[0].suddenDeath(); undefined');
    for (const id of ['h1','h2','d','p']) entities.record({type:'death',id});
    // Flooding also constructs Sea terrain on each boundary cell.
    for(let x=0;x<9;x++) for(let y=0;y<7;y++) if(x===0||x===8||y===0||y===6) {
      const id=`sea-${x}-${y}`;
      entities.record({type:'spawn',entity:{id,kind:'nature',name:'sea',owner:0,x,y}});
      entities.bind(id,`grid.getBuilding({x:${x},y:${y}})`);
    }
    check('flood');
  }
  result('shared-result',process.argv.includes('--fault') && name==='victory-portals-first'?'defeat':expected);
  if (expected !== null) {
    f.evaluate('nextTurn(); nextTurn(); undefined');
    f.compare(name+'-terminal-once',f.evaluate('({exit:gameExit,result:gameSettings.coop.result,ends,round:gameRound,turn:whooseTurn})'),
      {exit:true,result:expected,ends:1,round:0,turn:1});
    check('terminal',true);
  }
  const observed = f.evaluate('players[0].coopResult');
  results.push({case:name, expected, observed, pass:true});
  console.log(`PASS result-case ${name} expected=${expected} observed=${observed}`);
}

// Demon-held territory: victory also needs the demon slot to own no town.
const TOWN = {x:6, y:3};
const SUBURBS = [{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}];
function territoryFixture() {
  const c = defaultFixture(); c.coop = true;
  const f = createFixture(c);
  f.evaluate(`globalThis.portal=new DemonPortal(4,4,"melee"); globalThis.demon=grid.getUnit({x:7,y:5});
    gameSettings.isOnline=false; menuBack=()=>{}; undefined`);
  return f;
}
const state = f => f.evaluate(`({result:players[0].coopResult, ended:players[0].isGameEnded,
  portalAlive:!portal.killed, demonUnits:players[3].units.filter(u=>!u.killed&&u.hp>0).map(u=>u.constructor.name),
  demonTowns:players[3].towns.filter(t=>!t.killed).map(t=>t.coord)})`);
function territory(name, run) {
  const {observed, expected} = run();
  const pass = JSON.stringify(observed) === JSON.stringify(expected);
  results.push({case:name, expected, observed, pass});
  assert.deepEqual(observed, expected, name);
  console.log(`PASS result-case ${name} expected=${expected.result} observed=${observed.result}`);
}
territory('town-blocks-victory', () => {
  const f = territoryFixture();
  f.evaluate(`for(const c of ${JSON.stringify(SUBURBS)}) grid.getHexagon(c).firstpaint(3);
    globalThis.target=new Town(${TOWN.x},${TOWN.y},true); portal.kill(); demon.kill(); undefined`);
  return {observed:state(f),
    expected:{result:null, ended:false, portalAlive:false, demonUnits:[], demonTowns:[TOWN]}};
});
territory('retake-wins', () => {
  const f = territoryFixture();
  f.evaluate(`for(const c of ${JSON.stringify(SUBURBS)}) grid.getHexagon(c).firstpaint(3);
    globalThis.target=new Town(${TOWN.x},${TOWN.y},true); portal.kill(); demon.kill(); undefined`);
  const before = state(f);
  // A red Noob next to the hp-0 demon town walks in and captures it.
  f.evaluate(`grid.getHexagon({x:5,y:3}).firstpaint(1); globalThis.attacker=new Noob(5,3); target.hp=0;
    whooseTurn=1; attacker.select(); attacker.sendInstructions(grid.getCell(${JSON.stringify(TOWN)})); undefined`);
  const after = state(f);
  return {observed:{before:before.result, ...after,
      townOwner:f.evaluate('target.playerColor'), humanOwns:f.evaluate('players[1].towns.includes(target)')},
    expected:{before:null, result:'victory', ended:true, portalAlive:false, demonUnits:[], demonTowns:[],
      townOwner:1, humanOwns:true}};
});
territory('produced-unit-blocks-victory', () => {
  const f = territoryFixture();
  // A Noob bought by the demon economy is an ordinary unit on a demon-slot hex.
  f.evaluate(`portal.kill(); demon.kill(); grid.getHexagon({x:8,y:5}).firstpaint(3);
    globalThis.produced=new Noob(8,5); undefined`);
  const blocked = state(f);
  f.evaluate('produced.kill(); undefined');
  const cleared = state(f);
  return {observed:{...blocked, afterKill:cleared.result},
    expected:{result:null, ended:false, portalAlive:false, demonUnits:['Noob'], demonTowns:[], afterKill:'victory'}};
});
if (output) {
  fs.mkdirSync(output, {recursive:true});
  fs.writeFileSync(path.join(output, 'cases.json'), JSON.stringify(results, null, 2) + '\n');
}
scenario('no-demon-towns',[],null);
scenario('portals-remain',['d'],null);
scenario('demons-remain',['p'],null);
scenario('victory-portals-first',['p','d'],'victory');
scenario('victory-demons-first',['d','p'],'victory');
scenario('eliminated-human-shares-victory',['h2','t2','p','d'],'victory');
scenario('one-human-eliminated',['h2','t2'],null);
scenario('human-town-only',['h1','h2','t2'],null);
scenario('human-unit-only',['t1','h2','t2'],null);
scenario('defeat-portals-remain',['d','h1','t1','h2','t2'],'defeat');
scenario('defeat-demons-remain',['p','h1','t1','h2','t2'],'defeat');
scenario('simultaneous-flood-draw',[],'draw',true);
console.log('INAPPLICABLE online committed convergence: offline fixtures have no online commits. Mutation scenarios do not advance rounds or invoke economic hooks; shared ledgers check zero balance events and unchanged round after each action. The following real local-round suite checks human skipping, survivor continuation, income/salary and exactly one wave/demon phase per completed round.');
if (!process.argv.includes('--fault')) {
  const rounds=spawnSync(process.execPath,['ai/test-coop-local-round.js'],{encoding:'utf8',maxBuffer:32*1024*1024});
  process.stdout.write(rounds.stdout); process.stderr.write(rounds.stderr);
  assert.equal(rounds.status,0,'local survivor rounds');
  console.log('PASS survivor-round-suite expected_exit=0 observed_exit=0');
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
  assert.match(child.stderr,/victory-portals-first-shared-result/);
  console.log('PASS rejects-wrong-result expected_exit=1 observed_exit=1');
}
