const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {expectedMap, initialEntities} = require('./test-coop-generation-fixtures');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const f = createFixture(undefined, () => {});
const key = c => `${c.x},${c.y}`;
const copy = x => JSON.parse(JSON.stringify(x));
function compare(label, actual, expected) {
  console.log(JSON.stringify({scenario:label,expected,observed:actual}));
  assert.deepEqual(actual, expected, label);
  console.log('PASS '+label);
}
function startAndCheck(label, expected) {
  const count = expected.coop.initialHumanCount;
  f.context.fixtureConfig={actors:[{role:'neutral'},...Array.from({length:count},()=>({role:'human'})),{role:'demon'}]};
  f.evaluate(`generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];
    gameRound=0;gameExit=false;},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear();`);
  const initial=initialEntities(expected), entities=createEntityLedger(f,initial);
  const economy=createEconomyLedger(f,[{role:'neutral',gold:0},...Array.from({length:count},()=>({role:'human',gold:100})),
    {role:'demon',gold:0}],{income:{town:4},salary:{noob:1},purchase:{},production:{}});
  const turn=createTurnLedger(Array.from({length:count},(_,i)=>i+1));
  function check(stage) {
    entities.check(label+stage+'-entities'); economy.check(label+stage+'-economy');
    turn.check(label+stage+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
    // Verify the independent edges against actual single-step movement rules.
    // Read-only path queries: no moves, captures, combat or economic events.
    f.context.routeMap=expected;
    compare(label+stage+'-runtime-movement-rules',f.evaluate(`(() => {
      const terminals=new Set([...routeMap.portals,...routeMap.players[0].towns].map(c=>c.x+','+c.y));
      const targets=[...routeMap.portals,...routeMap.players[0].towns,...routeMap.goldmines];
      return players.slice(1,${count+1}).map(p=> {
        const start=p.units[0].coord, way=new Way(), seen=new Set([start.x+','+start.y]), queue=[start];
        for(let i=0;i<queue.length;i++) {
          const c=queue[i]; if(terminals.has(c.x+','+c.y)) continue;
          for(const n of grid.getHexagon(c).neighbours) {
            if(isCoordNotOnMap(n,grid.arr.length,grid.arr[0].length)||way.isCellImpassable(n,start,grid.arr,p.units[0].playerColor)) continue;
            const id=n.x+','+n.y; if(!seen.has(id)){seen.add(id);queue.push(n);}
          }
        }
        return targets.map(c=>seen.has(c.x+','+c.y));
      });
    })()`),Array.from({length:count},()=>Array(count*3).fill(true)));
  }
  check('-started');
  f.evaluate('globalThis.connectivitySave=JSON.stringify(getGameObject());loadFromJson(connectivitySave)');
  for(const e of initial) entities.bind(e.id,`grid.${e.kind==='unit'?'getUnit':'getBuilding'}({x:${e.x},y:${e.y}})`);
  f.evaluate('for(const [e] of ledgerObjects) if((e.isUnit?grid.getUnit(e.coord):grid.getBuilding(e.coord))!==e) ledgerObjects.delete(e)');
  check('-restored');
  compare(label+'-save-roundtrip',f.evaluate('JSON.stringify(getGameObject())===connectivitySave'),true);
}
const {evaluateBalance,balanced}=require('./test-coop-balance-evaluator');
compare('central-exact-tolerances',f.evaluate('COOP_START_BALANCE'),{assetDisparity:0,pathDisparity:4});
function checkBalance(label,map,expectedPass=true) {
  const metrics=evaluateBalance(map);
  console.log(JSON.stringify({scenario:label+'-per-human-metrics',metrics,bounds:{assets:0,paths:4}}));
  compare(label+'-independent-bound',balanced(metrics),expectedPass);
  f.context.balanceInput=copy(map);
  compare(label+'-production-bound',f.evaluate('coopStartsBalanced(balanceInput)'),expectedPass);
  compare(label+'-production-metrics',f.evaluate('coopStartBalanceMetrics(balanceInput)'),
    metrics.map(m=>({gold:m.gold,towns:m.towns,units:m.units,paths:[m.mine,m.town,m.portal]})));
}
// Literal fallback geometry provides exact four-edge boundary distances.
const boundary=expectedMap(2,1);
boundary.players[1].towns=[{x:3,y:2}]; boundary.players[2].towns=[{x:9,y:6}];
boundary.goldmines=[{x:3,y:0,owner:0,income:20},{x:9,y:0,owner:0,income:20}];
boundary.portals=[{x:3,y:8},{x:9,y:8}];
boundary.lakes=[{x:1,y:0},{x:7,y:0}];
boundary.mountains=[{x:2,y:8},{x:8,y:8}];
boundary.bushes=[{x:1,y:4},{x:7,y:4}];
compare('exact-path-boundary',evaluateBalance(boundary).map(m=>[m.mine,m.portal]),[[2,6],[6,2]]);
checkBalance('at-four-edge-bound',boundary);
const outside=copy(boundary);outside.players[1].towns[0].y=1;
compare('exact-outside-boundary',evaluateBalance(outside).map(m=>[m.mine,m.portal]),[[1,7],[6,2]]);
checkBalance('outside-five-edge-bound',outside,false);
if(process.argv.includes('--accept-unbalanced')) checkBalance('corruption-unbalanced',outside,true);
for(const kind of ['gold','towns','units']) {
  const bad=copy(boundary);
  if(kind==='gold') bad.players[1].gold++;
  else bad.players[1][kind].push({x:4,y:2});
  checkBalance('unequal-'+kind,bad,false);
}
const unreachable=copy(boundary);
unreachable.lakes.push({x:3,y:1},{x:2,y:0},{x:2,y:1},{x:4,y:0},{x:4,y:1});
checkBalance('unreachable-target',unreachable,false);
f.context.balanceInput=copy(outside);
compare('impossible-bound-explicit-failure',f.evaluate(`(() => {
 try {enforceCoopStartBalance(balanceInput);return 'unexpected success';}
 catch(e){return e.message;}
})()`),'Co-op starting balance bound cannot be satisfied');
const seeds=[0,1,2,7,42,99,12345,2147483648,4294967295];
for(const count of [2,3,4]) for(const seed of seeds) {
 const label=`matrix-${count}-${seed}`;
 f.evaluate(`globalThis.generated=generateCoopGame(${count},{seed:${seed}})`);
 const actual=f.evaluate('JSON.parse(JSON.stringify(generated))'), expected=expectedMap(count,seed);
 compare(label+'-independent-layout',actual,expected);
 checkBalance(label,actual);
 compare(label+'-replay',f.evaluate(`JSON.stringify(generated)===JSON.stringify(generateCoopGame(${count},{seed:${seed}}))`),true);
 startAndCheck(label,expected);
}
// Verify deterministic repair of a deliberately clustered mine/portal layout.
const clustered=copy(boundary);
clustered.goldmines=[{x:0,y:0,owner:0,income:20},{x:0,y:2,owner:0,income:20}];
clustered.portals=[{x:0,y:6},{x:0,y:8}];
checkBalance('clustered-before',clustered,false);
f.context.balanceInput=copy(clustered);
f.evaluate('enforceCoopStartBalance(balanceInput)');
compare('clustered-exact-repair',f.evaluate('balanceInput'),boundary);
checkBalance('clustered-after',f.evaluate('balanceInput'));
f.evaluate('enforceCoopStartBalance(balanceInput)');
compare('repair-idempotent',f.evaluate('balanceInput'),boundary);
for(const count of [2,3,4]) for(let seed=3;seed<103;seed++) {
 f.evaluate(`globalThis.generated=generateCoopGame(${count},{seed:${seed}})`);
 checkBalance(`broad-${count}-${seed}`,f.evaluate('JSON.parse(JSON.stringify(generated))'));
}
const probe=spawnSync(process.execPath,[__filename,'--accept-unbalanced'],{encoding:'utf8',timeout:30000});
assert.equal(probe.status,1);assert.match(probe.stderr,/corruption-unbalanced-independent-bound/);
console.log('PASS corruption-probe expected_exit=1 observed_exit=1 marker=corruption-unbalanced-independent-bound');
console.log('INAPPLICABLE no gameplay actions, completed rounds, income/expense events or online revisions; generation/start/restore and read-only movement queries only. Shared ledgers checked at all 54 start/restore checkpoints.');
console.log('PASS co-op generation balance scenarios=327 counts=2,3,4 invariant_checkpoints=54');
