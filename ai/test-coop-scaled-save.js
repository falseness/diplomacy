'use strict';
const assert=require('node:assert/strict');
const {createFixture}=require('./test-coop-harness');
// Usage: node ai/test-coop-scaled-save.js [--output-dir DIR]  (DIR receives scaled-save.json)
const fs=require('node:fs'),path=require('node:path');
// Literal Circle contract: baseline radius is the smallest R >= min with R*R >= scale*scale*humans,
// growth adds at most 8; the grid is (2R+1)^2 and createMapEdge masks the R*R+R cells beyond layer R.
const radiusPreset={tiny:{min:10,scale:8},normal:{min:13,scale:11},big:{min:16,scale:14}};
const baselineFor=(size,count)=>{const p=radiusPreset[size];let R=p.min;while(R*R<p.scale*p.scale*count)R++;return R};
function run(){
 const f=createFixture(undefined,()=>{}),e=s=>f.evaluate(s),results=[];
 const check=(name,code,expected)=>{const observed=e(code);console.log(JSON.stringify({name,expected,observed}));assert.deepEqual(observed,expected,name);console.log('PASS '+name)};
 for(const [count,size,townsPerHuman,minesPerHuman] of [[1,'normal',3,4],[4,'normal',3,4],[12,'tiny',2,2],[12,'normal',3,4],[12,'big',4,6]]){
  const label=`scaled-save-H${count}-${size}`;
  e(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:1});generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear();
    gameSettings.coop.typedWaves={lastRound:3};gameSettings.coop.localPhase={round:3,stage:'complete'};gameRound=3;globalThis.before=JSON.stringify(getGameObject());loadFromJson(before)`);
  const R=e('generated.mapShape.radius'),side=2*R+1,baseline=baselineFor(size,count);
  check(label+'-radius-shape',`({growthOk:${R}>=${baseline}&&${R}<=${baseline+8},shape:gameSettings.mapShape})`,
   {growthOk:true,shape:{type:'hexagonal',center:{q:R,r:Math.ceil(R/2)},radius:R,offset:{x:0,y:0}}});
  check(label+'-metadata','gameSettings.coop.generation',{version:5,playerCount:count,seed:1,size,options:{seed:1,size}});
  // Circle terrain counts vary by seed; resources do not. nature also holds the R*R+R mask cells.
  // TASK-337: goldmines = humans * {tiny 2, normal 4, big 6}; TASK-422: neutral towns = humans * {2, 3, 4}.
  check(label+'-dimensions-counts',`({side:grid.arr.length,height:grid.arr[0].length,initial:gameSettings.coop.initialHumanCount,portals:external.filter(p=>p.isDemonPortal).length,humans:players.filter(p=>p.role==='HUMAN').length,
    neutralTowns:players[0].towns.length,goldmines:goldmines.length,humanTowns:players.slice(1,${count+1}).map(p=>p.towns.length),
    terrain:['mountain','lake','bush'].every(n=>nature.some(t=>t.name===n)),stored:[generated.mountains.length+generated.lakes.length+generated.bushes.length,nature.filter(t=>!t.isMapEdge).length],mask:nature.filter(t=>t.isMapEdge).length})`,
    {side,height:side,initial:count,portals:11*count,humans:count,neutralTowns:count*townsPerHuman,goldmines:count*minesPerHuman,
     humanTowns:Array(count).fill(1),terrain:true,stored:e('[generated.mountains.length+generated.lakes.length+generated.bushes.length,generated.mountains.length+generated.lakes.length+generated.bushes.length]'),mask:R*R+R});
  results.push({count,size,radius:R,side,portals:11*count,mask:R*R+R});
  check(label+'-all-registries-and-markers-exact','JSON.stringify(getGameObject())===before',true);
  if(count>1){e(`players[${count}].units.slice().forEach(u=>u.kill());players[${count}].towns.slice().forEach(t=>t.destroy());globalThis.afterDeath=JSON.stringify(getGameObject());loadFromJson(afterDeath)`);
   check(label+'-eliminated-initial-versus-surviving',`({initial:gameSettings.coop.initialHumanCount,surviving:players.filter(p=>p.role==='HUMAN'&&!p.isLost).length,side:grid.arr.length,portals:external.filter(p=>p.isDemonPortal).length,exact:JSON.stringify(getGameObject())===afterDeath})`,{initial:count,surviving:count-1,side,portals:11*count,exact:true});}
 }
 const i=process.argv.indexOf('--output-dir');
 if(i>=0){fs.mkdirSync(process.argv[i+1],{recursive:true});fs.writeFileSync(path.join(process.argv[i+1],'scaled-save.json'),JSON.stringify(results,null,1)+'\n')}
 console.log('PASS scaled-save presets=3 seven_categories=true controls=1,4 metadata=exact ownership_registries=exact phase_markers=exact');
}
module.exports={run};
if(require.main===module)run();
