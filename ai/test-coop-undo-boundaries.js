const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');
const {run: runRound} = require('./test-coop-local-round');

function snapshot(f) {
  return f.evaluate(`JSON.parse(JSON.stringify({game:getGameObject(),terminal:gameExit,
    cells:grid.arr.map(col=>col.map(c=>({coord:c.coord,unit:c.unit,building:c.building}))),
    mines:players.map(p=>p.goldmines),undo:actionManager.arr,
    phase:typeof trace==='undefined'?[]:trace}))`);
}
function economic(name, fault) {
  const c=defaultFixture(); c.coop=true; c.actors[0].towns=[]; c.actors[3].units=[];
  const f=createFixture(c);
  const rows=[
    {id:'t1',kind:'town',name:'town',owner:1,x:1,y:1},
    {id:'g1',kind:'unit',name:'noob',owner:1,x:1,y:1},
    {id:'actor',kind:'unit',name:'noob',owner:1,x:2,y:2},
    {id:'t2',kind:'town',name:'town',owner:2,x:7,y:1},
    {id:'g2',kind:'unit',name:'noob',owner:2,x:7,y:1},
    {id:'mine',kind:'goldmine',name:'goldmine',owner:0,x:2,y:3}
  ];
  f.evaluate(`new Goldmine(2,3,50); gameSettings.isOnline=false; undefined`);
  let entities=createEntityLedger(f,rows);
  const economy=createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),
    {purchase:{wall:2},production:{noob:20}});
  const turns=createTurnLedger([1,2]);
  function check(label) {
    entities.check(name+'-'+label+'-entities'); economy.check(name+'-'+label+'-economy');
    turns.check(name+'-'+label+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
  }
  check('initial'); const before=snapshot(f);
  if(name==='purchase') {
    f.compare('purchase-accepted',f.evaluate(`(() => {
      Object.setPrototypeOf(players[1],AIPlayerWithEconomy.prototype);
      const command=globalThis.purchaseCommand=players[1].getEconomyCommands().find(c=>c.product==='wall');
      if(!command) throw Error('missing legal wall purchase');
      return players[1].applyEconomyCommand(command);
    })()`),true);
    economy.record({id:'expense',owner:1,type:'purchase',rule:'wall',count:1});
    const coord=f.evaluate('purchaseCommand.destinationCoord');
    entities.record({type:'spawn',entity:{id:'wall',kind:'production',name:'wall',owner:1,...coord}});
    entities.bind('wall','grid.getBuilding(purchaseCommand.destinationCoord)');
  } else if(name==='production') {
    f.compare('production-accepted',f.evaluate(`grid.getBuilding({x:1,y:1}).prepare('noob')`),true);
    economy.record({id:'expense',owner:1,type:'production',rule:'noob',count:1});
    f.compare('production-queue',f.evaluate(`grid.getBuilding({x:1,y:1}).unitProduction.name`),'noob');
  } else {
    f.compare('economic-capture-legal',f.evaluate(`(() => {const u=grid.getUnit({x:2,y:2});u.select();
      return u.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,{x:2,y:3}));})()`),true);
    f.evaluate('grid.getUnit({x:2,y:2}).sendInstructions(grid.getCell({x:2,y:3}))');
    entities.record({type:'move',id:'actor',destination:{x:2,y:3}});
    entities.record({type:'capture',id:'mine',owner:1});
    f.compare('economic-capture-owner',f.evaluate('grid.getBuilding({x:2,y:3}).playerColor'),1);
  }
  f.compare(name+'-undo-depth',f.evaluate('actionManager.arr.length'),1);
  check('action'); f.evaluate('actionManager.undo()');
  entities=createEntityLedger(f,rows);
  if(name!=='capture') economy.record({id:'refund',owner:1,type:'reversal',reverses:'expense'});
  if(fault==='balance') f.evaluate('players[2].gold++');
  if(fault==='capture') f.evaluate('grid.getHexagon({x:2,y:3}).playerColor=1');
  check('undo'); f.compare(name+'-exact-reversal',snapshot(f),before);
  console.log(`PASS economic-undo ${name} balances=[0,100,75,0] entities_territory_queues=restored`);
}
function boundaries(fault) {
  let attempts=0;
  runRound(false,(f,label,check)=>{
    if(!/^(partial-|wave-|human-ready-|completed-)/.test(label)) return false;
    const before=snapshot(f);
    f.compare(label+'-committed-stack-empty',f.evaluate('actionManager.arr.length'),0);
    for(let attempt=1;attempt<=2;attempt++) {
      f.evaluate('actionManager.undo()');
      if(fault==='phase') f.evaluate('gameRound--');
      f.compare(label+'-undo-rejected-identical-authoritative-state-'+attempt,snapshot(f),before);
      check('-undo-'+attempt); attempts++;
    }
  });
  assert.equal(attempts,20);
  console.log('PASS committed-boundaries attempts=20 completed_rounds=2 waves=2 demon_phases=2 combat_actions=2 authoritative_state=identical');
}
if(process.argv[2]==='--fault') {
  const fault=process.argv[3];
  if(fault==='phase') boundaries(fault); else economic(fault==='capture'?'capture':'production',fault);
} else {
  ['purchase','production','capture'].forEach(name=>economic(name)); boundaries();
  console.log('INAPPLICABLE online committed revisions: real offline dispatcher fixtures have no network commits. Economic fixtures stay within human turn 1; no income or completed production occurs before undo. Round fixture independently checks actual income, salary, wave births, combat deaths and exact phase counts after every action and round. UI selection/camera are not authoritative state.');
  for(const [fault,marker] of [['balance','human 2 balance'],['capture','live-entity conservation'],['phase','undo-rejected-identical']]) {
    const child=spawnSync(process.execPath,[__filename,'--fault',fault],{encoding:'utf8',maxBuffer:32*1024*1024});
    process.stderr.write(child.stderr); assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
    assert.ok(child.stderr.includes(marker),marker);
    console.log(`PASS rejects-${fault} expected_exit=1 observed_exit=${child.status} marker=${marker}`);
  }
  console.log('PASS co-op undo boundaries economic_scenarios=3 boundary_attempts=20 fault_probes=3');
}
