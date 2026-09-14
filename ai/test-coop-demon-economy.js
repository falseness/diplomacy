const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function setup(extra = [], emptyDemon = false) {
  const config = defaultFixture(); config.coop = true;
  if (emptyDemon) config.actors[3].units = [];
  const f = createFixture(config);
  const initial = [
    ['neutral-town','town',0,4,5,'town'], ['human-one-town','town',1,1,1,'town'],
    ['human-two-town','town',2,7,1,'town'], ['human-one-unit','unit',1,2,2,'noob'],
    ['garrison-one','unit',1,1,1,'noob'], ['garrison-two','unit',2,7,1,'noob'],
    ...emptyDemon ? [] : [['demon','unit',3,7,5,'noob']], ...extra
  ].map(([id,kind,owner,x,y,name])=>({id,kind,owner,x,y,name}));
  const economy = createEconomyLedger(f, config.actors.map(({role,gold})=>({role,gold})),
    {income:{town:4,suburb:1},salary:{noob:1}});
  const turns = createTurnLedger([1,2]);
  let entities;
  return {f, economy, init() {entities=createEntityLedger(f,initial)}, entities:()=>entities,
    check(label) {
      entities.check(label+'-entities'); economy.check(label+'-economy');
      turns.check(label+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
        events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
    }};
}
function run(fault) {
  for (const empty of [false,true]) {
    const s=setup([],empty), {f,economy}=s; s.init();
    s.check('tick-initial');
    f.compare('real-demon-controller',f.evaluate('players[3] instanceof DemonPlayer'),true);
    for (let tick=0;tick<2;tick++) {
      for (const owner of [1,2]) {
        for (const [type,rule,count] of [['income','town',1],['income','suburb',7],['salary','noob',owner===1?2:1]])
          economy.record({id:`${tick}-${owner}-${rule}`,owner,type,rule,count});
        f.evaluate(`players[${owner}].nextTurn()`);
        s.check(`human-${owner}-tick-${tick}-empty-${empty}`);
      }
      f.evaluate('players[3].gold += 500; players[3].correctGoldminesIncome(); players[3].nextTurn()');
      f.compare('demon-no-economy-no-elimination',f.evaluate(`({gold:players[3].gold,income:players[3].income,
        salary:players[3].armySalary,mines:players[3].goldminesIncome,lost:players[3].isLost,
        towns:players[3].towns.length,units:players[3].units.length})`),
        {gold:0,income:0,salary:0,mines:0,lost:false,towns:0,units:empty?0:1});
      s.check(`demon-tick-${tick}-empty-${empty}`);
    }
    f.compare('demon-no-purchase-commands',f.evaluate('AIPlayerWithEconomy.prototype.getEconomyCommands.call(players[3])'),[]);
    f.compare('demon-purchase-rejected',f.evaluate(`AIPlayerWithEconomy.prototype.applyEconomyCommand.call(players[3],
      {product:'wall',producerCoord:{x:1,y:1},destinationCoord:{x:2,y:1}})`),false);
    s.check('purchase-rejected');
    // Borrow the production entry points with a demon owner: rejection must
    // precede undo, cost lookup, queue creation, or production advancement.
    for (const [prototype,method] of [['PreparingManufacture','prepare'],['PreparingManufacture','startUnitPreparing'],
      ['PreparingManufacture','unitPreparingLogic'],['Town','prepare'],['Town','startBuildingPreparing'],['Town','buildingPreparingLogic']]) {
      f.compare(`demon-production-rejected-${method}`,f.evaluate(`${prototype}.prototype.${method}.call({player:players[3]},'noob')`),false);
      s.check(`production-${prototype}-${method}`);
    }
  }
  // Exercise real production instances with existing queues, not only borrowed methods.
  {
    const {f}=setup();
    f.evaluate(`globalThis.producers=[grid.getBuilding({x:1,y:1}),new Barrack(3,1,grid.getBuilding({x:1,y:1}))];
      grid.getHexagon({x:3,y:1}).playerColor=1;
      for (const producer of producers) {
        producer.startUnitPreparing('noob');
        Object.defineProperty(producer,'player',{get:()=>players[3]});
      } undefined`);
    f.evaluate("players[1].updateTowns(); undefined");
    const before=f.snapshot();
    const queued=[1,1];
    const undoBefore=f.evaluate('JSON.stringify(actionManager.arr)');
    f.compare('human-production-costs',f.evaluate('players[1].gold'),60);
    for (const index of [0,1]) {
      for (const method of ['prepare','startUnitPreparing','unitPreparingLogic',
        ...index===0?['startBuildingPreparing','buildingPreparingLogic']:[]]) {
        f.evaluate(`producers[${index}].${method}('noob'); undefined`);
        f.compare(`real-producer-${index}-${method}-unchanged`,f.snapshot(),before);
        f.compare(`real-producer-${index}-${method}-undo`,
          f.evaluate("JSON.stringify(actionManager.arr)"),undoBefore);
        f.compare(`real-producer-${index}-${method}-queue`,
          f.evaluate('producers.map(p=>p.unitProduction.turns)'),queued);
      }
    }
    f.compare('real-producers-no-building-queue',f.evaluate('producers[0].buildingProduction.length'),0);
  }
  // A one-cell-wide corridor makes the economic building an unavoidable transit step.
  for (const kind of ['town','goldmine']) {
    const {f}=setup();
    f.evaluate(`for(let x=0;x<9;x++) for(let y=0;y<7;y++) {
      if(y!==3 || x<3 || x>5) grid.setBuilding(new Sea(x,y),{x,y});
    }
    grid.getHexagon({x:3,y:3}).playerColor=3;
    globalThis.walker=new Noob(3,3);
    grid.getHexagon({x:4,y:3}).playerColor=0;
    globalThis.blocker=new ${kind==='town'?'Town(4,3,true)':'Goldmine(4,3,50)'};
    ${kind==='town'?'blocker.hp=0;':''}
    whooseTurn=3; walker.select(); undefined`);
    f.compare(`${kind}-destination-cost`,f.evaluate('walker.interaction.way.getDistance({x:4,y:3})'),kind==='town'?3:2);
    f.compare(`${kind}-transit-cost`,f.evaluate('walker.interaction.way.getDistance({x:5,y:3})'),3);
    f.compare(`${kind}-no-transit-command`,f.evaluate(`walker.getAvailableCommands().some(c=>
      c.destinationCoord.x===5 && c.destinationCoord.y===3)`),false);
    f.evaluate('walker.sendInstructions(grid.getCell({x:5,y:3})); undefined');
    f.compare(`${kind}-transit-rejected`,f.evaluate('walker.coord'),{x:3,y:3});
    f.evaluate('walker.select(); walker.sendInstructions(grid.getCell({x:4,y:3})); undefined');
    f.compare(`${kind}-destination-no-capture`,f.evaluate(`({coord:walker.coord,owner:blocker.playerColor,
      gold:players[3].gold,towns:players[3].towns.length})`),
      {coord:{x:3,y:3},owner:0,gold:0,towns:0});
  }
  let count=0;
  for (const [kind,hp] of [['town',10],['town',1],['town',0],['goldmine',null]]) {
    for (const owner of [0,1]) for (const ranged of [false,true]) {
      const label=`demon-${ranged?'ranged':'melee'}-${kind}-owner${owner}-hp${hp}`;
      const s=setup([['attacker','unit',3,5,3,ranged?'archer':'noob'],
        ['target',kind==='town'?'town':'goldmine',owner,6,3,kind]]),{f}=s;
      f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=3; globalThis.attacker=new ${ranged?'Archer':'Noob'}(5,3);
        grid.getHexagon({x:6,y:3}).playerColor=${owner}; globalThis.target=new ${kind==='town'?'Town(6,3,true)':'Goldmine(6,3,50)'};
        ${hp===null?'':`target.hp=${hp};`} undefined`);
      s.init(); s.check(label+'-initial');
      console.log(JSON.stringify({scenario:label,submitted:'attacker.select(); attacker.sendInstructions(target cell)'}));
      f.evaluate('whooseTurn=3; attacker.select(); attacker.sendInstructions(grid.getCell({x:6,y:3})); whooseTurn=1; undefined');
      if(fault) f.evaluate('players[1].gold++');
      const razed = kind==='town' && owner===1 && !ranged && hp<=1;
      if (razed) {
        s.entities().record({type:'death',id:'target'});
        s.entities().record({type:'move',id:'attacker',destination:{x:6,y:3}});
      }
      f.compare(label+'-ownership-and-combat',f.evaluate(`({owner:target.playerColor,hp:${hp===null?'null':'target.hp'},
        attacker:attacker.coord,gold:players.map(p=>p.gold),demonTowns:players[3].towns.length})`),
        {owner:razed?3:owner,hp:hp===null?null:owner===0?hp:Math.max(0,hp-(ranged?2:1)),attacker:{x:razed?6:5,y:3},gold:[0,100,75,0],demonTowns:0});
      f.compare(label+'-path-no-economic-transit',f.evaluate('attacker.interaction.way.getDistance({x:6,y:3})'),ranged||kind==='town'&&owner===0?3:2);
      s.check(label+'-after-command'); count++;
    }
  }
  const s=setup([['attacker','unit',1,3,5,'noob']]),{f}=s;
  f.evaluate('grid.getHexagon({x:3,y:5}).playerColor=1; globalThis.attacker=new Noob(3,5); grid.getBuilding({x:4,y:5}).hp=0; undefined');
  s.init(); s.check('neutral-capture-initial');
  f.evaluate('attacker.select(); attacker.sendInstructions(grid.getCell({x:4,y:5})); undefined');
  s.entities().record({type:'capture',id:'neutral-town',owner:1});
  s.entities().record({type:'move',id:'attacker',destination:{x:4,y:5}});
  f.compare('human-neutral-town-capture',f.evaluate('grid.getBuilding({x:4,y:5}).playerColor'),1);
  s.check('human-neutral-town-capture');
  console.log('INAPPLICABLE completed rounds/phase counts: isolated player economy hooks and commands keep dispatcher at human 1, round 0; shared turn ledger checked after each action.');
  console.log('INAPPLICABLE online convergence: offline fixtures have no committed online revisions.');
  console.log(`PASS demon-economy combat_scenarios=${count} tick_fixtures=2 neutral_human_captures=1`);
}
if(process.argv[2]==='--fault') run(true);
else {
  run(false);
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8'});
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.ok(child.stderr.includes('AssertionError')&&child.stderr.includes('ownership-and-combat'));
  console.log('PASS rejects-combat-credit-corruption expected_exit=1 observed_exit=1');
}
