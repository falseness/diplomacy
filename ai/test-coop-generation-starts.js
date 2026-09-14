const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const {expectedMap, initialEntities} = require('./test-coop-generation-fixtures');

const fault = process.argv[2];
const f = createFixture(undefined, line => {
  if (!line.includes('"scenario":"fixture-initial-state"')) console.log(line);
});
for (const size of ['tiny','normal','big']) for (const count of [1,2,3,4]) for (const seed of [0,1,31]) {
  const label = `starts-${size}-humans-${count}-seed-${seed}`;
  const fixed = expectedMap(count,seed,size);
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}});`);
  if (fault === '--missing') f.evaluate('generated.portals=[]');
  if (fault === '--overlap') f.evaluate('generated.portals[0]={...generated.players[1].towns[0]}');
  const actual = f.evaluate('JSON.parse(JSON.stringify(generated))');
  const {audit}=require('./test-coop-terrain-audit');
  assert.equal(actual.portals.length,count*({tiny:1,normal:2,big:3}[size]),'required-categories');
  audit(actual,label+' legal-placement');
  assert.deepEqual(actual.players,fixed.players,'independent starting roster');
  assert.equal(actual.goldmines.length,count);
  assert(actual.goldmines.every(m=>m.owner===0&&m.income===20));
  const expected=actual; // Coordinates audited above; runtime values below are literal expectations.
  console.log(JSON.stringify({scenario:'seed-indexed-placement',count,seed,
    expected:{starts:expected.players.slice(1,-1).map(p=>p.towns[0]),portals:expected.portals},
    observed:{starts:actual.players.slice(1,-1).map(p=>p.towns[0]),portals:actual.portals}}));
  f.compare(label+'-seed-replay',f.evaluate(`JSON.stringify(generated)===JSON.stringify(generateCoopGame(${count},{size:'${size}',seed:${seed}}))`),true);
  f.context.fixtureConfig = {actors:[{role:'neutral'},...Array.from({length:count},()=>({role:'human'})),{role:'demon'}]};
  f.evaluate(`generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];
    gameRound=0;gameExit=false;},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear();`);
  const initial = initialEntities(expected);
  const entities = createEntityLedger(f,initial);
  const economy = createEconomyLedger(f,[{role:'neutral',gold:0},
    ...Array.from({length:count},()=>({role:'human',gold:100})),{role:'demon',gold:0}],
    {income:{town:4},salary:{noob:1},purchase:{},production:{}});
  const turn = createTurnLedger(Array.from({length:count},(_,i)=>i+1));
  function check(stage) {
    f.compare(label+stage+'-starting-assets',f.evaluate(`players.map(p=>({role:p.role,gold:p.gold,
      towns:p.towns.map(t=>({coord:t.coord,hp:t.hp,owner:t.playerColor,suburbs:t.suburbs.length})),
      units:p.units.map(u=>({coord:u.coord,name:u.name,hp:u.hp,moves:u.moves,owner:u.playerColor}))}))`),
      [{role:'NEUTRAL',gold:0,towns:expected.players[0].towns.map(coord=>({coord,hp:10,owner:0,suburbs:1})),units:[]},
      ...expected.players.slice(1,-1).map((p,i)=>({role:'HUMAN',gold:100,
        towns:[{coord:p.towns[0],hp:10,owner:i+1,suburbs:7}],
        units:[{coord:p.towns[0],name:'noob',hp:2,moves:2,owner:i+1}]})),
      {role:'DEMONS',gold:0,towns:[],units:[]}]);
    f.compare(label+stage+'-portal-state',f.evaluate(`external.map(p=>({coord:p.coord,owner:p.playerColor,
      hp:p.hp,name:p.name,emptyUnit:grid.getUnit(p.coord).isEmpty(),territory:grid.getHexagon(p.coord).playerColor}))`),
      expected.portals.map(coord=>({coord,owner:count+1,hp:30,name:'demonPortal',emptyUnit:true,territory:count+1})));
    f.compare(label+stage+'-separate-ownership',f.evaluate(`new Set(players).size===players.length &&
      new Set(players.map(p=>p.towns)).size===players.length &&
      new Set(players.map(p=>p.units)).size===players.length`),true);
    entities.check(label+stage+'-entities');
    economy.check(label+stage+'-economy');
    turn.check(label+stage+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
    f.compare(label+stage+'-serialized-mines',f.evaluate('JSON.parse(JSON.stringify(goldmines))'),
      expected.goldmines.map(c=>({name:'goldmine',coord:{x:c.x,y:c.y},income:20})));
    f.compare(label+stage+'-town-owners',f.evaluate('players.map(p=>p.towns.map(t=>t.playerColor))'),
      [Array(count).fill(0),...Array.from({length:count},(_,i)=>[i+1]),[]]);
    f.compare(label+stage+'-metadata',f.evaluate('gameSettings.coop'),expected.coop);
  }
  check('-started');
  f.evaluate('globalThis.startsSave=JSON.stringify(getGameObject());loadFromJson(startsSave)');
  for(const e of initial) entities.bind(e.id,`grid.${e.kind==='unit'?'getUnit':'getBuilding'}({x:${e.x},y:${e.y}})`);
  f.evaluate('for(const [e] of ledgerObjects) if((e.isUnit?grid.getUnit(e.coord):grid.getBuilding(e.coord))!==e) ledgerObjects.delete(e)');
  check('-restored');
  f.compare(label+'-serialized-roundtrip',f.evaluate('JSON.stringify(getGameObject())===startsSave'),true);
}
console.log('INAPPLICABLE no combat, movement, income/expense events or completed rounds: generation, start and restore only; initial entity/economy/turn invariants checked after each start and restore. No online transport or committed revisions in this starts task.');
for(const [arg,marker] of [['--missing','required-categories'],['--overlap','legal-placement']]) {
  const child=spawnSync(process.execPath,[__filename,arg],{encoding:'utf8',timeout:30000});
  console.log(`DELIBERATE CORRUPTION ${arg}\n${child.stdout}${child.stderr}`);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/); assert.ok(child.stderr.includes(marker));
  console.log(`PASS corruption-probe ${arg} expected_exit=1 observed_exit=${child.status} marker=${marker}`);
}
console.log('PASS co-op generation starts scenarios=36 counts=1,2,3,4 sizes=tiny,normal,big seeds=0,1,31');
