// Hexagonal maps fill every cell beyond the radius with an InvisibleMountain at start.
function maskedCells(map) {
  const s=map.mapShape, cells=[];
  if(!s||s.type!=='hexagonal') return cells;
  for(let x=0;x<map.mapSize.x;x++) for(let y=0;y<map.mapSize.y;y++) {
    const q=x-s.center.q, r=y-Math.floor(x/2)-s.center.r;
    if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))>s.radius) cells.push({x,y});
  }
  return cells;
}
function initialEntities(map) {
  return [
    // Typed portals also carry a category (TASK-151); the ledger tracks position and owner.
    ...map.portals.map((c,i)=>({x:c.x,y:c.y,id:`portal-${i}`,kind:'portal',name:'demonPortal',owner:map.coop.demonSlot})),
    ...map.players.flatMap((p,owner)=>p.towns.flatMap((t,i)=>[
      {...t,id:`town-${owner}-${i}`,kind:'town',name:'town',owner},
      ...(owner ? [{...t,id:`unit-${owner}-${i}`,kind:'unit',name:'noob',owner}] : [])])),
    ...['goldmines','lakes','mountains','bushes'].flatMap(key=>map[key].map((c,i)=>({
      x:c.x,y:c.y,id:`${key}-${i}`,kind:key==='goldmines'?'goldmine':'nature',
      name:{goldmines:'goldmine',lakes:'lake',mountains:'mountain',bushes:'bush'}[key],
      // Circle starting mines are owned by their human; further mines stay neutral.
      owner:key==='goldmines'&&c.owner||0}))),
    ...maskedCells(map).map((c,i)=>({...c,id:`mask-${i}`,kind:'nature',name:'invisibleMountain',owner:0}))
  ];
}
module.exports = {initialEntities};
