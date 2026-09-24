function initialEntities(map) {
  return [
    // Typed portals also carry a category (TASK-151); the ledger tracks position and owner.
    ...map.portals.map((c,i)=>({x:c.x,y:c.y,id:`portal-${i}`,kind:'portal',name:'demonPortal',owner:map.coop.demonSlot})),
    ...map.players.flatMap((p,owner)=>p.towns.flatMap((t,i)=>[
      {...t,id:`town-${owner}-${i}`,kind:'town',name:'town',owner},
      ...(owner ? [{...t,id:`unit-${owner}-${i}`,kind:'unit',name:'noob',owner}] : [])])),
    ...['goldmines','lakes','mountains','bushes'].flatMap(key=>map[key].map((c,i)=>({
      x:c.x,y:c.y,id:`${key}-${i}`,kind:key==='goldmines'?'goldmine':'nature',
      name:{goldmines:'goldmine',lakes:'lake',mountains:'mountain',bushes:'bush'}[key],owner:0})))
  ];
}
module.exports = {initialEntities};
