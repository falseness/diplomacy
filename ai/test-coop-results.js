const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

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
  f.evaluate(`new DemonPortal(${flood?'0,6':'4,4'}); undefined`);
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
  console.log(`PASS result-case ${name} expected=${expected} observed=${f.evaluate('players[0].coopResult')}`);
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
