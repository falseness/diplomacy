const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

const {initialEntities} = require('./test-coop-generation-fixtures');
// Literal version-4 contract, independent of production scaling helpers.
const colors = [{r:255,g:0,b:0},{r:98,g:168,b:222},{r:60,g:190,b:100},{r:230,g:170,b:40}];
const sideFor = count => Math.max(15, Math.ceil(25*Math.sqrt(count/4)));
// Divided Valley terrain follows 8/6/10% density within 2 points of area.
const terrainWithin = (actual, area, percent) => Math.abs(actual - Math.round(area*percent/100)) <= area*0.02;
function run() {
  const f = createFixture(undefined, line => {
    if (!line.includes('\"scenario\":\"fixture-initial-state\"')) console.log(line);
  });
  const exposed = f.evaluate('Object.values(maps).flatMap(group => group.map(m => m.players.length - 1))');
  f.compare('local-online-count-limits', [Math.min(...exposed), Math.max(...exposed)], [2,4]);
  const menu = require('fs').readFileSync(require('path').join(__dirname,'../menu/menu.js'),'utf8');
  assert.equal((menu.match(/^        let getKeyPlayers = function\(value\) \{ return value \+ 2 \}/gm)||[]).length,2);
  for (const count of [2,3,4]) for (const seed of [0,1,42,4294967295]) {
    const label = `humans-${count}-seed-${seed}`;
    const expectedCoop = {initialHumanCount:count, humanSlots:Array.from({length:count},(_,i)=>i+1),
      humanTeam:'HUMANS', demonSlot:count+1,
      generation:{version:4,playerCount:count,seed,size:'normal',options:{seed,size:'normal'}}};
    f.evaluate(`globalThis.beforeGeneration = JSON.stringify(getGameObject());
      globalThis.generated = generateCoopGame(${count}, {seed:${seed}});`);
    if (process.argv.includes('--corrupt')) expectedCoop.initialHumanCount++;
    f.compare(label+'-generation-metadata', f.evaluate('generated.coop'), expectedCoop);
    // Version-4 Divided Valley places resources exactly and terrain around
    // density targets. Assert its public contract independently, then track
    // these validated placements across start/load.
    const expected = f.evaluate('JSON.parse(JSON.stringify(generated))');
    const side = sideFor(count), area = side*side;
    f.compare(label+'-dimensions-counts-assets', {
      dimensions:expected.mapSize,
      counts:[expected.players[0].towns.length,expected.goldmines.length,expected.portals.length],
      terrain:[terrainWithin(expected.mountains.length,area,8),terrainWithin(expected.lakes.length,area,6),
        terrainWithin(expected.bushes.length,area,10),expected.hills.length],
      assets:expected.players.slice(1,count+1).map(p=>[p.gold,p.towns.length,p.units.length]),
      controller:expected.players[count+1]
    }, {dimensions:{x:side,y:side},counts:[2*count,2*count,2*count],terrain:[true,true,true,0],
      assets:Array.from({length:count},()=>[100,1,0]),
      controller:{rgb:{r:160,g:40,b:180},units:[],towns:[],gold:0,economyEnabled:false}});
    f.compare(label+'-independent-starting-roster',expected.players.map(p=>({...p,towns:p.towns.length})),[
      {rgb:{r:208,g:208,b:208},towns:2*count,units:[],gold:0},
      ...colors.slice(0,count).map(rgb=>({rgb,gold:100,units:[],towns:1})),
      {rgb:{r:160,g:40,b:180},units:[],towns:0,gold:0,economyEnabled:false}]);
    const objects = [...expected.players.flatMap(p=>p.towns),...expected.goldmines,
      ...expected.portals,...expected.mountains,...expected.lakes,...expected.bushes];
    f.compare(label+'-placements-valid', {
      unique:new Set(objects.map(c=>`${c.x},${c.y}`)).size===objects.length,
      inBounds:objects.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<side&&c.y<side)
    }, {unique:true,inBounds:true});
    f.compare(label+'-active-game-unchanged', f.evaluate('JSON.stringify(getGameObject()) === beforeGeneration'), true);
    f.compare(label+'-repeat', f.evaluate(`JSON.stringify(generated) === JSON.stringify(generateCoopGame(${count}, {seed:${seed}}))`), true);
    f.compare(label+'-replay', f.evaluate('JSON.stringify(generated) === JSON.stringify(generateCoopGame(generated.coop.generation.playerCount, generated.coop.generation.options))'), true);
    // Start the production map and inspect it against declared, pre-start data.
    f.context.fixtureConfig = {actors: [ {role:'neutral'},
      ...Array.from({length:count},()=>({role:'human'})), {role:'demon'} ]};
    f.evaluate(`generated.start({clearValues() {
      external=[]; externalProduction=[]; nature=[]; goldmines=[];
      gameRound=0; gameExit=false;
    }, updateCameraBorders() {}}, false); whooseTurn=1; actionManager.clear();`);
    const initial = initialEntities(expected);
    const entities = createEntityLedger(f, initial);
    const economy = createEconomyLedger(f,[{role:'neutral',gold:0},
      ...Array.from({length:count},()=>({role:'human',gold:100})),{role:'demon',gold:0}],
      {income:{town:4},salary:{noob:1},purchase:{},production:{}});
    const turn = createTurnLedger(Array.from({length:count},(_,i)=>i+1));
    function check(suffix) {
      entities.check(label+suffix+'-entities');
      economy.check(label+suffix+'-economy');
      turn.check(label+suffix+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
        events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
      f.compare(label+suffix+'-metadata',f.evaluate('gameSettings.coop'),{...expectedCoop,balanceVersion:2});
      f.compare(label+suffix+'-roles',f.evaluate('players.map(p=>p.role)'),
        ['NEUTRAL',...Array(count).fill('HUMAN'),'DEMONS']);
    }
    check('-started');
    f.evaluate('loadFromJson(JSON.stringify(getGameObject()));');
    // Deserialization creates new object identities; rebind the same declared IDs.
    for (const row of initial) entities.bind(row.id,
      `grid.${row.kind==='unit'?'getUnit':'getBuilding'}({x:${row.x},y:${row.y}})`);
    // Replace stale references from the prior deserialization in the harness.
    f.evaluate('for (const [e] of ledgerObjects) if ((e.isUnit ? grid.getUnit(e.coord) : grid.getBuilding(e.coord)) !== e) ledgerObjects.delete(e);');
    check('-restored');
  }
  f.compare('default-seed', f.evaluate('JSON.stringify(generateCoopGame(2)) === JSON.stringify(generateCoopGame(2,{seed:1,size:"normal"}))'),true);
  f.compare('different-seeds-vary-layout',f.evaluate('JSON.stringify(generateCoopGame(4,{seed:1}).players) !== JSON.stringify(generateCoopGame(4,{seed:42}).players)'),true);
  for (const input of ['undefined','null','0','13','-1','2.5','"2"','NaN','Infinity']) {
    f.compare('reject-count-'+input,f.evaluate(`(() => {
      const before=JSON.stringify(getGameObject()); let message='';
      try { generateCoopGame(${input}); } catch(e) {message=e.message;}
      return {message, unchanged:before===JSON.stringify(getGameObject())};
    })()`),{message:'Co-op playerCount must be an integer from 1 to 12 humans',unchanged:true});
  }
  for (const options of ['null','[]','{unknown:true}','{seed:-1}','{seed:4294967296}',
    '{seed:1.5}','{seed:"42"}','{seed:NaN}','{seed:Infinity}']) {
    f.compare('reject-options-'+options,f.evaluate(`(() => {
      const before=JSON.stringify(getGameObject()); let rejected=false;
      try {generateCoopGame(2,${options});} catch(e) {rejected=/Co-op (seed|options)/.test(e.message);}
      return {rejected,unchanged:before===JSON.stringify(getGameObject())};
    })()`),{rejected:true,unchanged:true});
  }
  f.compare('input-output-detached',f.evaluate(`(() => {
    const options={seed:42}; const a=generateCoopGame(2,options);
    options.seed=9; a.coop.generation.options.seed=7;
    return [a.coop.generation.seed,options.seed,generateCoopGame(2,{seed:42}).coop.generation.options.seed];
  })()`),[42,9,42]);
  console.log('INAPPLICABLE: no combat actions or completed rounds; no income/expense events; no online committed revisions in generation/start/save-load fixtures. Shared initial entity, economy and turn ledgers checked after every start and restore. Connectivity belongs to a subsequent task.');
  const probe=spawnSync(process.execPath,[__filename,'--corrupt'],{encoding:'utf8'});
  console.log('BEGIN deliberate corruption probe');
  process.stdout.write(probe.stdout); process.stderr.write(probe.stderr);
  console.log('END deliberate corruption probe actual_exit_status='+probe.status);
  assert.equal(probe.status,1); assert.match(probe.stderr,/humans-2-seed-0-generation-metadata/);
  console.log('PASS corruption-probe expected_exit=1 observed_exit='+probe.status+' marker=humans-2-seed-0-generation-metadata');
  console.log('PASS co-op generation API scenarios=12 counts=2,3,4 seeds=0,1,42,4294967295');
}
run();
