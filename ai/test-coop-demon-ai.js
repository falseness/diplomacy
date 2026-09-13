const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function setup(demon, humans, portal) {
  const config = defaultFixture(); config.coop = true;
  config.actors[1].units = humans[0] || [];
  config.actors[2].units = humans[1] || [];
  config.actors[3].units = [demon, {x:4,y:2,hp:2}];
  const f = createFixture(config);
  const initial = [
    {id:'neutral-town',kind:'town',owner:0,x:4,y:5,name:'town'},
    {id:'town1',kind:'town',owner:1,x:1,y:1,name:'town'},
    {id:'town2',kind:'town',owner:2,x:7,y:1,name:'town'},
    {id:'garrison1',kind:'unit',owner:1,x:1,y:1,name:'noob'},
    {id:'garrison2',kind:'unit',owner:2,x:7,y:1,name:'noob'},
    {id:'demon',kind:'unit',owner:3,x:demon.x,y:demon.y,name:'noob'},
    {id:'friendly-demon',kind:'unit',owner:3,x:4,y:2,name:'noob'}
  ];
  humans.forEach((units,i)=>units.forEach((u,j)=>initial.push({id:`human${i+1}-${j}`,kind:'unit',owner:i+1,x:u.x,y:u.y,name:'noob'})));
  f.evaluate('players[3].units[1].moves=0');
  f.evaluate(`globalThis.portal = new DemonPortal(${portal.x},${portal.y}); undefined`);
  initial.push({id:'portal',kind:'portal',owner:3,...portal,name:'demonPortal'});
  const entities = createEntityLedger(f,initial);
  const economy = createEconomyLedger(f,config.actors.map(({role,gold})=>({role,gold})),{});
  const turns = createTurnLedger([1,2]);
  function check(label) {
    entities.check(label+'-entities'); economy.check(label+'-economy');
    turns.check(label+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
  }
  return {f,entities,check};
}
function run(fault) {
  for (const owner of [1,2]) {
    const humans=[[],[]]; humans[owner-1]=[{x:5,y:3,hp:2}];
    const {f,check}=setup({x:4,y:3,hp:2},humans,{x:3,y:3});
    check('initial-'+owner);
    // Observe every actual submission, validate it against fresh production
    // commands, and compare its outcome against a literal fixture expectation.
    f.context.afterAction = () => {
      f.compare('human-'+owner+'-damaged',f.evaluate('grid.getUnit({x:5,y:3}).hp'),1);
      check('after-ai-action-'+owner);
    };
    f.evaluate(`globalThis.trace=[];
      for(const p of players) for(const t of p.towns) {
        const prepare=t.prepare; t.prepare=function(...args) {trace.push({type:'purchase',args}); return prepare.apply(this,args)};
      }
      const u=players[3].units[0], original=u.sendInstructions;
      u.sendInstructions=function(cell) {
        const legal=this.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,cell.coord));
        if(!legal) throw new Error('illegal AI command');
        if(!this.canHitSomethingOnCell(cell) || cell.unit.playerColor!==${owner}) throw new Error('wrong enemy');
        trace.push({type:'combat',destination:{...cell.coord},legal});
        original.call(this,cell);
        whooseTurn=1; afterAction(); whooseTurn=3;
      };
      whooseTurn=3; players[3].play(); whooseTurn=1; undefined`);
    if(fault) f.evaluate("trace.push({type:'purchase'})");
    f.compare('legal-combat-only-human-'+owner,f.evaluate('trace'),[{type:'combat',destination:{x:5,y:3},legal:true}]);
    f.compare('actual-SimpleAiPlayer-'+owner,f.evaluate('players[3].combatAI instanceof SimpleAiPlayer'),true);
    f.compare('own-portal-and-demon-unharmed-'+owner,f.evaluate('({portal:portal.hp,demon:players[3].units[0].hp,friend:players[3].units[1].hp})'),{portal:30,demon:2,friend:2});
    f.compare('economic-opportunities-present-'+owner,f.evaluate('({towns:players[0].towns.length+players[1].towns.length+players[2].towns.length,humanGold:players[1].gold})'),{towns:3,humanGold:100});
    f.compare('allied-human-units-excluded-'+owner,f.evaluate(`new BestEnemyTargetForAI().calculateBestEnemyTarget(
      {x:7,y:1},grid.arr.map(column=>column.map(cell=>({...cell,building:new Empty()}))),1)`),{x:4,y:2});
    check('completed-play-'+owner);
  }
  const {f,entities,check}=setup({x:7,y:5,hp:2},[[],[]],{x:3,y:2});
  check('movement-initial');
  f.compare('human-targets-portal-over-allied-town',f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget({x:2,y:2},grid.arr,1)'),{x:3,y:2});
  f.compare('demon-targets-neutral-economic-building',f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget({x:7,y:5},grid.arr,3)'),{x:4,y:5});
  // A one-action budget isolates a deterministic legal step towards that target.
  f.context.afterMove=()=>{
    entities.record({type:'move',id:'demon',destination:{x:6,y:6}});
    check('after-ai-movement');
  };
  f.evaluate(`globalThis.trace=[]; gameSettings.aiActionLimit=1;
    const u=players[3].units[0], original=u.sendInstructions;
    u.sendInstructions=function(cell) {
      const legal=this.getAvailableMoveCommands().some(c=>coordsEqually(c.destinationCoord,cell.coord));
      if(!legal) throw new Error('illegal AI movement');
      trace.push({type:'move',destination:{...cell.coord},legal});
      original.call(this,cell); whooseTurn=1; afterMove(); whooseTurn=3;
    };
    whooseTurn=3; players[3].play(); whooseTurn=1; undefined`);
  f.compare('legal-movement-only',f.evaluate('trace'),[{type:'move',destination:{x:6,y:6},legal:true}]);
  check('movement-completed');
  console.log('INAPPLICABLE completed rounds/phase counts: isolated combat play does not advance dispatcher; shared turn ledger checks human 1 at round 0 after every action.');
  console.log('INAPPLICABLE online convergence: offline fixtures have no committed online revisions.');
  console.log('PASS demon-ai humans_targeted=2 legal_combat_actions=2 legal_movement_actions=1 economic_commands=0');
}
if(process.argv[2]==='--fault') run(true);
else {
  run(false);
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8'});
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  assert.equal(child.status,1);
  assert.ok(child.stderr.includes('AssertionError')&&child.stderr.includes('legal-combat-only-human-1'));
  console.log('PASS rejects-economic-trace-corruption expected_exit=1 observed_exit=1');
}
