const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {assertDemonTileOwnership} = require('./test-coop-demon-ownership-assertions');
const outputIndex = process.argv.indexOf('--output-dir');
const output = outputIndex < 0 ? null : process.argv[outputIndex + 1];
if (output) fs.mkdirSync(output, {recursive:true});
const scenarios = [
  {name:'damaged', hp:1, defender:null, survivor:true, razed:true},
  {name:'zero', hp:0, defender:null, survivor:true, razed:true},
  {name:'surviving-defender', hp:0, defender:2, survivor:true, razed:false},
  {name:'defeated-defender', hp:0, defender:1, survivor:true, razed:true},
  {name:'last-human-asset', hp:0, defender:1, survivor:false, razed:true}
];
function run(c, fault=false) {
  const config=defaultFixture(); config.coop=true;
  config.actors.forEach(a=>{a.towns=[];a.units=[];});
  const f=createFixture(config);
  f.evaluate(`grid.getHexagon({x:5,y:3}).firstpaint(3); new Noob(5,3);
    grid.getHexagon({x:6,y:3}).firstpaint(1);
    globalThis.target=new Town(6,3,true); target.hp=${c.hp};
    for(const coord of [{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}]) {
      const h=grid.getHexagon(coord);h.firstpaint(1);h.isSuburb=true;target.suburbs.push(h);
    }
    globalThis.farm=new Farm(6,4,target); target.buildings.push(farm);
    globalThis.barrack=new Barrack(7,3,target); target.buildings.push(barrack);
    target.unitProduction=new UnitProduction(1,20,Noob,'noob');
    barrack.unitProduction=new UnitProduction(2,40,Archer,'archer');
    globalThis.queue=new ManufactureProduction(2,32,Farm,'farm');
    queue.sendInstructions({x:7,y:4},target);target.buildingProduction.push(queue);grid.setBuilding(queue,queue.coord);
    ${c.defender===null?'':`new Noob(6,3).hp=${c.defender};`}
    ${c.survivor?'grid.getHexagon({x:6,y:4}).firstpaint(1);new Noob(6,4);':''}
    new Goldmine(1,5,50); new DemonPortal(8,5);
    gameSettings.isOnline=false;actionManager.clear(); undefined`);
  const expectedRows = [
    ['unit','noob',3,5,3], ['building','town',1,6,3],
    ['building','farm',1,6,4], ['building','barrack',1,7,3],
    ['building','farm',1,7,4], ['building','goldmine',0,1,5],
    ['building','demonPortal',3,8,5],
    ...(c.defender===null?[]:[['unit','noob',1,6,3]]),
    ...(c.survivor?[['unit','noob',1,6,4]]:[])
  ];
  const sort = rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  function check(label, after, subject=f) {
    assertDemonTileOwnership(subject,c.name+'-'+label);
    const wanted=expectedRows.filter(r=>!after || !c.razed ||
      !(r[0]==='building' && r[2]===1 || r[0]==='unit' && r[2]===1 && r[3]===6 && r[4]===3))
      .map(r=>after && c.razed && r[0]==='unit' && r[2]===3 ? [...r.slice(0,3),6,3] : [...r]);
    const rows=subject.evaluate(`grid.arr.flatMap(col=>col.flatMap(cell=>['unit','building'].flatMap(kind=>{
      const e=cell[kind];return e.isEmpty()?[]:[[kind,e.name,e.playerColor,e.coord.x,e.coord.y]];
    })))`);
    subject.compare(c.name+'-'+label+'-entity-ledger',sort(rows),sort(wanted));
    subject.compare(c.name+'-'+label+'-reference-ledger',subject.evaluate(`(() => {
      const problems=[]; const refs=[];
      for(const p of players) {
        for(const e of [...p.units,...p.towns].filter(e=>!e.killed)) {
          refs.push(e); if(e.player!==p || (e.isUnit?grid.getUnit(e.coord):grid.getBuilding(e.coord))!==e) problems.push('owner/map');
        }
        for(const t of p.towns.filter(t=>!t.killed)) {
          for(const b of [...t.buildings,...t.buildingProduction]) {
            refs.push(b);if(b.killed || grid.getBuilding(b.coord)!==b || b.town!==t) problems.push('dependent restoration');
          }
          for(const h of t.suburbs) if(grid.getHexagon(h.coord)!==h) problems.push('suburb reference');
        }
      }
      if(new Set(refs).size!==refs.length) problems.push('duplicate');
      return problems;
    })()`),[]);
    subject.compare(c.name+'-'+label+'-economic-ledger',subject.evaluate(`({gold:players.map(p=>p.gold),
      demonTowns:players[3].towns.length,demonIncome:players[3].income,demonSalary:players[3].armySalary,
      demonMines:players[3].goldminesIncome})`),
      {gold:[0,68,75,0],demonTowns:0,demonIncome:0,demonSalary:0,demonMines:0});
    if(!(after&&c.razed)) subject.compare(c.name+'-'+label+'-queues',subject.evaluate(`({town:grid.getBuilding({x:6,y:3}).unitProduction.toJSON(),barrack:grid.getBuilding({x:7,y:3}).unitProduction.toJSON(),construction:grid.getBuilding({x:7,y:4}).turns})`),{town:{turns:1,cost:20,name:'noob'},barrack:{turns:2,cost:40,name:'archer'},construction:2});
    subject.compare(c.name+'-'+label+'-suburbs',subject.evaluate(`[{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}].map(c=>grid.getHexagon(c).isSuburb)`),Array(4).fill(!(after&&c.razed)));
  }
  function snapshot() {
    return f.evaluate(`JSON.parse(JSON.stringify({game:getGameObject(),
      cells:grid.arr.map(col=>col.map(c=>({coord:c.coord,unit:c.unit,building:c.building}))),
      terminal:gameExit,undoDepth:actionManager.arr.length}))`);
  }
  function save(label, value) {
    if(output&&!fault) fs.writeFileSync(path.join(output,c.name+'-'+label+'.json'),JSON.stringify(value,null,2)+'\n');
  }
  check('before',false);const before=snapshot();save('before',before);
  f.compare(c.name+'-legal-command',f.evaluate(`(() => {whooseTurn=3;const u=grid.getUnit({x:5,y:3});u.select();
    return u.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,{x:6,y:3}));})()`),true);
  f.evaluate('grid.getUnit({x:5,y:3}).sendInstructions(grid.getCell({x:6,y:3}));whooseTurn=1;undefined');
  check('after',true);
  f.compare(c.name+'-combat',f.evaluate(`({moves:players[3].units[0].moves,hp:players[3].units[0].hp,
    townHP:grid.getBuilding({x:6,y:3}).isEmpty()?null:grid.getBuilding({x:6,y:3}).hp,
    defenderHP:grid.getUnit({x:6,y:3}).playerColor===1?grid.getUnit({x:6,y:3}).hp:null})`),
    {moves:0,hp:2,townHP:c.razed?null:0,defenderHP:c.razed||c.defender===null?null:1});
  // Result getters run only after the entire combat/move/destruction action.
  f.compare(c.name+'-stable-result',f.evaluate('({lost:players[1].isLost,result:players[0].coopResult,terminal:gameExit})'),
    {lost:!c.survivor&&c.razed,result:!c.survivor&&c.razed?'defeat':null,terminal:false});
  const after=snapshot();save('after',after);
  for(const coord of [{x:1,y:5},{x:8,y:5}]) f.compare(c.name+'-unrelated-'+coord.x,after.cells[coord.x][coord.y],before.cells[coord.x][coord.y]);
  if(c.survivor) f.compare(c.name+'-unrelated-human-unit',after.cells[6][4].unit,before.cells[6][4].unit);
  // Separate loader fixture preserves the original permitted action's undo stack.
  function roundtrip(label,state,afterAction) {
    const loaded=createFixture(config); loaded.context.saved=JSON.stringify(state.game);
    loaded.evaluate('loadFromJson(saved);undefined');
    check(label,afterAction,loaded);
    f.compare(c.name+'-'+label+'-exact-save',loaded.evaluate('JSON.parse(JSON.stringify(getGameObject()))'),state.game);
    f.compare(c.name+'-'+label+'-result',loaded.evaluate('players[0].coopResult'),afterAction&&!c.survivor&&c.razed?'defeat':null);
    save(label,loaded.evaluate('JSON.parse(JSON.stringify(getGameObject()))'));
  }
  roundtrip('after-load',after,true);
  f.evaluate('actionManager.undo();undefined');
  if(fault) f.evaluate('grid.getBuilding({x:6,y:4}).destroy();undefined');
  check('undo',false);
  const undo=snapshot();save('undo',undo);
  f.compare(c.name+'-exact-undo',undo,before);
  roundtrip('undo-load',undo,false);
  console.log(`PASS raze-undo ${c.name} cleanup=exact undo=exact save_load=exact ledger=balanced references=consistent`);
}
if(process.argv.includes('--fault')) run(scenarios[0],true);
else {
  scenarios.forEach(c=>run(c));
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  process.stdout.write(child.stdout);process.stderr.write(child.stderr);
  assert.equal(child.status,1);assert.match(child.stderr,/damaged-undo-entity-ledger/);
  console.log(`PASS missing-dependent-restoration expected_exit=1 observed_exit=${child.status} marker=damaged-undo-entity-ledger`);
  console.log('PASS demon-town-raze-undo scenarios=5 snapshots=25 last_town_surviving_units=covered last_human_asset=defeat');
}
