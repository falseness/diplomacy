const assert = require('node:assert/strict');
const CATEGORIES = ['melee','ranged','siege','heavy','support','chaos','mage'];
const PER_HUMAN = [3,3,1,1,1,1,1];
const key = c => `${c.x},${c.y}`;
const inside = (map,c) => Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<map.mapSize.x&&c.y<map.mapSize.y;

// Odd columns sit half a row lower: even x touches rows y-1..y of adjacent
// columns, odd x touches rows y..y+1.
function neighbours(c) {
  const shift = c.x % 2 ? 0 : -1;
  return [{x:c.x,y:c.y-1},{x:c.x,y:c.y+1},
    ...[-1,1].flatMap(dx=>[0,1].map(dy=>({x:c.x+dx,y:c.y+shift+dy})))];
}

// Unweighted BFS. blocked cells are never entered; endpoint cells are entered
// (an interaction edge) but never expanded; allowed, when given, limits cells.
function bfs(map, starts, {blocked=new Set(), endpoints=new Set(), allowed=null}={}) {
  const dist = new Map(), queue = [], origin = new Set(starts.map(key));
  for (const s of starts) if (inside(map,s)&&!blocked.has(key(s))&&(!allowed||allowed.has(key(s)))&&!dist.has(key(s))) {
    dist.set(key(s),0); queue.push(s);
  }
  for (let i=0;i<queue.length;i++) {
    const c = queue[i];
    if (!origin.has(key(c)) && endpoints.has(key(c))) continue;
    for (const n of neighbours(c)) {
      const id = key(n);
      if (!inside(map,n)||blocked.has(id)||dist.has(id)||(allowed&&!allowed.has(id))) continue;
      dist.set(id,dist.get(key(c))+1); queue.push(n);
    }
  }
  return dist;
}

// Layout-agnostic portal checks: per-category counts, every portal in bounds
// and no two portals sharing a cell.
function portalChecks(map, count) {
  const counts = Object.fromEntries(CATEGORIES.map(c=>[c,map.portals.filter(p=>p.category===c).length]));
  return [
    {name:'categories', expected:Object.fromEntries(CATEGORIES.map((c,i)=>[c,PER_HUMAN[i]*count])), observed:counts},
    {name:'counts', expected:11*count, observed:map.portals.length},
    {name:'portals-in-bounds', expected:true, observed:map.portals.every(p=>inside(map,p))},
    {name:'portals-distinct', expected:map.portals.length, observed:new Set(map.portals.map(key)).size},
  ].map(r=>({...r,pass:JSON.stringify(r.expected)===JSON.stringify(r.observed)}));
}

function checkGeneratedMap(map, count, seed, size = 'normal') {
  assert.deepEqual(map.coop.generation, {version:5,playerCount:count,seed,size,options:{seed,size}});
  for (const r of portalChecks(map,count)) assert.deepEqual(r.observed,r.expected,r.name);
  console.log(`PASS current-generation size=${size} humans=${count} seed=${seed} portals=${count*11}`);
}
module.exports = {checkGeneratedMap, portalChecks, neighbours, bfs, CATEGORIES};
