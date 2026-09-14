'use strict';
// Offline real-engine sample. No runtime balance changes or fabricated terminal results.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {createFixture} = require('./test-coop-harness');
const {calibrate, project, readRules} = require('./coop-economy-projection');
const {valueUnit} = require('./coop-army-valuation');
const {select, simulate} = require('./tune-coop-progression');
const selected = require('./coop-balance-selected.json');
const arg = process.argv.indexOf('--output-dir');
const out = path.resolve(arg < 0 ? 'artifacts/TASK-109' : process.argv[arg + 1]);
fs.mkdirSync(out, {recursive:true});
const values = Object.fromEntries(Object.entries(selected.types).map(([id,t])=>[id,valueUnit(t).value]));
const rules = readRules();
const cases = [['tiny',1,0],['tiny',4,1],['normal',1,0],['normal',2,1],['big',1,0],['big',3,1]];

// Executed in the browser realm. Only UI, persistence and model-training side
// effects are stubbed. Actual human commands and unrestricted demon AI execute.
function install() {
  gameSettings.isOnline=false;
  gameSettings.aiActionLimit=0;
  gameEvent.nextTurn=()=>{};
  timer={pauseAndSaveTime(){},setNextTurnTime(){}};
  nextTurnPauseInterface={visible:false};
  globalThis.saveManager={save(){}};
  AiRuntime.trainFromHumanCommands=()=>{};
  menuBack=()=>{gameSettings.coop.result=players[0].coopResult;gameExit=true;};
  globalThis.events=[];
  globalThis.knownUnits=new Set(players.flatMap(p=>p.units));
  globalThis.births=players.filter(p=>p.role==='HUMAN').flatMap(p=>p.units.map(u=>({round:0,owner:u.playerColor,kind:u.name,value:20})));
  globalThis.orders=new Map();
  globalThis.serial=0;
  const create=UnitProduction.prototype.create;
  UnitProduction.prototype.create=function(x,y) {
    const order=orders.get(this);
    const u=create.call(this,x,y);
    knownUnits.add(u);
    if(u.player.role==='HUMAN') {
      if(!order || gameRound < order.round+order.delay) throw Error('training delay violated');
      events.push({type:'complete',round:gameRound,owner:u.playerColor,order:order.id,ordered:order.round,delay:order.delay,kind:u.name});
      births.push({round:gameRound,owner:u.playerColor,kind:u.name,value:production[u.name].cost});
    }
    return u;
  };
  for(const p of players.filter(p=>p.role==='HUMAN')) {
    const next=p.nextTurn.bind(p);
    p.nextTurn=()=>{
      const owner=players.indexOf(p),gold=p.gold,salary=p.armySalary;
      const income={town:p.towns.filter(t=>!t.killed).length*4,
        suburb:p.towns.reduce((s,t)=>s+t.suburbsCount,0),
        farm:p.towns.flatMap(t=>t.buildings).filter(b=>!b.killed&&b.name==='farm').length*4,
        mine:p.goldminesIncome};
      const gross=Object.values(income).reduce((s,v)=>s+v,0);
      if(gross-salary!==p.income) throw Error('independent income mismatch');
      next();
      // No mine capture is attempted by this policy; no mine-opening correction.
      if(p.gold!==Math.max(0,gold+gross-salary)) throw Error('gold refresh mismatch');
      events.push({type:'refresh',round:gameRound,owner,openingGold:gold,income,salary,gold:p.gold});
      for(const t of p.towns) if(!t.unitProduction.isEmpty()) {
        const q=orders.get(t.unitProduction);
        if(q && gameRound>=q.round+q.delay) events.push({type:'training-blocked',round:gameRound,owner,order:q.id,remaining:t.unitProduction.turns});
      }
    };
  }
  const send=Unit.prototype.sendInstructions;
  Unit.prototype.sendInstructions=function(cell) {
    const source={...this.coord},owner=this.playerColor,attack=this.canHitSomethingOnCell(cell);
    if(!this.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,cell.coord))) throw Error('illegal real-engine command');
    const result=send.call(this,cell);
    events.push({type:'action',round:gameRound,owner,kind:this.name,source,destination:{...cell.coord},attack});
    return result;
  };
  globalThis.defend=()=>{
    const p=players[whooseTurn];
    // Protect a radius of three hex edges around owned towns. Take available
    // attacks first, otherwise clear town output and spread toward nearby foes.
    const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs((a.y-Math.floor(a.x/2))-(b.y-Math.floor(b.x/2))),Math.abs((a.y+Math.ceil(a.x/2))-(b.y+Math.ceil(b.x/2))));
    const home=c=>Math.min(...p.towns.map(t=>distance(c,t.coord)));
    for(const u of [...p.units]) {
      if(u.killed||!u.moves)continue;
      const commands=u.getAvailableCommands();
      const attack=commands.find(c=>u.canHitSomethingOnCell(grid.getCell(c.destinationCoord)));
      let command=attack;
      if(!command) {
        const enemies=players.filter(q=>!p.isAlliedWith(q)).flatMap(q=>q.units).filter(e=>!e.killed&&home(e.coord)<=5);
        const moves=u.getAvailableMoveCommands().filter(c=>home(c.destinationCoord)<=3 && grid.getBuilding(c.destinationCoord).name!=='town');
        const score=c=>enemies.length?Math.min(...enemies.map(e=>distance(c,e.coord))):home(c);
        moves.sort((a,b)=>score(a.destinationCoord)-score(b.destinationCoord)||a.destinationCoord.x-b.destinationCoord.x||a.destinationCoord.y-b.destinationCoord.y);
        if(moves.length&&(grid.getBuilding(u.coord).name==='town'||score(moves[0].destinationCoord)<score(u.coord)))command=moves[0];
      }
      if(command)u.sendInstructions(grid.getCell(command.destinationCoord));
    }
    for(const t of [...p.towns]) {
      if(t.killed)continue;
      if(gameRound>0&&gameRound%4===0&&p.gold>=72&&t.buildings.filter(b=>!b.killed&&b.name==='farm').length+t.buildingProduction.length<5) {
        if(t.prepare('farm')) {
          const cell=t.suburbs.map(h=>grid.getCell(h.coord)).find(c=>t.activeProduction.canCreateOnCell(c,t));
          if(cell) {
            const before=p.gold;t.sendInstructions(cell);
            if(before-p.gold!==32)throw Error('farm price mismatch');
            events.push({type:'invest',round:gameRound,owner:whooseTurn,cost:32,kind:'farm',coord:{...cell.coord}});
          }
          t.removeSelect();
        }
      }
      const kind=serial%4===3?'archer':'noob';
      if(t.unitProduction.isEmpty()&&p.gold>=production[kind].cost+20&&p.income>=production[kind].class.salary) {
        const before=p.gold;
        if(t.prepare(kind)) {
          if(before-p.gold!==production[kind].cost)throw Error('recruit price mismatch');
          const order={type:'recruit',id:++serial,round:gameRound,owner:whooseTurn,kind,cost:production[kind].cost,delay:production[kind].turns};
          orders.set(t.unitProduction,order);events.push(order);
        }
      }
    }
  };
  globalThis.observe=()=>({round:gameRound,terminal:gameExit,result:gameSettings.coop.result,
    threshold:suddenDeathRound,births:[...births],
    humans:players.filter(p=>p.role==='HUMAN').map(p=>({owner:players.indexOf(p),gold:p.gold,income:p.income,salary:p.armySalary,lost:p.isLost,
      units:p.units.filter(u=>!u.killed).map(u=>({kind:u.name,hp:u.hp,coord:{...u.coord}})),
      towns:p.towns.filter(t=>!t.killed).map(t=>({coord:{...t.coord},hp:t.hp,queue:t.unitProduction.isEmpty()?null:t.unitProduction.toJSON()}))})),
    losses:[...knownUnits].filter(u=>u.killed).map(u=>({owner:u.playerColor,kind:u.name})),
    portals:external.filter(e=>e.isDemonPortal&&!e.killed).map(e=>({x:e.coord.x,y:e.coord.y,hp:e.hp,occupied:!grid.getUnit(e.coord).isEmpty()}))});
}

