'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const adapter=require('./terminal_map_provider_v2'),previous=require('./terminal_ac3_provider');
test('map adapter retains entire passive composition around one post-mode pre-play insertion',()=>{
 const source=fs.readFileSync(previous.FILE,'utf8'),base=previous.instrument(source),composed=adapter.instrument(source);
 const added="  await require('/root/diplomacy/ops/terminal_map_provider_v2').select(p,mode,trace);\n";
 assert.equal(composed.replace(added,''),base);
 assert(composed.indexOf(added)>composed.indexOf("'next game mode'"));
 assert(composed.indexOf(added)<composed.indexOf("'new game start'"));
 assert.throws(()=>adapter.instrument(source+' '),/unreviewed AC3 helper/);
});
test('unchanged shipped catalog independently confirms smallest two-human competitive map',()=>{
 const sources=Object.fromEntries(['options/dictionaryToList.js','options/gamestart.js'].map(n=>[n,fs.readFileSync(n,'utf8')]));
 const maps=require('./inspect_terminal_scope').competitiveMaps(sources);
 const smallest=maps.toSorted((a,b)=>a.size.x*a.size.y-b.size.x*b.size.y)[0];
 assert.deepEqual(smallest,{name:'tiny deathmatch',size:{x:20,y:10},humans:2});
});
test('source selector uses shipped slider semantics and omits password and screenshot in both modes',async()=>{
 const vm=require('node:vm');
 for(const mode of ['coop','competitive']) {
  const context=vm.createContext({});
  for(const name of ['options/dictionaryToList.js','options/gamestart.js','sprites/elements/slider.js'])vm.runInContext(fs.readFileSync(name,'utf8'),context);
  vm.runInContext(`
   const button=()=>({});
   const slider=(value,min,max,text)=>new Slider(()=>min,()=>max,text,undefined,value,1,{x:0,y:0},button(),button());
   const isCoop=${mode==='coop'};
   const menu={online:{isCoop,currentPassword:'PASSWORD_SENTINEL_DO_NOT_CAPTURE',isFogOfWar:!isCoop,
    mapSlider:isCoop?slider(3,0,999,n=>n):slider(0,0,Object.keys(maps).length-1,n=>Object.keys(maps)[n]),
    playersSlider:isCoop?slider(3,2,12,n=>n):slider(0,0,0,n=>n+2),
    sizeSlider:slider(2,0,2,n=>['Tiny','Normal','Big'][n])}};
  `,context);
  const traces=[],taps=[];
  const p={name:'p1',observe:fn=>JSON.parse(vm.runInContext('JSON.stringify(('+fn.toString()+')())',context)),
   tapControl:async expression=>{taps.push(expression);vm.runInContext(`{const b=${expression};b.clickFunc.call(b.callThis,b.parameters);}`,context);},
   screenshot:()=>assert.fail('menu screenshot exposes credential'),page:{screenshot:()=>assert.fail('menu screenshot exposes credential')}};
  await adapter.select(p,mode,(stage,row)=>traces.push({stage,...row}));
  const selected=traces.at(-1).state;
  assert.equal(selected.humans,2);assert.equal(selected.map,mode==='coop'?'1':'tiny deathmatch');
  assert(taps.length>0,'changed selections exercised');
  assert.equal(JSON.stringify(traces).includes('PASSWORD_SENTINEL'),false);
  for(const row of traces)assert.deepEqual(Object.keys(row.state).sort(),['catalog','fog','humans','map','mapIndex','mode','size']);
 }
});
