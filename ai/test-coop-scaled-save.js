'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./test-coop-harness');
function run(){
 const f=createFixture(undefined,()=>{}),e=s=>f.evaluate(s);
 const check=(name,code,expected)=>{const observed=e(code);console.log(JSON.stringify({name,expected,observed}));assert.deepEqual(observed,expected,name);console.log('PASS '+name)};
 for(const [count,size,side,multiplier] of [[1,'normal',15,2],[4,'normal',25,2],[12,'tiny',26,1],[12,'normal',44,2],[12,'big',68,3]]){
  const label=`scaled-save-H${count}-${size}`;
  e(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:0});generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear();
    gameSettings.coop.waveGeneration={version:1,seed:42,lastRound:3};gameSettings.coop.localPhase={round:3,stage:'complete'};gameRound=3;globalThis.before=JSON.stringify(getGameObject());loadFromJson(before)`);
  check(label+'-metadata','gameSettings.coop.generation',{version:4,playerCount:count,seed:0,size,options:{seed:0,size}});
  // Divided Valley terrain counts vary with the planned ridge; resources do not.
  check(label+'-dimensions-counts',`({side:grid.arr.length,height:grid.arr[0].length,initial:gameSettings.coop.initialHumanCount,portals:external.filter(p=>p.isDemonPortal).length,humans:players.filter(p=>p.role==='HUMAN').length,
    neutralTowns:players[0].towns.length,goldmines:goldmines.length,humanTowns:players.slice(1,${count+1}).map(p=>p.towns.length),
    terrain:['mountain','lake','bush'].every(n=>nature.some(t=>t.name===n)),stored:[generated.mountains.length+generated.lakes.length+generated.bushes.length,nature.length]})`,
    {side,height:side,initial:count,portals:4*count,humans:count,neutralTowns:count*multiplier,goldmines:count*multiplier,
     humanTowns:Array(count).fill(1),terrain:true,stored:e('[generated.mountains.length+generated.lakes.length+generated.bushes.length,generated.mountains.length+generated.lakes.length+generated.bushes.length]')});
  check(label+'-all-registries-and-markers-exact','JSON.stringify(getGameObject())===before',true);
  if(count>1){e(`players[${count}].units.slice().forEach(u=>u.kill());players[${count}].towns.slice().forEach(t=>t.destroy());globalThis.afterDeath=JSON.stringify(getGameObject());loadFromJson(afterDeath)`);
   check(label+'-eliminated-initial-versus-surviving',`({initial:gameSettings.coop.initialHumanCount,surviving:players.filter(p=>p.role==='HUMAN'&&!p.isLost).length,side:grid.arr.length,portals:external.filter(p=>p.isDemonPortal).length,exact:JSON.stringify(getGameObject())===afterDeath})`,{initial:count,surviving:count-1,side,portals:4*count,exact:true});}
 }
 console.log('PASS scaled-save presets=3 H12_dimensions=26,44,68 controls=1,4 metadata=exact ownership_registries=exact phase_markers=exact');
}
module.exports={run};
if(require.main===module)run();