const results=[];
for(const [size,humans,seed] of cases) {
  const id=`${size}-H${humans}-seed${seed}`, started=Date.now();
  const f=createFixture(undefined,()=>{});
  f.evaluate(`globalThis.generated=generateCoopGame(${humans},{size:'${size}',seed:${seed}});`);
  const map=f.evaluate('JSON.parse(JSON.stringify(generated))');
  const projected=calibrate(map).map(a=>project(a,'typical',40,rules));
  const projectedD=simulate(selected,{seed,portals:map.portals},40);
  f.evaluate(`generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear();(${install.toString()})();`);
  assert.equal(f.evaluate('gameSettings.coop.balanceVersion'),2);
  let cumulative=0,count=0;
  const waves=[];
  f.context.checkWave=(round,portals,result)=>{
    portals=JSON.parse(JSON.stringify(portals));result=JSON.parse(JSON.stringify(result));
    const expected=portals.filter(p=>!p.occupied).sort((a,b)=>a.x-b.x||a.y-b.y).flatMap(p=>{const type=select(selected,0,round,p);return type?[{type,x:p.x,y:p.y}]:[];});
    assert.deepEqual(JSON.parse(JSON.stringify(result.spawned)),expected,'actual spawns vs independent fixed-config selection');
    const blocked=round>=3?portals.filter(p=>p.occupied).length:0;
    assert.equal(result.skipped,0,'occupied portals are filtered before placement');
    result.spawned.forEach(s=>{cumulative+=values[s.type];count++;});
    waves.push({round,portals:JSON.parse(JSON.stringify(portals)),blocked,spawned:JSON.parse(JSON.stringify(result.spawned)),cumulative,count});
  };
  f.evaluate(`const spawn=spawnCoopWave;spawnCoopWave=r=>{
    const portals=observe().portals;const result=spawn(r);checkWave(r,portals,result);
    for(const u of players[gameSettings.coop.demonSlot].units)knownUnits.add(u);return result;
  }; undefined;`);
  const rows=[];
  function capture() {
    const s=f.evaluate('observe()'),r=s.round;
    assert.equal(s.threshold,40,'unchanged flooding threshold');
    const human=s.births.reduce((sum,b)=>sum+b.value,0),projection=projected.reduce((sum,p)=>sum+p.ledger[r].armyValue,0);
    const row={...s,humanValue:human,demonValue:cumulative,spawnCount:count,target:1.4*human,
      relativeDeviation:cumulative/(1.4*human)-1,projectedHuman:projection,projectedDemon:projectedD[r].cumulative,
      humanProjectionError:human-projection,demonProjectionError:cumulative-projectedD[r].cumulative};
    rows.push(row);
    console.log(`ROUND ${id} r=${r} human=${human} demon=${cumulative.toFixed(4)} target=${row.target} deviation=${row.relativeDeviation.toFixed(6)} projectedHuman=${projection} projectedDemon=${row.projectedDemon.toFixed(4)} losses=${s.losses.length} portals=${s.portals.length} result=${s.result||'ongoing'}`);
  }
  capture();
  while(f.evaluate('gameRound<40&&!gameExit')) {
    const previous=f.evaluate('gameRound');
    let turns=0;
    while(f.evaluate(`gameRound===${previous}&&!gameExit`)) {
      assert(++turns<=humans,'round must progress after surviving human turns');
      f.evaluate('defend();nextTurn();');
    }
    capture();
  }
  const final=rows.at(-1),events=f.evaluate('events');
  assert(final.round===40||(final.terminal&&['victory','defeat'].includes(final.result)),'round 40 or genuine terminal');
  assert(events.some(e=>e.type==='recruit'));
  assert(events.some(e=>e.type==='complete'));
  assert(events.some(e=>e.type==='action'&&e.owner===humans+1),'real demon AI commands');
  // A naturally stalled wave is a measured outcome, not missing combat coverage.
  // The complete sample must still contain actual human attack commands.
  const result={id,size,humans,seed,waveSeed:0,mapHash:crypto.createHash('sha256').update(JSON.stringify(map)).digest('hex'),elapsedSeconds:(Date.now()-started)/1000,rows,waves,events,projected};
  fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(out,id+'-final-state.json'),f.evaluate('JSON.stringify(getGameObject())')+'\n');
  results.push(result);
  console.log(`PASS defensive-play ${id} expected=round40-or-genuine-terminal observed_round=${final.round} outcome=${final.result||'ongoing-at-40'} threshold=40 legal_actions=${events.filter(e=>e.type==='action').length} blocked=${waves.reduce((s,w)=>s+w.blocked,0)} portals_removed=${map.portals.length-final.portals.length} losses=${final.losses.length} elapsed_seconds=${result.elapsedSeconds}`);
}
assert(results.some(s=>s.events.some(e=>e.type==='action'&&e.owner>0&&e.owner<=s.humans&&e.attack)), 'sample includes real human defence combat');
const headings='| Scenario | Round | Human produced | Demon spawned value | 1.4 target | Relative deviation | Projected human | Projected demon | Losses | Portals |';
fs.writeFileSync(path.join(out,'defence-tables.md'),headings+'\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n'+results.flatMap(s=>s.rows.map(r=>`| ${s.id} | ${r.round} | ${r.humanValue} | ${r.demonValue.toFixed(4)} | ${r.target.toFixed(4)} | ${r.relativeDeviation.toFixed(6)} | ${r.projectedHuman} | ${r.projectedDemon.toFixed(4)} | ${r.losses.length} | ${r.portals.length} |`)).join('\n')+'\n');
fs.writeFileSync(path.join(out,'defence-summary.json'),JSON.stringify(results.map(s=>({id:s.id,rounds:s.rows.length,final:s.rows.at(-1),blocked:s.waves.reduce((n,w)=>n+w.blocked,0),events:s.events.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{}),elapsedSeconds:s.elapsedSeconds})),null,2)+'\n');
console.log(`PASS balanced-defence scenarios=${results.length} sizes=tiny,normal,big humans=1,2,3,4 threshold=40 all_required_endpoints=true real_combat=true independent_spawns=true financial_identities=true`);
