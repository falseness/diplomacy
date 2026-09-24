'use strict';
const {createFixture,defaultFixture}=require('./test-coop-harness');
const cases=[];
for(const target of ['wall','town','occupied-town','unit'])for(const distance of [1,2,3])
  cases.push({id:`${target}-${distance}`,target,distance});
for(const id of ['spent','one-move','lethal-occupied-town','move','neutral','friendly','incoming','catapult-control','catapult-blind'])
  cases.push({id,target:id==='move'?'empty':id==='incoming'?'unit':id==='lethal-occupied-town'?'occupied-town':id==='neutral'?'town':'wall',distance:id==='move'||id==='incoming'?1:id==='catapult-control'?5:2});
const fixture=defaultFixture();fixture.coop=true;fixture.actors[0].towns=[];
const snapshot=`({hp:actor.hp,moves:actor.moves,coord:actor.coord,buildingHP:targetBuilding?targetBuilding.hp:null,buildingPresent:targetBuilding?grid.getBuilding(to)===targetBuilding:false,unitHP:victim?victim.hp:null,occupant:victim?grid.getUnit(to)===victim:false,occupantKilled:victim?!!victim.killed:false,owner:actor.playerColor,gold:actor.player.gold,undo:actionManager.arr.length})`;
function setup(c){return `whooseTurn=${c.id.startsWith('catapult')?1:3};
 globalThis.to={x:4,y:${5-c.distance}};
 grid.getHexagon({x:4,y:5}).firstpaint(whooseTurn);
 globalThis.actor=new ${c.id.startsWith('catapult')?'Catapult':'Bombard'}(4,5);
 grid.getHexagon(to).firstpaint(${c.id==='neutral'?0:c.id==='friendly'?3:c.id.startsWith('catapult')?3:1});
 globalThis.targetBuilding=null;globalThis.victim=null;
 ${c.target.includes('town')?'targetBuilding=new Town(to.x,to.y);':c.target==='wall'?'targetBuilding=new Wall(to.x,to.y);':''}
 ${c.target==='unit'||c.target==='occupied-town'?'victim=new Normchel(to.x,to.y);':''}
 ${c.id==='lethal-occupied-town'?'targetBuilding.hp=1;':''}
 ${c.id==='spent'?'actor.moves=0;':c.id==='one-move'?'actor.moves=1;':''}
 actionManager.clear();undefined;`}
function observe(evaluate,c){
 evaluate(setup(c));
 const before=evaluate(snapshot);
 const stats=evaluate(`({hp:actor.constructor.maxHP,damage:actor.dmg,buildingDamage:actor.buildingDMG,speed:actor.speed,range:actor.range,salary:actor.salary,heal:actor.constructor.healSpeed,role:actor.player.role,economy:actor.player.economyEnabled,recruitable:Object.values(production).some(p=>p.class===Bombard),description:Bombard.description.info,info:actor.info,saveClass:new JsonUnpackManager().unitClass.bombard===Bombard})`);
 const command=evaluate(`(() => {actor.select();const canHit=!!actor.canHitSomethingOnCell(grid.getCell(to));const needed=actor.needInstructions();const result=needed?actor.sendInstructions(grid.getCell(to)):null;return {canHit,needed,result};})()`);
 const after=evaluate(snapshot);
 let incoming=null;
 if(c.id==='incoming')incoming=evaluate(`(() => {whooseTurn=1;const hp=victim.hp;victim.select();const result=victim.sendInstructions(grid.getCell(actor.coord));return {before:hp,after:victim.hp,bombardHP:actor.hp,result};})()`);
 return {id:c.id,fixture:c,before,after,stats,command,incoming};
}
function expected(row,c){
 const before={hp:c.id.startsWith('catapult')?1:4,moves:c.id==='spent'?0:c.id==='one-move'?1:2,coord:{x:4,y:5},
 buildingHP:c.target==='wall'?5:c.target.includes('town')?(c.id==='lethal-occupied-town'?1:10):null,
 buildingPresent:c.target==='wall'||c.target.includes('town'),unitHP:c.target==='unit'||c.target==='occupied-town'?5:null,
 occupant:c.target==='unit'||c.target==='occupied-town',occupantKilled:false,owner:c.id.startsWith('catapult')?1:3,gold:c.id.startsWith('catapult')?100:0,undo:0};
 const after=structuredClone(before);
 const legal=(c.distance===2 && !['unit','empty'].includes(c.target) && !['spent','neutral','friendly','catapult-blind'].includes(c.id))||c.id==='catapult-control';
 if(legal){after.buildingHP=Math.max(0,after.buildingHP-4);after.moves=0;after.undo=1;}
 if(c.id==='move'){after.coord={x:4,y:4};after.moves=1;after.undo=1;}
 return {before,after,command:{canHit:legal,needed:c.id!=='spent',result:c.id==='spent'?null:c.id==='move'?false:true},incoming:c.id==='incoming'?{before:5,after:5,bombardHP:3,result:true}:null};
}
function runBrowser(){const f=createFixture(fixture,()=>{});const input=f.evaluate('JSON.parse(JSON.stringify(getGameObject()))');
 const roundtrip=f.evaluate(`(() => {whooseTurn=3;grid.getHexagon({x:4,y:5}).firstpaint(3);new Bombard(4,5);const saved=JSON.stringify(getGameObject());loadFromJson(saved);const u=grid.getUnit({x:4,y:5});return {name:u.name,hp:u.hp,moves:u.moves,range:u.range,owner:u.playerColor,interaction:u.interaction instanceof InteractionWithBombard};})()`);
 return {input,roundtrip,rows:cases.map(c=>{const fresh=createFixture(fixture,()=>{});return observe(fresh.evaluate,c);})};}
if(require.main===module){
 if(process.argv.includes('--server')){const fs=require('fs'),vm=require('vm');require('../../diplomacy_server/server/loadGameCode');global.task233Input=JSON.parse(fs.readFileSync(0,'utf8'));
 const rows=cases.map(c=>{vm.runInThisContext('loadFromJson(JSON.stringify(task233Input));');return observe(s=>JSON.parse(JSON.stringify(vm.runInThisContext(s)) ?? 'null'),c);});
 console.log('TASK233_RESULTS='+JSON.stringify({rows}));
 }else console.log('TASK233_RESULTS='+JSON.stringify(runBrowser()));
}
module.exports={cases,fixture,expected};
