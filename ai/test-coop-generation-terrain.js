const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const {expectedMap, initialEntities} = require('./test-coop-generation-fixtures');

const fault = process.argv[2];
const seeds = [0,1,2,7,42,99,12345,2147483648,4294967295];
const f = createFixture(undefined, line => {
  if (!line.includes('"scenario":"fixture-initial-state"')) console.log(line);
});
for (const count of [2,3,4]) for (const seed of seeds) {
  const label = `terrain-humans-${count}-seed-${seed}`;
  const expected = expectedMap(count,seed);
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{seed:${seed}});`);
  if (fault === '--missing') f.evaluate('generated.lakes=[]');
  if (fault === '--overlap') f.evaluate('generated.bushes[0]={...generated.mountains[0]}');
  const actual = f.evaluate('JSON.parse(JSON.stringify(generated))');
  const categories = {...Object.fromEntries(['goldmines','bushes','mountains','lakes'].map(k=>[k,actual[k].length])),
    neutralTowns:actual.players[0].towns.length};
  f.compare(label+'-required-categories', categories,
    {goldmines:count,bushes:count,mountains:count,lakes:count,neutralTowns:count});
  const towns = actual.players.flatMap(p=>p.towns);
  const terrain = ['goldmines','bushes','mountains','lakes'].flatMap(k=>actual[k]);
  const all = [...towns,...terrain];
  f.compare(label+'-legal-placement', {
    unique: new Set(all.map(c=>`${c.x},${c.y}`)).size,
    total:all.length,
    inBounds:all.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&
      c.x>=0&&c.y>=0&&c.x<actual.mapSize.x&&c.y<actual.mapSize.y),
    clearTownNeighborhoods:terrain.every(c=>towns.every(t=>Math.abs(c.x-t.x)>1||Math.abs(c.y-t.y)>1)),
    neutralMines:actual.goldmines.every(c=>c.owner===0&&c.income===20)
  },{unique:count*6,total:count*6,inBounds:true,clearTownNeighborhoods:true,neutralMines:true});
  f.compare(label+'-independent-layout',actual,expected);
  f.compare(label+'-seed-replay',f.evaluate(`JSON.stringify(generated)===JSON.stringify(generateCoopGame(${count},{seed:${seed}}))`),true);
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
  f.evaluate('globalThis.terrainSave=JSON.stringify(getGameObject());loadFromJson(terrainSave)');
  for(const e of initial) entities.bind(e.id,`grid.${e.kind==='unit'?'getUnit':'getBuilding'}({x:${e.x},y:${e.y}})`);
  f.evaluate('for(const [e] of ledgerObjects) if((e.isUnit?grid.getUnit(e.coord):grid.getBuilding(e.coord))!==e) ledgerObjects.delete(e)');
  check('-restored');
  f.compare(label+'-serialized-roundtrip',f.evaluate('JSON.stringify(getGameObject())===terrainSave'),true);
}
console.log('INAPPLICABLE no combat, movement, income/expense events or completed rounds: generation, start and restore only; initial entity/economy/turn invariants checked after each start and restore. No online transport or committed revisions in this terrain task.');
for(const [arg,marker] of [['--missing','required-categories'],['--overlap','legal-placement']]) {
  const child=spawnSync(process.execPath,[__filename,arg],{encoding:'utf8'});
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/); assert.ok(child.stderr.includes(marker));
  console.log(`PASS corruption-probe ${arg} expected_exit=1 observed_exit=${child.status} marker=${marker}`);
}
console.log('PASS co-op generation terrain scenarios=27 counts=2,3,4 seeds='+seeds.join(','));
