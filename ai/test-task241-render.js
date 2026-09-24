'use strict';
const fs=require('node:fs'),path=require('node:path');
const phases=['initial','repeat','pan','zoom'];
const cases=[];
for(const fog of [false,true])for(const cached of [false,true])for(const visible of [false,true])for(const phase of phases)
 cases.push(`browser-${fog?'simultaneous-fog-true':'sequential-fog-false'}/render-${cached}-${visible}-${phase}`);
for(const fog of [false,true])cases.push(`browser-${fog?'simultaneous-fog-true':'sequential-fog-false'}/destroyed`);
module.exports={cases,exercise};
async function exercise(p,c,out,check){
 const rows=[];
 // Explicit local rendering fixture after network reconnect, never claimed as gameplay.
 const fixture=await p.page.evaluate(()=>{
  gameEvent.removeSelection();
  const cells=[{x:2,y:5,kind:'portal',occupied:false},{x:3,y:5,kind:'portal',occupied:true},
   {x:4,y:6,kind:'goldmine',occupied:false},{x:5,y:6,kind:'goldmine',occupied:true},
   {x:6,y:6,kind:'town',occupied:false}];
  if(!grid.fogOfWar)grid.fogOfWar=grid.arr.map(col=>col.map(()=>0));
  new Goldmine(4,6,50);new Goldmine(5,6,50);
  // Enemy occupants are deliberately different from the scheduled portal preview.
  for(const q of cells.filter(q=>q.occupied)){grid.getHexagon(q).repaint(gameSettings.coop.demonSlot,false);new (new JsonUnpackManager().unitClass.bulwark)(q.x,q.y);}
  new Town(6,6);
  const proof=document.createElement('canvas');proof.id='task241-proof';proof.width=1280;proof.height=900;
  proof.style='position:fixed;left:0;top:0;z-index:99999;pointer-events:none;background:white';document.body.append(proof);
  gameEvent.screen.scale({x:WIDTH/2,y:HEIGHT/2},Math.log(0.45/canvas.scale)/0.001);
  gameEvent.screen.moveTo(grid.getCell({x:4,y:5}).pos);
  window.task241Cells=cells;return {cells,seed:1,initialFixture:true,purpose:'Controlled rendering states; no claim of gameplay or explored history'};
 });
 fs.writeFileSync(path.join(out,c.id,'render-fixture.json'),JSON.stringify(fixture,null,2));
 for(const cached of [false,true])for(const visible of [false,true])for(const phase of phases){
  if(phase==='initial')await p.page.evaluate(()=>{gameEvent.screen.scale({x:WIDTH/2,y:HEIGHT/2},Math.log(0.45/canvas.scale)/0.001);gameEvent.screen.moveTo(grid.getCell({x:4,y:5}).pos);});
  if(phase==='pan')await p.pan(36,0,await p.observe(()=>({...canvas.offset})));
  if(phase==='zoom'){await p.page.mouse.move(640,450);await p.page.mouse.wheel(0,-100);await p.page.waitForTimeout(80);}
  const observed=await p.page.evaluate(({cached,visible,phase})=>{
   const calls=[],cells=window.task241Cells;
   for(const q of cells)grid.fogOfWar[q.x][q.y]=visible?1:0;
   const mask=JSON.stringify(grid.fogOfWar);
   const restore=[];
   const wrap=(obj,key,fn)=>{const orig=obj[key];obj[key]=fn(orig);restore.push(()=>obj[key]=orig);};
   wrap(grid,'canUseSurfaceCache',()=>()=>cached);
   if(phase==='initial')grid.surfaceCache=undefined;
   wrap(FogOfWarHexagon.prototype,'draw',orig=>function(ctx){calls.push({kind:'fog',x:this.coord.x,y:this.coord.y});return orig.call(this,ctx);});
   wrap(window,'drawCachedImage',orig=>function(ctx,img,pos){
    const name=Object.keys(cachedImages).find(k=>cachedImages[k]===img);
    if(name)calls.push({kind:'image',name,x:pos.x,y:pos.y});return orig(ctx,img,pos);
   });
   for(const q of cells){const cell=grid.getCell(q);if(q.occupied)for(const key of ['draw','drawBars'])wrap(cell.unit,key,orig=>function(ctx){calls.push({kind:'occupant-'+key,x:q.x,y:q.y});return orig.call(this,ctx);});}
   wrap(grid,'drawSurfaceCache',orig=>function(ctx){calls.push({kind:'cache-blit'});return orig.call(this,ctx);});
   const ctx=document.querySelector('#task241-proof').getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,1280,900);
   // Use the actual camera transform after real keyboard/wheel input.
   ctx.setTransform(mainCtx.getTransform());
   const revision=grid.surfaceCacheRevision;
   try{grid.draw(ctx);}finally{for(const f of restore.reverse())f();}
   const rebuilt=grid.surfaceCacheRevision!==revision;
   const hidden=isFogOfWar&&!visible;
   return {calls,hidden,cached,rebuilt,revision:grid.surfaceCacheRevision,maskUnchanged:mask===JSON.stringify(grid.fogOfWar),
    camera:{scale:canvas.scale,offset:{...canvas.offset}},cells:cells.map(q=>{const cell=grid.getCell(q);return {...q,pos:cell.building.pos,unitPos:cell.unit.pos,unitName:cell.unit.name,
     screen:{x:(cell.building.pos.x-canvas.offset.x)*canvas.scale,y:(cell.building.pos.y-canvas.offset.y)*canvas.scale},
    image:grid.getEntityBodyImageName(cell.building),preview:cell.building.isDemonPortal?cell.building.nextProduction:null};})};
  },{cached,visible,phase});
  const id=c.id+`/render-${cached}-${visible}-${phase}`;
  const expectedHidden=c.fog&&!visible;
  const bodyPass=!cached||observed.rebuilt;
  for(const q of observed.cells)require('node:assert/strict').ok(q.screen.x>=0&&q.screen.x<1150&&q.screen.y>=0&&q.screen.y<770,'fixture fully in screenshot');
  const assertions=observed.cells.map(q=>{
   const image=observed.calls.findIndex(v=>v.kind==='image'&&v.name===q.image&&v.x===q.pos.x&&v.y===q.pos.y);
   const fog=observed.calls.findIndex(v=>v.kind==='fog'&&v.x===q.x&&v.y===q.y);
   const unitCalls=observed.calls.filter(v=>v.kind.startsWith('occupant-')&&v.x===q.x&&v.y===q.y).length;
   const unitImages=observed.calls.filter(v=>v.kind==='image'&&v.name===q.unitName&&v.x===q.unitPos?.x&&v.y===q.unitPos?.y).length;
   return {kind:q.kind,occupied:q.occupied,building:bodyPass?image>=0:null,fogBeforeBuilding:bodyPass&&expectedHidden&&q.kind!=='town'?fog>=0&&fog<image:null,
    hiddenUnitAbsent:expectedHidden?unitCalls===0&&unitImages===0:null,visibleOccupant:q.occupied&&!expectedHidden?unitCalls>0:null};
  });
  const expected=fixture.cells.map(q=>({kind:q.kind,occupied:q.occupied,building:bodyPass?!(expectedHidden&&q.kind==='town'):null,
   fogBeforeBuilding:bodyPass&&expectedHidden&&q.kind!=='town'?true:null,hiddenUnitAbsent:expectedHidden?true:null,visibleOccupant:q.occupied&&!expectedHidden?true:null}));
  check(id,{hidden:observed.hidden,maskUnchanged:observed.maskUnchanged,assertions},{hidden:expectedHidden,maskUnchanged:true,assertions:expected});
  const screenshot=c.id+'/screenshots/'+id.split('/')[1]+'.png';
  await p.page.locator('#task241-proof').screenshot({path:path.join(out,screenshot)});
  rows.push({id,screenshot,...observed,assertions,expected});
  fs.writeFileSync(path.join(out,'draw-order.json'),JSON.stringify({rows},null,2));
 }
 const destroyed=await p.page.evaluate(()=>{
  const q={x:2,y:5},portal=grid.getBuilding(q);const before=grid.surfaceCacheRevision;
  portal.kill();const match=grid.surfaceStateMatches();
  const images=[],orig=drawCachedImage;drawCachedImage=(ctx,img,pos)=>{if(img===cachedImages[portal.imageName]&&pos.x===portal.pos.x&&pos.y===portal.pos.y)images.push('destroyed-portal');return orig(ctx,img,pos);};
  const ctx=document.querySelector('#task241-proof').getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,1280,900);ctx.setTransform(mainCtx.getTransform());
  try{grid.createSurfaceCache();grid.drawSurfaceCache(ctx);grid.drawEntityOverlays(ctx);}finally{drawCachedImage=orig;}
  window.task241DestroyedCalls=images;
  return {removed:grid.getBuilding(q).isEmpty(),invalidated:!match,rebuilt:grid.surfaceCacheRevision===before+1,cachedGhost:grid.surfaceCacheBuildings.includes(portal),drawCalls:images};
 });
 check(c.id+'/destroyed',destroyed,{removed:true,invalidated:true,rebuilt:true,cachedGhost:false,drawCalls:[]});
 const screenshot=c.id+'/screenshots/destroyed.png';await p.page.locator('#task241-proof').screenshot({path:path.join(out,screenshot)});
 rows.push({id:c.id+'/destroyed',screenshot,observed:destroyed});
 await p.page.evaluate(()=>document.querySelector('#task241-proof').remove());
 return rows;
}
