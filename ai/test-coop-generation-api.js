const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

const {expectedMap, initialEntities} = require('./test-coop-generation-fixtures');
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
    const expected = expectedMap(count,seed);
    f.evaluate(`globalThis.beforeGeneration = JSON.stringify(getGameObject());
      globalThis.generated = generateCoopGame(${count}, {seed:${seed}});`);
    if (process.argv.includes('--corrupt')) expected.coop.initialHumanCount++;
    f.compare(label+'-exact-generation', f.evaluate('JSON.parse(JSON.stringify(generated))'), expected);
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
      f.compare(label+suffix+'-metadata',f.evaluate('gameSettings.coop'),expected.coop);
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
  f.compare('default-seed', f.evaluate('JSON.parse(JSON.stringify(generateCoopGame(2)))'),expectedMap(2,1));
  f.compare('different-seeds-vary-layout',f.evaluate('JSON.stringify(generateCoopGame(4,{seed:1}).players) !== JSON.stringify(generateCoopGame(4,{seed:42}).players)'),true);
  for (const input of ['undefined','null','0','1','5','-1','2.5','"2"','NaN','Infinity']) {
    f.compare('reject-count-'+input,f.evaluate(`(() => {
      const before=JSON.stringify(getGameObject()); let message='';
      try { generateCoopGame(${input}); } catch(e) {message=e.message;}
      return {message, unchanged:before===JSON.stringify(getGameObject())};
    })()`),{message:'Co-op playerCount must be an integer from 2 to 4 humans',unchanged:true});
  }
  for (const options of ['null','[]','{size:"tiny"}','{seed:-1}','{seed:4294967296}',
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
  assert.equal(probe.status,1); assert.match(probe.stderr,/humans-2-seed-0-exact-generation/);
  console.log('PASS corruption-probe expected_exit=1 observed_exit='+probe.status+' marker=humans-2-seed-0-exact-generation');
  console.log('PASS co-op generation API scenarios=12 counts=2,3,4 seeds=0,1,42,4294967295');
}
run();
