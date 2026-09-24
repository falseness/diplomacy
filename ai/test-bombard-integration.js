'use strict';
const {createFixture,defaultFixture}=require('./test-coop-harness');
const fixture=defaultFixture();fixture.coop=true;
for(const a of fixture.actors){a.units=[];a.towns=[];}
const setup=`whooseTurn=3;grid.getHexagon({x:4,y:6}).firstpaint(3);globalThis.actor=new (getClass('bombard'))(4,6);`;
const state=`({name:actor.name,className:actor.constructor.name,id:actor.id,owner:actor.playerColor,hp:actor.hp,coord:actor.coord,moves:actor.moves,wasHitted:actor.wasHitted,interaction:actor.interaction instanceof InteractionWithBombard})`;
function run(evaluate,input){
 const reset=()=>evaluate(`loadFromJson(${JSON.stringify(JSON.stringify(input))});${setup}undefined`);
 reset();evaluate(`actor.id='siege-234';actor.hp=3;actor.moves=1;actor.wasHitted=true;undefined`);
 const before=evaluate(state),saved=evaluate('JSON.parse(JSON.stringify(getGameObject()))');
 evaluate(`loadFromJson(${JSON.stringify(JSON.stringify(saved))});globalThis.actor=grid.getUnit({x:4,y:6});undefined`);
 const after=evaluate(state),rows=[];
 for(const target of ['building','unit-only']){
  reset();evaluate(`grid.getHexagon({x:4,y:3}).firstpaint(1);globalThis.victim=new ${target==='building'?'Wall':'Normchel'}(4,3);globalThis.trace=[];
   var original=actor.sendInstructions;actor.sendInstructions=function(cell){
    const before={coord:{...this.coord},moves:this.moves,hp:victim.hp};
    const legal=this.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,cell.coord));
    const attack=!!this.canHitSomethingOnCell(cell);const result=original.call(this,cell);
    trace.push({from:before.coord,to:{...cell.coord},legal,attack,before,after:{coord:{...this.coord},moves:this.moves,hp:victim.hp},result});return result;};undefined`);
  evaluate('players[3].play();undefined');
  rows.push({target,trace:evaluate('trace'),observed:evaluate('({hp:victim.hp,coord:actor.coord,moves:actor.moves})')});
 }
 reset();
 const factory=evaluate(`(() => {grid.getHexagon({x:2,y:4}).firstpaint(3);new DemonPortal(2,4);const result=placeCoopWave({selections:[{type:'bombard',x:2,y:4}]});return {result,className:grid.getUnit({x:2,y:4}).constructor.name};})()`);
 return {roundtrip:{before,after,saved},rows,factory};
}
if(require.main===module){
 let input,evaluate;
 if(process.argv.includes('--server')){
  input=JSON.parse(require('fs').readFileSync(0,'utf8'));require('../../diplomacy_server/server/loadGameCode');
  evaluate=s=>JSON.parse(JSON.stringify(require('vm').runInThisContext(s))??'null');
 }else{const f=createFixture(fixture,()=>{});evaluate=f.evaluate;input=evaluate('JSON.parse(JSON.stringify(getGameObject()))');}
 console.log('TASK234_RESULTS='+JSON.stringify({input,...run(evaluate,input)}));
}
module.exports={fixture};
