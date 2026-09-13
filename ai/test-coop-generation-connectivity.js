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
// Independent offset-hex traversal: no production neighbor table, Way, or
// connectivity helper. Hostile buildings are endpoints, never transit cells.
function neighbours(c) {
  const shift = c.x % 2 ? 0 : -1;
  return [{x:c.x,y:c.y-1},{x:c.x,y:c.y+1},
    ...[-1,1].flatMap(dx=>[0,1].map(dy=>({x:c.x+dx,y:c.y+shift+dy})))];
}
function routes(map) {
  const targets = [...map.portals,...map.players[0].towns,...map.goldmines];
  const endpoints = new Set([...map.portals,...map.players[0].towns].map(key));
  return map.players.slice(1,1+map.coop.initialHumanCount).map((p,i)=> {
    const blocked = new Set([...map.lakes,...map.mountains,
      ...map.players.slice(1).flatMap((p,j)=>j===i?[]:p.towns)].map(key));
    const seen = new Set(), stack = [p.towns[0]];
    while(stack.length) {
      const c = stack.pop(), id=key(c);
      if(c.x<0||c.y<0||c.x>=map.mapSize.x||c.y>=map.mapSize.y||blocked.has(id)||seen.has(id)) continue;
      seen.add(id);
      if(!endpoints.has(id)) stack.push(...neighbours(c));
    }
    return targets.map(c=>seen.has(key(c)));
  });
}
function checkRoutes(label,map) {
  compare(label+'-all-targets',routes(map),Array.from({length:map.coop.initialHumanCount},
    ()=>Array(map.portals.length+map.players[0].towns.length+map.goldmines.length).fill(true)));
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
const seeds=[0,1,2,7,42,99,12345,2147483648,4294967295];
for(const count of [2,3,4]) for(const seed of seeds) {
  const label=`matrix-${count}-${seed}`, expected=expectedMap(count,seed);
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{seed:${seed}})`);
  const actual=f.evaluate('JSON.parse(JSON.stringify(generated))');
  compare(label+'-independent-layout',actual,expected);
  checkRoutes(label,actual);
  compare(label+'-replay',f.evaluate(`JSON.stringify(generated)===JSON.stringify(generateCoopGame(${count},{seed:${seed}}))`),true);
  startAndCheck(label,expected);
}
// Two isolated corner portals: each has both in-bounds neighbors blocked.
const adversarial=expectedMap(2,1);
adversarial.players[1].towns=[{x:3,y:3}]; adversarial.players[2].towns=[{x:9,y:3}];
adversarial.portals=[{x:0,y:0},{x:12,y:0}];
adversarial.goldmines=[{x:0,y:8,owner:0,income:20},{x:9,y:8,owner:0,income:20}];
adversarial.bushes=[{x:4,y:0},{x:8,y:0}];
adversarial.lakes=[{x:0,y:1},{x:1,y:0}]; adversarial.mountains=[{x:11,y:0},{x:12,y:1}];
compare('adversarial-before-isolated',routes(adversarial),Array.from({length:2},()=>[false,false,true,true,true,true]));
f.context.adversarial=copy(adversarial);
f.evaluate('globalThis.generated=generateCoopGame(2,{seed:1});Object.assign(generated,JSON.parse(JSON.stringify(adversarial)))');
if(process.argv.includes('--skip-repair')) checkRoutes('corruption-unrepaired',adversarial);
compare('adversarial-bounded-repair',f.evaluate('repairCoopConnectivity(generated)'),
  {status:'connected',relocated:3,placementLimit:351});
const repaired=copy(adversarial);
repaired.lakes=[{x:0,y:1},{x:0,y:2}]; repaired.mountains=[{x:11,y:0},{x:0,y:3}];
compare('adversarial-exact-repair',f.evaluate('JSON.parse(JSON.stringify(generated))'),repaired);
checkRoutes('adversarial-repaired',repaired);
compare('adversarial-idempotent',f.evaluate('repairCoopConnectivity(generated)'),{status:'connected',relocated:0,placementLimit:0});
compare('adversarial-replay',f.evaluate('JSON.stringify(generated)===JSON.stringify((() => {const m=JSON.parse(JSON.stringify(adversarial));repairCoopConnectivity(m);return m;})())'),true);
startAndCheck('adversarial',repaired);
// Every terrain cell is a blocker: there is no room to preserve categories
// outside reserved town neighborhoods. A finite scan must explicitly fail.
f.context.impossible=copy(adversarial);
compare('adversarial-no-space-explicit-failure',f.evaluate(`(() => {
  impossible.lakes=[]; impossible.mountains=[];
  const occupied=[...impossible.players.flatMap(p=>p.towns),...impossible.portals,...impossible.goldmines,...impossible.bushes];
  for(let x=0;x<13;x++) for(let y=0;y<9;y++) if(!occupied.some(c=>c.x===x&&c.y===y)) impossible.lakes.push({x,y});
  try {repairCoopConnectivity(impossible);return 'unexpected success';}
  catch(e){return e.message.split(' placement')[0];}
})()`),'Co-op connectivity repair failed: no safe lakes');
// Broad cheap matrix also covers seeds beyond the exact-layout start fixtures.
for(const count of [2,3,4]) for(let seed=3;seed<103;seed++) {
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{seed:${seed}})`);
  checkRoutes(`broad-${count}-${seed}`,f.evaluate('JSON.parse(JSON.stringify(generated))'));
  compare(`broad-${count}-${seed}-replay`,f.evaluate(`JSON.stringify(generated)===JSON.stringify(generateCoopGame(${count},{seed:${seed}}))`),true);
}
const probe=spawnSync(process.execPath,[__filename,'--skip-repair'],{encoding:'utf8',timeout:30000});
assert.equal(probe.status,1); assert.match(probe.stderr,/corruption-unrepaired-all-targets/);
console.log('PASS corruption-probe expected_exit=1 observed_exit=1 marker=corruption-unrepaired-all-targets');
console.log('INAPPLICABLE no game actions, rounds, income/expense events or online revisions: generation/start/restore and read-only movement queries only; shared ledgers checked at all 56 start/restore checkpoints.');
console.log('PASS co-op generation connectivity scenarios=327 adversarial=2 invariant_checkpoints=56');
