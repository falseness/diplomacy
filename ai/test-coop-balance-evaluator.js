// Independent offset-coordinate BFS, deliberately not using production neighbors,
// route helpers, balance metrics or tolerances. Distances include the target edge.
function evaluateBalance(map) {
  const key = c => `${c.x},${c.y}`;
  const targets = {mine:map.goldmines, town:map.players[0].towns, portal:map.portals};
  const endpoints = new Set([...targets.town,...targets.portal].map(key));
  const humans = map.players.slice(1,1+map.coop.initialHumanCount);
  return humans.map((p,i)=> {
    const blocked = new Set([...map.lakes,...map.mountains,
      ...humans.flatMap((other,j)=>i===j?[]:other.towns)].map(key));
    const distance = new Map(), queue=[];
    if(p.towns[0] && !blocked.has(key(p.towns[0]))) {
      queue.push(p.towns[0]); distance.set(key(p.towns[0]),0);
    }
    for(let head=0;head<queue.length;head++) {
      const c=queue[head]; if(endpoints.has(key(c))) continue;
      const shift=c.x%2 ? 0 : -1;
      const adjacent=[{x:c.x,y:c.y-1},{x:c.x,y:c.y+1},
        ...[-1,1].flatMap(dx=>[0,1].map(dy=>({x:c.x+dx,y:c.y+shift+dy})))];
      for(const n of adjacent) {
        const id=key(n);
        if(n.x<0||n.y<0||n.x>=map.mapSize.x||n.y>=map.mapSize.y||blocked.has(id)||distance.has(id)) continue;
        distance.set(id,distance.get(key(c))+1); queue.push(n);
      }
    }
    return {human:i+1,gold:p.gold,towns:p.towns.length,units:p.units.length+p.towns.length,
      ...Object.fromEntries(Object.entries(targets).map(([kind,cells])=>[kind,
        cells.length && cells.every(c=>distance.has(key(c))) ? Math.min(...cells.map(c=>distance.get(key(c)))) : Infinity]))};
  });
}
function balanced(metrics) {
  return ['gold','towns','units','mine','town','portal'].every(k=> {
    const values=metrics.map(m=>m[k]);
    return values.every(Number.isFinite) && Math.max(...values)-Math.min(...values)<=
      (['gold','towns','units'].includes(k)?0:4);
  });
}
module.exports={evaluateBalance,balanced};
