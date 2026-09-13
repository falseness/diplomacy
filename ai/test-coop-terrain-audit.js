const assert = require('assert').strict;
const key = c => `${c.x},${c.y}`;
// Independent offset-hex geometry; never calls generator repair/path helpers.
function neighbours(c) {
  const shift = c.x % 2 ? 0 : -1;
  return [{x:c.x,y:c.y-1},{x:c.x,y:c.y+1},
    ...[-1,1].flatMap(dx=>[0,1].map(dy=>({x:c.x+dx,y:c.y+shift+dy})))];
}
function components(cells) {
  const remaining=new Set(cells.map(key)), sizes=[];
  for(const origin of cells) {
    if(!remaining.delete(key(origin))) continue;
    const queue=[origin];
    for(let i=0;i<queue.length;i++) for(const c of neighbours(queue[i]))
      if(remaining.delete(key(c))) queue.push(c);
    sizes.push(queue.length);
  }
  return sizes.sort((a,b)=>b-a);
}
function routes(map) {
  const targets=[...map.portals,...map.players[0].towns,...map.goldmines];
  const endpoints=new Set([...map.portals,...map.players[0].towns].map(key));
  return map.players.slice(1,1+map.coop.initialHumanCount).map((human,i)=>{
    const blocked=new Set([...map.lakes,...map.mountains,
      ...map.players.slice(1).flatMap((p,j)=>j===i?[]:p.towns)].map(key));
    const queue=[human.towns[0]], seen=new Set();
    for(let head=0;head<queue.length;head++) {
      const c=queue[head], id=key(c);
      if(c.x<0||c.y<0||c.x>=map.mapSize.x||c.y>=map.mapSize.y||blocked.has(id)||seen.has(id)) continue;
      seen.add(id);
      if(!endpoints.has(id)) queue.push(...neighbours(c));
    }
    return targets.map(c=>seen.has(key(c)));
  });
}
function audit(map,label) {
  const area=map.mapSize.x*map.mapSize.y;
  const towns=map.players.flatMap(p=>p.towns);
  const all=[...towns,...map.portals,...map.goldmines,...map.hills,...map.lakes,...map.mountains,...map.bushes];
  assert.equal(new Set(all.map(key)).size,all.length,label+' disjoint');
  assert(all.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<map.mapSize.x&&c.y<map.mapSize.y),label+' bounds');
  assert([...map.lakes,...map.mountains,...map.bushes].every(c=>towns.every(t=>Math.abs(c.x-t.x)>1||Math.abs(c.y-t.y)>1)),label+' starting-neighborhoods');
  const categories={};
  for(const [kind,target] of [['mountains',8],['lakes',6],['bushes',10]]) {
    const count=map[kind].length, groups=components(map[kind]);
    const minimum=Math.ceil(area*(target-2)/100),maximum=Math.floor(area*(target+2)/100);
    assert(count>=minimum&&count<=maximum,label+' density-'+kind);
    const clustered=groups.filter(n=>n>1).reduce((a,b)=>a+b,0);
    assert(clustered/count>=0.8,label+' clustered-'+kind);
    assert(groups[0]>=3,label+' formation-'+kind);
    categories[kind]={expected:{minimum,maximum,clusteredFractionAtLeast:0.8},observed:{count,density:100*count/area,components:groups,clusteredFraction:clustered/count}};
  }
  const observed=routes(map), expected=observed.map(row=>row.map(()=>true));
  assert.deepEqual(observed,expected,label+' all-objectives');
  return {scenario:label,area,categories,connectivity:{expected,observed},disjoint:true,inBounds:true,startingNeighborhoods:true};
}
module.exports={audit,routes,neighbours,components};
