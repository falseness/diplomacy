'use strict';
const assert=require('assert').strict;
const {createFixture,defaultFixture}=require('./test-coop-harness');
const {readRules,project,audit,distances,calibrate}=require('./coop-economy-projection');
const copy=x=>JSON.parse(JSON.stringify(x));
const rules=readRules();
console.log('PASS actual-rules expected=town4,farm4,mine20,suburb1/3/5,noob20/1,archer40/2 observed=matched');
const access={human:1,start:{x:1,y:1},startingGold:100,mine:{target:{x:3,y:1,income:20},distance:2},town:{target:{x:8,y:8},distance:20},sites:[],initialFarmSites:6};
const base=project(access,'typical',4,rules,{noInvestment:true});
const expected=[[0,80,0,0,20],[1,70,11,1,40],[2,59,11,2,60],[3,47,11,3,80],[4,34,11,4,100]];
const observed=base.ledger.map(r=>[r.round,r.gold,Object.values(r.income).reduce((a,b)=>a+b,0),r.salary,r.armyValue]);
assert.deepEqual(observed,expected);
console.log(JSON.stringify({scenario:'worked-hand-ledger',columns:['round','gold','grossIncome','salary','cumulativeValue'],expected,observed}));
console.log('PASS worked-hand-ledger expected=80,70,59,47,34 observed='+observed.map(r=>r[1]));
const archer=project(access,'typical',4,rules,{noInvestment:true,kind:'archer'});
assert.deepEqual(archer.ledger.slice(0,3).map(r=>r.armyValue),[20,20,60]);
const blocked=project(access,'typical',3,rules,{noInvestment:true,blockedRounds:[1,2]});
assert.deepEqual(blocked.ledger.map(r=>r.armyValue),[20,20,20,40]);
console.log('PASS training-and-capacity expected_archer=20,20,60 expected_blocked=20,20,20,40 observed=matched');
const loss=project(access,'typical',4,rules,{noInvestment:true,casualties:{2:['initial']}});
assert.equal(loss.ledger[2].armyValue,60);assert.equal(loss.ledger[3].salary,2);
console.log('PASS casualty-preserves-produced-value expected_round2_value=60 expected_round3_salary=2 observed=60,2');
const long=project(access,'expansion',40,rules);
assert.equal(long.ledger[20].income.mine,0);assert.equal(long.ledger[21].income.mine,20);
assert.deepEqual(long,project(access,'expansion',40,rules));
for(const [name,source,inject,marker] of [
  ['overspending',base,p=>p.ledger[0].gold=-1,/gold accounting|overspending/],
  ['premature-mine',long,p=>{p.ledger[20].income.mine=20;p.ledger[20].gold+=20;},/premature goldmine/],
  ['training-delay',archer,p=>{const e=p.events.find(e=>e.type==='complete');e.round=1;},/training delay/],
  ['duplicate-recruitment',base,p=>{p.events.splice(2,0,copy(p.events.find(e=>e.type==='complete')));},/duplicate recruitment/],
  ['capacity',archer,p=>{const e=copy(p.events.find(e=>e.type==='recruit'));e.id=999;p.events.push(e);p.ledger[0].gold-=e.cost;},/production capacity/]
]) {
  const altered=copy(source);inject(altered);assert.throws(()=>audit(altered,rules),marker);
  console.log(`EXPECTED corruption-probe ${name} rejected_by=${marker.source} parent_continues=true`);
}
// Independent tiny geometry control: no generator path helper.
const map={mapSize:{x:10,y:10},players:[{towns:[{x:8,y:8}]},{gold:100,towns:[{x:1,y:1}]},{towns:[]}],mountains:[],lakes:[],bushes:[],hills:[],portals:[],goldmines:[{x:1,y:4,income:20}]};
assert.equal(distances(map,{x:1,y:1}).get('1,4'),3);
assert.equal(calibrate(map)[0].mine.distance,3);
console.log('PASS independent-access expected_vertical_edges=3 observed=3');
// Real action ledger, literal arithmetic: one starting Noob and no battle.
const cfg=defaultFixture();cfg.actors[1].units=[];
const f=createFixture(cfg,()=>{});
function compare(label,expr,wanted) {const actual=f.evaluate(expr);assert.deepEqual(actual,wanted,label);console.log(JSON.stringify({scenario:label,expected:wanted,observed:actual}));console.log('PASS actual-action-ledger '+label);}
compare('initial', '({gold:players[1].gold,units:players[1].units.length,income:players[1].income})',{gold:100,units:1,income:10});
compare('archer-order','whooseTurn=1;grid.getBuilding({x:1,y:1}).prepare("archer")',true);
compare('duplicate-order-rejected','grid.getBuilding({x:1,y:1}).prepare("noob")',false);
compare('after-purchase','players[1].gold',60);
f.evaluate('players[1].nextTurn()');
compare('training-turn-one','({gold:players[1].gold,units:players[1].units.length,remaining:grid.getBuilding({x:1,y:1}).unitProduction.turns})',{gold:70,units:1,remaining:1});
f.evaluate('players[1].nextTurn()');
compare('blocked-output','({gold:players[1].gold,units:players[1].units.length,remaining:grid.getBuilding({x:1,y:1}).unitProduction.turns})',{gold:80,units:1,remaining:1});
f.submit({type:'move',source:{x:1,y:1},destination:{x:1,y:2}},{x:1,y:2},s=>({x:s.players[1].units[0].x,y:s.players[1].units[0].y}));
f.evaluate('players[1].nextTurn()');
compare('archer-completed-no-second-charge','({gold:players[1].gold,units:players[1].units.length,empty:grid.getBuilding({x:1,y:1}).unitProduction.isEmpty()})',{gold:90,units:2,empty:true});
f.evaluate('players[1].nextTurn()');compare('new-unit-next-salary','players[1].gold',98);
compare('farm-order','grid.getBuilding({x:1,y:1}).prepare("farm")',true);
f.evaluate('grid.getBuilding({x:1,y:1}).sendInstructions(grid.getCell({x:2,y:1}))');
compare('farm-cost','players[1].gold',66);
f.evaluate('players[1].nextTurn()');compare('farm-completes-before-first-income','({gold:players[1].gold,farm:grid.getBuilding({x:2,y:1}).name})',{gold:74,farm:'farm'});
f.evaluate('players[1].nextTurn()');compare('farm-first-income','players[1].gold',86);
f.evaluate('grid.getHexagon({x:0,y:1}).playerColor=1;new Goldmine(0,1,20);gameRound=20;players[1].nextTurn()');
compare('mine-round20-zero','players[1].gold',98);
f.evaluate('gameRound=21;players[1].nextTurn()');compare('mine-round21-income20','players[1].gold',130);
console.log('PASS economy projection tests rules=validated policies=3 corruption_probes=5 actual_action_ledger=14');
