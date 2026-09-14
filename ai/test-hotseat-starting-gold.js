const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const outputIndex = process.argv.indexOf('--output-dir');
const out = path.resolve(outputIndex < 0 ? 'artifacts/TASK-116/regression' : process.argv[outputIndex+1]);
fs.mkdirSync(out,{recursive:true});
let saveNumber=0;
const {createFixture} = require('./test-coop-harness');
const f = createFixture(undefined,()=>{});
const e = source => f.evaluate(source);
const check = (label,observed,expected) => {
  console.log(JSON.stringify({label,expected,observed}));
  assert.deepEqual(observed,expected,label);console.log('PASS '+label);
};
// Only browser presentation/network callbacks are replaced. Map creation, turn
// dispatch, timers, economy, production and serialization are production code.
e(`GameManager.clearBasisValues=()=>{}; GameManager.updateCameraBorders=()=>{};
   gameEvent.nextTurn=()=>{}; globalThis.saveManager={save(){}};
   globalThis.nextTurnPauseInterface={visible:false};
   globalThis.SetupServerCommunicationLogic=()=>{}; undefined;`);
function start(name,index=0,online=false) {
  e(`GameManager.start(maps[${JSON.stringify(name)}][${index}],false,false,${online});`);
}
function state() {return e(`({slot:whooseTurn,round:gameRound,gold:players.slice(1).map(p=>p.gold)})`);}
function reload() {
  e('globalThis.saved=JSON.stringify(getGameObject()); loadFromJson(saved);');
  fs.writeFileSync(path.join(out,`save-${++saveNumber}.json`),e('saved'));
}
function rules() {
  const rows=e(`players.slice(1).map(p=>({towns:p.towns.map(t=>({suburbs:t.suburbs.filter(s=>s.isSuburb).length,buildings:t.buildings.length})),units:p.units.map(u=>u.name),mines:p.goldminesIncome}))`);
  return rows.map(row=>{
    assert.equal(row.mines,0);assert(row.units.every(n=>n==='noob'));
    assert(row.towns.every(t=>t.buildings===0));
    return row.towns.reduce((sum,t)=>sum+4+t.suburbs,0)-row.units.length;
  });
}
for(const [name,index] of [['open field',2],['tiny deathmatch',0]]) {
  start(name,index);
  const count=state().gold.length, expected=Array(count).fill(100), income=rules();
  console.log(JSON.stringify({map:name,humans:count,independentRules:{town:4,suburb:1,noobSalary:1},income}));
  for(let slot=1;slot<=count;slot++) {
    check(name+' first slot '+slot,state(),{slot,round:0,gold:expected});
    // Save in round zero with both consumed and unconsumed opening slots.
    reload();check(name+' restored opening slot '+slot,state(),{slot,round:0,gold:expected});
    e('players[whooseTurn].units.forEach(u=>{u.moves=0;u.wasHitted=true;});');
    if(slot<count)e('nextTurn();');
  }
  for(let slot=1;slot<=count;slot++) {
    e('nextTurn();');expected[slot-1]+=income[slot-1];
    check(name+' next economy slot '+slot,state(),{slot,round:1,gold:expected});
    check(name+' unit refresh '+slot,e('players[whooseTurn].units.map(u=>[u.moves,u.wasHitted])'),e('players[whooseTurn].units.map(()=>[2,false])'));
    check(name+' timer active '+slot,e('Number.isFinite(timer.time) && timer.time>0'),true);
  }
  // Explicit paid production action on each later turn; occupied town guards
  // prevent a new unit from spawning, so the independent salary stays fixed.
  for(let slot=1;slot<=count;slot++) {
    e('nextTurn();');expected[slot-1]+=income[slot-1];
    check(name+' production accepted '+slot,e("players[whooseTurn].towns[0].prepare('noob')"),true);
    expected[slot-1]-=20;
    check(name+' spend 20 slot '+slot,state(),{slot,round:2,gold:expected});
  }
  reload();check(name+' restored spent balances',state(),{slot:count,round:2,gold:expected});
  for(let slot=1;slot<=count;slot++) {
    e('nextTurn();');expected[slot-1]+=income[slot-1];
    check(name+' post-spend economy once '+slot,state(),{slot,round:3,gold:expected});
  }
  start(name,index);check(name+' restarted',state(),{slot:1,round:0,gold:Array(count).fill(100)});
}
for(const gold of [0,37,250]) {
  e(`maps['open field'][0].players.slice(1).forEach(p=>p.gold=${gold});`);
  start('open field');check('scenario override '+gold,state().gold,[gold,gold]);
  reload();e('nextTurn();');check('scenario restored unplayed '+gold,state().gold,[gold,gold]);
  e('nextTurn();');check('scenario later income '+gold,state().gold,[gold+10,gold]);
}
e("maps['open field'][0].players.slice(1).forEach(p=>delete p.gold);");
start('open field');
e('players[1].gold=73; players[2].gold=28;');reload();
check('loaded opening balances preserved',state().gold,[73,28]);
e('nextTurn();');check('loaded pending slot no reset',state().gold,[73,28]);
e('nextTurn();');check('loaded consumed slot later income',state().gold,[83,28]);
e('delete gameSettings.pendingHotseatOpeningEconomy; gameRound=0; players[1].gold=511; players[2].gold=612;');reload();
check('legacy save balances preserved',state().gold,[511,612]);
e('nextTurn();');check('legacy save retains economy behavior',state().gold,[511,622]);
start('open field',0,true);
check('online default unchanged',state().gold,[1000,1000]);
check('online no opening marker',e('gameSettings.pendingHotseatOpeningEconomy === undefined'),true);
e('startTurn();');check('online opening credit unchanged',state().gold,[1010,1000]);
e("maps['open field'][0].players[1].gold=0;");start('open field',0,true);
check('online explicit zero unchanged',state().gold,[0,1000]);
check('global Player fallback unchanged',e('new Player({r:0,g:0,b:0}).gold'),1000);
e("GameManager.start(generateCoopGame(2,{seed:0,size:'tiny'}),false);");
check('coop opening unchanged',state().gold,[110,100,0]);
check('coop no opening marker',e('gameSettings.pendingHotseatOpeningEconomy === undefined'),true);
console.log('PASS hotseat starting gold maps=2 humans=4,2 opening=100 save-load restart overrides=0,37,250 later-economy production-spend unit-refresh timers coop online');
