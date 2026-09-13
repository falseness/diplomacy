const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

const cases = [
  {name:'melee-demon', actor:'Normchel', key:'normchel', hp:5, target:'Imp', kind:'unit', targetKey:'imp', distance:1, damage:1},
  {name:'ranged-demon', actor:'Archer', key:'archer', hp:1, target:'Brute', kind:'unit', targetKey:'brute', distance:2, damage:2},
  {name:'melee-portal', actor:'Normchel', key:'normchel', hp:5, target:'DemonPortal', kind:'portal', targetKey:'demonPortal', distance:1, damage:1},
  {name:'ranged-portal', actor:'Archer', key:'archer', hp:1, target:'DemonPortal', kind:'portal', targetKey:'demonPortal', distance:2, damage:2}
];
function run(c, fault) {
  const config=defaultFixture(); config.coop=true; config.size={x:13,y:11};
  config.actors.forEach(a=>{a.units=[];a.towns=[];});
  const f=createFixture(config), y=3+c.distance, getter=c.kind==='unit'?'getUnit':'getBuilding';
  const rows=[
    {id:'actor',kind:'unit',name:c.key,owner:1,x:5,y:3},
    {id:'victim',kind:c.kind,name:c.targetKey,owner:3,x:5,y},
    {id:'human-sentinel',kind:'unit',name:'noob',owner:2,x:11,y:9},
    {id:'demon-sentinel',kind:'unit',name:'hound',owner:3,x:9,y:8},
    {id:'portal-sentinel',kind:'portal',name:'demonPortal',owner:3,x:9,y:2}
  ];
  // Injured targets and a previously dead unrelated demon are fixture state.
  // Create target before the sentinel to test external-list order restoration.
  f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=1; new ${c.actor}(5,3);
    grid.getHexagon({x:5,y:${y}}).playerColor=1; new ${c.target}(5,${y});
    grid.${getter}({x:5,y:${y}}).hp=${c.damage};
    grid.${getter}({x:5,y:${y}}).wasHitted=true;
    grid.getHexagon({x:11,y:9}).playerColor=2; new Noob(11,9);
    new Hound(9,8); new DemonPortal(9,2);
    globalThis.unrelatedDead=new Imp(1,8); unrelatedDead.id='already-dead'; unrelatedDead.kill();
    gameSettings.isOnline=false; undefined`);
  f.context.rows=rows;
  f.evaluate(`for(const r of rows) (r.kind==='unit'?grid.getUnit(r):grid.getBuilding(r)).id=r.id; undefined`);
  let entities=createEntityLedger(f,rows);
  const economy=createEconomyLedger(f,config.actors.map(({role,gold})=>({role,gold})),{});
  const turns=createTurnLedger([1,2]);
  function check(label) {
    entities.check(c.name+'-'+label+'-entities');
    economy.check(c.name+'-'+label+'-economy');
    turns.check(c.name+'-'+label+'-turn',f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`),0);
    f.compare(c.name+'-'+label+'-unrelated-dead',f.evaluate(`({killed:unrelatedDead.killed,
      empty:grid.getUnit({x:1,y:8}).isEmpty(),listed:players.some(p=>p.units.includes(unrelatedDead))})`),
      {killed:true,empty:true,listed:false});
  }
  function snapshot() {
    return f.evaluate(`(() => {
      const availability=players.flatMap(p=>p.units.filter(u=>!u.killed).map(u=>{
        const cursor=whooseTurn; whooseTurn=u.playerColor;
        const result={id:u.id,owner:u.playerColor,coord:u.coord,hp:u.hp,wasHitted:u.wasHitted,
          moves:u.moves,needsInstructions:u.needInstructions(),commands:u.getAvailableCommands(),
          moveCommands:u.getAvailableMoveCommands()}; whooseTurn=cursor; return result;
      }));
      return JSON.parse(JSON.stringify({game:getGameObject(),terminal:gameExit,
        cells:grid.arr.map(col=>col.map(cell=>({coord:cell.coord,unit:cell.unit,building:cell.building}))),
        portals:external.map(e=>({id:e.id,owner:e.playerColor,name:e.name,coord:e.coord,hp:e.hp,wasHitted:e.wasHitted})),
        availability,undoDepth:actionManager.arr.length}));
    })()`);
  }
  check('initial');
  f.compare(c.name+'-literal-initial',f.evaluate(`({actorHP:grid.getUnit({x:5,y:3}).hp,
    targetHP:grid.${getter}({x:5,y:${y}}).hp,targetType:grid.${getter}({x:5,y:${y}}).constructor.name})`),
    {actorHP:c.hp,targetHP:c.damage,targetType:c.target});
  const before=snapshot();
  for(let cycle=1;cycle<=2;cycle++) {
    f.compare(c.name+'-legal-'+cycle,f.evaluate(`(() => {const u=grid.getUnit({x:5,y:3}); u.select();
      return u.getAvailableCommands().some(a=>coordsEqually(a.destinationCoord,{x:5,y:${y}}));})()`),true);
    f.evaluate(`globalThis.killedTarget=grid.${getter}({x:5,y:${y}});
      grid.getUnit({x:5,y:3}).sendInstructions(grid.getCell({x:5,y:${y}}));`);
    entities.record({type:'death',id:'victim'});
    if(c.distance===1) entities.record({type:'move',id:'actor',destination:{x:5,y}});
    f.compare(c.name+'-lethal-'+cycle,f.evaluate(`({killed:killedTarget.killed,hp:killedTarget.hp,
      targetPresent:grid.${getter}({x:5,y:${y}})===killedTarget,
      actor:grid.getUnit({x:5,y:${c.distance===1?y:3}}).toJSON(),depth:actionManager.arr.length})`),
      {killed:true,hp:0,targetPresent:false,actor:{name:c.key,coord:{x:5,y:c.distance===1?y:3},hp:c.hp,wasHitted:false,moves:0,id:'actor'},depth:1});
    check('lethal-'+cycle);
    f.evaluate('actionManager.undo()');
    // Rebind restored object identities, but derive the full expected roster
    // from the original declarations; actual wire IDs are checked by snapshot.
    entities=createEntityLedger(f,rows);
    if(fault==='id') f.evaluate(`grid.${getter}({x:5,y:${y}}).id='wrong-id'`);
    if(fault==='health') f.evaluate(`grid.${getter}({x:5,y:${y}}).hp++`);
    if(fault==='duplicate') f.evaluate('external.push(external[0])');
    if(fault==='resurrection') f.evaluate('unrelatedDead.killed=false; grid.setUnit(unrelatedDead,unrelatedDead.coord)');
    if(fault==='gold') f.evaluate('players[2].gold++');
    check('undo-'+cycle);
    f.compare(c.name+'-exact-reversal-'+cycle,snapshot(),before);
    f.compare(c.name+'-restored-class-'+cycle,f.evaluate(`grid.${getter}({x:5,y:${y}}).constructor.name`),c.target);
  }
  f.evaluate('actionManager.undo()'); check('empty-undo');
  f.compare(c.name+'-empty-undo-noop',snapshot(),before);
  console.log(`PASS undo-kill ${c.name} lethal_actions=2 exact_reversals=2 original_ids_types_health_positions_ownership_gold=equal unrelated_dead=absent`);
}
if(process.argv[2]==='--fault') run(cases[3],process.argv[3]);
else {
  cases.forEach(c=>run(c));
  console.log('INAPPLICABLE online committed convergence: offline fixtures have no network revisions. No rounds or economic actions advance; shared ledgers verify unchanged human balances, zero demon gold/assets, round 0 and human 1 after each action and undo. Rendering/camera caches are excluded from gameplay snapshots.');
  for(const [fault,marker] of [['id','exact-reversal'],['health','exact-reversal'],['duplicate','ownership live entities'],['resurrection','map live entities'],['gold','human 2 balance']]) {
    const child=spawnSync(process.execPath,[__filename,'--fault',fault],{encoding:'utf8',maxBuffer:32*1024*1024});
    // Keep fault evidence bounded while preserving the actual assertion diagnostic.
    process.stderr.write(child.stderr);
    assert.equal(child.status,1,fault); assert.match(child.stderr,/AssertionError/);
    assert.ok(child.stderr.includes(marker),fault+' marker '+marker);
    console.log(`PASS rejects-${fault} expected_exit=1 observed_exit=${child.status} marker=${marker}`);
  }
  console.log('PASS co-op undo kills scenarios=4 lethal_actions=8 exact_reversals=8 corruption_probes=5');
}
