'use strict';
const fs=require('node:fs'),path=require('node:path');
const cells=[{id:'portal-empty',x:2,y:8,name:'demonPortal',occupied:false},
 {id:'portal-occupied',x:3,y:8,name:'demonPortal',occupied:true},
 {id:'mine-empty',x:4,y:11,name:'goldmine',occupied:false},
 {id:'mine-occupied',x:5,y:11,name:'goldmine',occupied:true},
 {id:'hidden-unit-only',x:6,y:11,name:'Empty',occupied:true},
 {id:'empty-cell',x:7,y:11,name:'Empty',occupied:false},
 {id:'visible-control',x:2,y:5,name:'demonPortal',occupied:false}];
const journeys=['browser-clear','browser-fog-before','browser-fog-upgraded'];
const cases=journeys.flatMap(j=>cells.flatMap(q=>[j+'/'+q.id+'/selection',j+'/'+q.id+'/unchanged',...(q.name==='demonPortal'?[j+'/'+q.id+'/stats',j+'/'+q.id+'/back']:[])]));
for(const j of journeys.filter(j=>j!=="browser-clear"))for(const phase of ['gained','lost'])for(const suffix of ['selection','unchanged'])cases.push(j+'/'+phase+'/'+suffix);
module.exports={cases,exercise};
async function exercise(p,c,out,check){
 const rows=[];
 // Entity panels begin at y=540; the shared driver's general board zone
 // extends below that. Pan with actual keys before issuing each single click.
 const tapCell=async(coord,label,until)=>{
  let point=await p.cellPoint(coord);
  for(let i=0;point.y>430&&i<8;i++){
   const before=await p.observe(()=>({y:canvas.offset.y,scale:canvas.scale}));
   p.trace({action:'key-hold-until-camera',key:'ArrowDown',pixels:point.y-380});
   await p.page.keyboard.down('ArrowDown');
   try {await p.page.waitForFunction(({before,pixels})=>canvas.offset.y-before.y>=pixels/before.scale,
    {before,pixels:point.y-380},{timeout:5000});}
   finally {await p.page.keyboard.up('ArrowDown');}
   point=await p.cellPoint(coord);
  }
  require('node:assert/strict').ok(point.y<=430,'cell above entity panel');
  await p.tap(point,label+` cell=${coord.x},${coord.y}`,until);
 };
 const snapshot=async()=>({...await p.observe(()=>({board:JSON.stringify(getGameObject()),vision:JSON.stringify(grid.fogOfWar),commands:JSON.stringify(humanCommands),undo:JSON.stringify(actionManager.arr)})),outgoing:fs.readFileSync(path.join(out,c.id,'network-trace.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s)).filter(r=>r.player==='p0'&&r.direction==='sent'&&r.event)});
 for(const q of cells){
  const before=await snapshot();
  const hidden=c.fog&&q.id!=='visible-control';
  const name=!hidden&&q.occupied?'bulwark':hidden&&q.name==='Empty'?'Empty':q.name;
  await tapCell(q,'inspect '+q.id,name==='Empty'?"gameEvent.selected.isEmpty()":`gameEvent.selected.name==='${name}' && gameEvent.selected.coord.x===${q.x} && gameEvent.selected.coord.y===${q.y}`);
  const observed=await p.observe(({x,y})=>({selected:gameEvent.selected.isEmpty()?'Empty':gameEvent.selected.name,unit:gameEvent.selected.isUnit===true,
   visible:entityInterface.visible,vision:!!grid.fogOfWar?.[x]?.[y],info:entityInterface.entity.name.text,text:entityInterface.entity.info.text}),q);
  check(c.id+'/'+q.id+'/selection',{selected:observed.selected,unit:observed.unit,visible:observed.visible,vision:c.fog?observed.vision:null,info:name==='Empty'?null:observed.info,mineInfo:name==='goldmine'?observed.text:null},
   {selected:name,unit:name==='bulwark',visible:name!=='Empty',vision:c.fog?!hidden:null,info:name==='Empty'?null:name==='demonPortal'?'demon portal':name,mineInfo:name==='goldmine'?`income: 50\nrounds to open: ${20-c.round}`:null});
  if(q.name==='demonPortal'){
   if(name==='bulwark')await tapCell(q,'cycle to building',"gameEvent.selected.name==='demonPortal'");
   await p.tapControl('entityInterface.portalStatsButton','portal stats','entityInterface.portalDescription');
   const stats=await p.observe(()=>({name:entityInterface.entity.name.text,text:entityInterface.entity.info.text}));
   const ranged=q.id==='portal-occupied';
   const type=c.round===4?(ranged?'spitter':'clawling'):(ranged?'spitter':'imp');
   check(c.id+'/'+q.id+'/stats',stats,{name:type,text:type==='clawling'?'hp: 1\ndmg: 2\nmovement: 2\nrange: 1':'hp: 2\ndmg: 1\nmovement: 2\nrange: 1'});
   const shot=await p.screenshot(q.id+'-stats');rows.push({id:c.id+'/'+q.id+'/stats',screenshot:c.id+'/screenshots/'+shot.file,observed:stats});
   await p.tapControl('entityInterface.portalBackButton','portal back','!entityInterface.portalDescription');
   check(c.id+'/'+q.id+'/back',await p.observe(()=>({name:entityInterface.entity.name.text,selected:gameEvent.selected.name})),{name:'demon portal',selected:'demonPortal'});
  }
  const after=await snapshot();check(c.id+'/'+q.id+'/unchanged',after,before);
  const shot=await p.screenshot(q.id);rows.push({id:c.id+'/'+q.id+'/selection',screenshot:c.id+'/screenshots/'+shot.file,observed,before,after});
  fs.writeFileSync(path.join(out,'selection-observations.json'),JSON.stringify({rows},null,2));
 }
 if(c.fog){
  await tapCell({x:1,y:4},'select scout',"gameEvent.selected.name==='noob'");
  await tapCell({x:1,y:6},'move scout to gain vision',"grid.getUnit({x:1,y:6}).name==='noob'");
  for(const phase of ['gained','lost']){
   if(phase==='lost'){
    p.trace({action:'keyboard.press',key:'z',label:'undo scout move to lose vision'});
    await p.page.keyboard.press('z');
    await p.page.waitForFunction(()=>grid.getUnit({x:1,y:4}).name==='noob'&&!grid.fogOfWar[2][8]);
    // Undo reselects the restored scout with available orders. Explicitly
    // deselect it through the UI before beginning the inspection snapshot.
    await tapCell({x:1,y:4},'deselect restored scout',"gameEvent.selected.isEmpty()");
   }
   const before=await snapshot();
   await tapCell({x:2,y:8},'reselect portal after vision '+phase,"gameEvent.selected.name==='demonPortal' && gameEvent.selected.coord.x===2 && gameEvent.selected.coord.y===8");
   check(c.id+'/'+phase+'/selection',await p.observe(()=>({selected:gameEvent.selected.name,visible:!!grid.fogOfWar[2][8],unit:gameEvent.selected.isUnit===true})),
    {selected:'demonPortal',visible:phase==='gained',unit:false});
   const after=await snapshot();check(c.id+'/'+phase+'/unchanged',after,before);
   const shot=await p.screenshot(phase);rows.push({id:c.id+'/'+phase+'/selection',screenshot:c.id+'/screenshots/'+shot.file,before,after});
  }
 }
 return rows;
}
