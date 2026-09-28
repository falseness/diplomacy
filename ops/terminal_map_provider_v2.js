'use strict';
// TASK-225 opt-in acquisition. Compose the retained passive adapter without
// modifying its pinned helper or any gameplay state. Only shipped taps select.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const previous=require('./terminal_ac3_provider');
const marker="  // Append a digit through the shipped keypad:";
function instrument(source) {
 const composed=previous.instrument(source);
 assert.equal(composed.split(marker).length,2,'unique post-mode pre-play boundary');
 return composed.replace(marker,
  "  await require('/root/diplomacy/ops/terminal_map_provider_v2').select(p,mode,trace);\n"+marker);
}
async function select(p,mode,trace) {
 const read=()=>p.observe(()=>({
  mode:menu.online.isCoop?'coop':'competitive',
  map:menu.online.mapSlider.realValue,mapIndex:menu.online.mapSlider.value,
  humans:Number(menu.online.playersSlider.realValue),
  size:menu.online.isCoop?menu.online.sizeSlider.realValue:null,
  fog:menu.online.isFogOfWar,
  catalog:menu.online.isCoop?null:Object.entries(maps).flatMap(([name,variants],index)=>
   variants.filter(m=>!m.coop&&m.players.length===3).map(m=>({name,index,size:m.mapSize})))
 }));
 let state=await read();trace('ac7-menu-before',{participant:p.name,mode,state});
 assert.equal(state.mode,mode,'selection after mode switch');
 async function set(slider,field,target) {
  for(let count=0;state[field]!==target;count++) {
   assert(count<1000,'bounded slider traversal');
   const direction=Number(state[field])>target?'left':'right';
   const before=state[field];
   await p.tapControl(`menu.online.${slider}.${direction}Button`,'AC7 smallest map '+slider);
   state=await read();trace('ac7-menu-tap',{participant:p.name,mode,slider,direction,before,state});
   assert.notEqual(state[field],before,'shipped slider made progress');
  }
 }
 if(mode==='competitive') {
  const candidates=state.catalog.toSorted((a,b)=>a.size.x*a.size.y-b.size.x*b.size.y);
  assert.equal(candidates[0].name,'tiny deathmatch','reviewed minimum map');
  assert.deepEqual(candidates[0].size,{x:20,y:10},'reviewed minimum dimensions');
  await set('mapSlider','mapIndex',candidates[0].index);
  await set('playersSlider','humans',2);
  assert.equal(state.map,'tiny deathmatch');
 } else {
  await set('mapSlider','mapIndex',1);
  await set('playersSlider','humans',2);
  for(let i=0;state.size!=='Tiny';i++) {
   assert(i<2,'bounded size traversal');
   await p.tapControl('menu.online.sizeSlider.leftButton','AC7 tiny co-op');
   state=await read();
  }
 }
 assert.equal(state.humans,2);
 trace('ac7-menu-selected',{participant:p.name,mode,state});
 // Deliberately record only the whitelisted state above: the online canvas
 // also displays the temporary password, so never capture this menu image.
}
function install() {
 const Module=require('node:module'),load=Module._extensions['.js'];
 assert(!require.cache[previous.FILE],'adapter must precede helper load');
 Module._extensions['.js']=function(module,filename) {
  if(filename!==previous.FILE)return load(module,filename);
  Module._extensions['.js']=load;
  return module._compile(instrument(fs.readFileSync(filename,'utf8')),filename);
 };
 require('./terminal_ac2_provider').install();
}
if(process.env.TERMINAL_MAP_CAPTURE==='1'&&path.basename(process.argv[1]||'')==='terminal-flow.test.js')install();
module.exports={instrument,select};
