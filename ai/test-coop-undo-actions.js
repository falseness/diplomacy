const {assertDemonTileOwnership} = require('./test-coop-demon-ownership-assertions');
const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

// Literal combat expectations, independent of runtime statistics and outcomes.
const cases = [
  {name:'human-movement', actor:'Normchel', key:'normchel', owner:1, hp:5, speed:2, move:true},
  {name:'demon-movement', actor:'Hound', key:'hound', owner:3, hp:4, speed:4, move:true},
  {name:'human-melee', actor:'Normchel', key:'normchel', owner:1, hp:5, speed:2, victim:'Brute', victimKey:'brute', victimOwner:3, victimHP:10, damage:1, distance:1},
  {name:'human-ranged', actor:'Archer', key:'archer', owner:1, hp:1, speed:2, victim:'Brute', victimKey:'brute', victimOwner:3, victimHP:10, damage:2, distance:2},
  {name:'demon-melee', actor:'Clawling', key:'clawling', owner:3, hp:3, speed:3, victim:'Normchel', victimKey:'normchel', victimOwner:1, victimHP:5, damage:1, distance:1},
  {name:'demon-ranged', actor:'EmberArcher', key:'emberArcher', owner:3, hp:4, speed:3, victim:'Normchel', victimKey:'normchel', victimOwner:1, victimHP:5, damage:2, distance:3}
];
function run(c, fault) {
  const config = defaultFixture(); config.coop = true; config.size = {x:13,y:11};
  config.actors.forEach(a => {a.units=[]; a.towns=[];});
  const f = createFixture(config);
  const rows = [
    {id:'actor',kind:'unit',name:c.key,owner:c.owner,x:5,y:3},
    {id:'human-sentinel',kind:'unit',name:'noob',owner:1,x:1,y:1},
    {id:'other-human',kind:'unit',name:'noob',owner:2,x:11,y:9}
  ];
  f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=${c.owner}; new ${c.actor}(5,3);
    grid.getHexagon({x:1,y:1}).playerColor=1; new Noob(1,1);
    grid.getHexagon({x:11,y:9}).playerColor=2; new Noob(11,9); undefined`);
  if (!c.move) {
    rows.push({id:'victim',kind:'unit',name:c.victimKey,owner:c.victimOwner,x:5,y:3+c.distance});
    // Revised co-op fixtures start demons on their own territory.
    f.evaluate(`grid.getHexagon({x:5,y:${3+c.distance}}).playerColor=${c.victimOwner};
      new ${c.victim}(5,${3+c.distance}); undefined`);
  }
  f.context.initialRows = rows;
  f.evaluate(`for (const row of initialRows) grid.getUnit(row).id=row.id;
    globalThis.turnEvents=[{type:'human',round:0,player:1}];
    gameSettings.isOnline=false; undefined`);
  const entities = createEntityLedger(f,rows);
  const economy = createEconomyLedger(f,config.actors.map(({role,gold})=>({role,gold})),{});
  const turns = createTurnLedger([1,2]);
  function check(label) {
    assertDemonTileOwnership(f, label);
    entities.check(c.name+'-'+label+'-entities');
    economy.check(c.name+'-'+label+'-economy');
    turns.check(c.name+'-'+label+'-turn',f.evaluate('({round:gameRound,terminal:gameExit,events:turnEvents})'),0);
    f.compare(c.name+'-'+label+'-human-cursor',f.evaluate('whooseTurn'),1);
  }
  // Include persisted state, all cells, identity/ownership/list order, combat
  // flags and recomputed command availability. Exclude rendering/camera caches.
  function snapshot() {
    return f.evaluate(`(() => {
      const availability=players.flatMap(p=>p.units.filter(u=>!u.killed).map(u=>{
        const cursor=whooseTurn; whooseTurn=u.playerColor;
        const result={id:u.id,owner:u.playerColor,coord:u.coord,hp:u.hp,wasHitted:u.wasHitted,
          moves:u.moves,needsInstructions:u.needInstructions(),
          commands:u.getAvailableCommands(),moveCommands:u.getAvailableMoveCommands()};
        whooseTurn=cursor; return result;
      }));
      return JSON.parse(JSON.stringify({game:getGameObject(),terminal:gameExit,
        cells:grid.arr.map(col=>col.map(cell=>({coord:cell.coord,unit:cell.unit,building:cell.building}))),
        availability,undoDepth:actionManager.arr.length}));
    })()`);
  }
  check('initial');
  f.compare(c.name+'-literal-actor',f.evaluate('({hp:grid.getUnit({x:5,y:3}).hp,moves:grid.getUnit({x:5,y:3}).moves})'),{hp:c.hp,moves:c.speed});
  const before = snapshot(), checkpoints = [before];
  const count = c.move ? 2 : 1;
  for (let i=1;i<=count;i++) {
    const sourceY = c.move ? 2+i : 3, destinationY = c.move ? 3+i : 3+c.distance;
    const source={x:5,y:sourceY}, destination={x:5,y:destinationY};
    f.context.command={source,destination,owner:c.owner};
    f.compare(c.name+'-legal-'+i,f.evaluate(`(() => {
      whooseTurn=command.owner; const u=grid.getUnit(command.source); u.select();
      const legal=u.getAvailableCommands().some(a=>coordsEqually(a.destinationCoord,command.destination));
      whooseTurn=1; return legal;
    })()`),true);
    console.log(JSON.stringify({scenario:c.name+'-submit-'+i,command:f.context.command}));
    f.evaluate(`whooseTurn=command.owner; grid.getUnit(command.source).sendInstructions(grid.getCell(command.destination)); whooseTurn=1;`);
    if(c.move) entities.record({type:'move',id:'actor',destination});
    f.compare(c.name+'-action-'+i,f.evaluate(`({actor:grid.getUnit({x:5,y:${c.move?destinationY:3}}).toJSON(),
      victimHP:${c.move?'null':`grid.getUnit({x:5,y:${destinationY}}).hp`},depth:actionManager.arr.length})`),
      {actor:{name:c.key,coord:{x:5,y:c.move?destinationY:3},hp:c.hp,wasHitted:false,moves:c.move?c.speed-i:0,id:'actor'},
        victimHP:c.move?null:c.victimHP-c.damage,depth:i});
    check('action-'+i); checkpoints.push(snapshot());
  }
  for(let i=count;i>=1;i--) {
    f.evaluate('actionManager.undo()');
    if(c.move) entities.record({type:'move',id:'actor',destination:{x:5,y:2+i}});
    // Undo reconstructs objects; bind only the declared identities and locations.
    // Wire IDs are asserted separately, so binding cannot conceal identity loss.
    for(const row of rows) {
      const coord=row.id==='actor' && c.move?{x:5,y:2+i}:row;
      entities.bind(row.id,`grid.getUnit(${JSON.stringify(coord)})`);
    }
    if(fault==='health') f.evaluate('grid.getUnit({x:5,y:3}).hp--');
    if(fault==='moves') f.evaluate('grid.getUnit({x:5,y:3}).moves=0');
    if(fault==='gold') f.evaluate('players[2].gold++');
    if(fault==='reference') f.evaluate('players[1].units.push(players[1].units[0])');
    check('undo-'+i);
    f.compare(c.name+'-exact-reversal-'+i,snapshot(),checkpoints[i-1]);
  }
  f.evaluate('actionManager.undo()'); check('empty-undo');
  f.compare(c.name+'-empty-undo-noop',snapshot(),before);
  console.log(`PASS undo-scenario ${c.name} actions=${count} reversals=${count} exact_state=equal`);
}
if(process.argv[2]==='--fault') run(cases[2],process.argv[3]);
else {
  cases.forEach(c=>run(c));
  console.log('INAPPLICABLE online committed convergence: offline action fixtures have no network revisions. Completed-round wave/demon counts and income/salary/purchase/production events: no rounds or economic actions; original human cursor, round and phase journal checked after every action/reversal. Isolated demon commands temporarily use their owner cursor. Existing undo reconstruction may replace object identities; map and owner references must point to the same restored objects.');
  for(const [fault,marker] of [['health','exact-reversal'],['moves','exact-reversal'],['gold','human 2 balance'],['reference','ownership live entities']]) {
    const child=spawnSync(process.execPath,[__filename,'--fault',fault],{encoding:'utf8',maxBuffer:32*1024*1024});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status,1,fault); assert.match(child.stderr,/AssertionError/);
    assert.ok(child.stderr.includes(marker),fault+' marker '+marker);
    console.log(`PASS rejects-${fault} expected_exit=1 observed_exit=${child.status} marker=${marker}`);
  }
  console.log('PASS co-op undo actions scenarios=6 actions=8 reversals=8 corruption_probes=4');
}
