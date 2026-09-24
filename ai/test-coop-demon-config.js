'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Independent TASK-232 contract. Do not derive expectations from production.
const expected = {
  imp: ['imp', 'fragile basic melee', 2, 1, 2, false, 1],
  clawling: ['clawling', 'quick light melee', 1, 2, 2, false, 1],
  hound: ['hound', 'fast melee pursuit', 2, 1, 5, false, 1],
  brute: ['brute', 'slow high-health melee', 3, 2, 2, false, 1],
  bulwark: ['bulwark', 'very durable slow melee', 7, 1, 2, false, 1],
  spitter: ['spitter', 'fragile short-range attacker', 2, 1, 2, true, 1],
  emberArcher: ['ember archer', 'mobile ranged attacker', 1, 1, 2, true, 3],
  hexcaster: ['hexcaster', 'slow stronger ranged attacker', 1, 3, 1, true, 2],
  ravager: ['ravager', 'fast strong late-game melee', 4, 1, 3, false, 1],
  demonLord: ['demon lord', 'durable powerful late-game melee', 5, 3, 2, false, 1]
};
// Current saves require balanceVersion 2; obsolete formats are rejection cases
// in TASK-243/244, not alternate accepted combat configurations.
const versions = [2];
const probe = `(() => {
  whooseTurn=gameSettings.coop.demonSlot;
  return [Imp,Clawling,Hound,Brute,Bulwark,Spitter,EmberArcher,Hexcaster,Ravager,DemonLord].map(C=>{
    grid.getHexagon({x:5,y:4}).repaint(whooseTurn,false);
    const u=new C(5,4);
    const row={id:C.type, constructor:[u.hp,u.dmg,u.speed,u.range ?? 1],
      description:C.description.info, info:u.info, salary:u.salary, healSpeed:C.healSpeed};
    u.kill(); return row;
  });
})()`;
function expectedUnit(id) {
  const [name,,hp,dmg,speed,ranged,range] = expected[id];
  return {id, constructor:[hp,dmg,speed,range],
    description:{hp,'heal speed':0,dmg,speed,salary:0,...(ranged?{range}:{})},
    info:{name:id,info:{hp:hp+' / '+hp,dmg,moves:speed+' / '+speed},
      displayName:name,canSkipMoves:true},salary:0,healSpeed:0};
}
function browserSource() {
  const config=defaultFixture(); config.coop=true;
  const f=createFixture(config);
  const inputs=[], observations=[];
  for (const version of versions) {
    f.evaluate(`gameSettings.coop.balanceVersion=${version}`);
    inputs.push(f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'));
    observations.push({version,rows:f.evaluate(probe)});
  }
  return {fixture:config,inputs,observations};
}
if (require.main === module) {
  if (process.argv.includes('--server')) {
    require('../../diplomacy_server/server/loadGameCode');
    const inputs=JSON.parse(fs.readFileSync(0,'utf8'));
    const observations=inputs.map((input,i)=>{
      global.task232Input=input;
      vm.runInThisContext('loadFromJson(JSON.stringify(task232Input))');
      return {version:versions[i],rows:vm.runInThisContext(probe)};
    });
    console.log('TASK232_SERVER_RESULTS='+JSON.stringify(observations));
  } else {
    const result=browserSource();
    for (const {version,rows} of result.observations) for (const row of rows) {
      assert.deepEqual(row,expectedUnit(row.id));
      console.log(`PASS browser-source/${version}/${row.id}`);
    }
  }
}
module.exports={expected,versions,expectedUnit,browserSource};
