const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {createFixture} = require('./test-coop-harness');
const {routes, neighbours} = require('./test-coop-terrain-audit');
const index = process.argv.indexOf('--output-dir');
const out = path.resolve(index < 0 ? 'artifacts/TASK-122' : process.argv[index+1]);
fs.mkdirSync(out, {recursive:true});
const f = createFixture(undefined, ()=>{}), rows = [];
const key = c => `${c.x},${c.y}`;
// Independent unweighted BFS on the empty offset-hex board, not production's
// axial formula or any generator distance/connectivity self-report.
function distances(map, start) {
  const found = new Map([[key(start),0]]), queue = [start];
  for (let i=0;i<queue.length;i++) for (const n of neighbours(queue[i])) {
    if(n.x<0||n.y<0||n.x>=map.mapSize.x||n.y>=map.mapSize.y||found.has(key(n))) continue;
    found.set(key(n), found.get(key(queue[i]))+1); queue.push(n);
  }
  return map.portals.map(p=>found.get(key(p)));
}
function check(map, size, count) {
  const multiplier = {tiny:1,normal:2,big:3}[size], minimum = {tiny:6,normal:10,big:14}[size];
  assert.equal(map.portals.length, count*multiplier, 'exact portal count');
  const towns=map.players.flatMap(p=>p.towns);
  const objects=[...towns,...map.goldmines,...map.mountains,...map.lakes,...map.bushes,...map.hills,...map.portals];
  assert.equal(new Set(objects.map(key)).size,objects.length,'unique nonoverlapping objects');
  assert(map.portals.every(p=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<map.mapSize.x&&p.y<map.mapSize.y),'bounds');
  assert(map.portals.every(p=>towns.every(t=>Math.abs(p.x-t.x)>1||Math.abs(p.y-t.y)>1)),'outside town neighborhoods');
  const matrix=map.players.slice(1,count+1).map(p=>distances(map,p.towns[0]));
  assert(matrix.flat().every(d=>d>=minimum),'minimum hex distance');
  const attackRoutes=routes(map).map(row=>row.slice(0,map.portals.length));
  assert(attackRoutes.flat().every(Boolean),'every human attacks every portal');
  const blocked=new Set([...towns,...map.portals,...map.lakes,...map.mountains,...map.goldmines].map(key));
  const exits=map.portals.map(p=>neighbours(p).filter(n=>n.x>=0&&n.y>=0&&n.x<map.mapSize.x&&n.y<map.mapSize.y&&!blocked.has(key(n))));
  assert(exits.every(row=>row.length>0),'usable portal exits');
  return {expected:{portalCount:count*multiplier,minimumHexDistance:minimum,allRoutes:true,allExits:true},observed:{unique:true,inBounds:true,outsideStartingSuburbs:true,portalCount:map.portals.length,minimumHexDistance:Math.min(...matrix.flat()),distanceMatrix:matrix,attackRoutes,exits},portals:map.portals,starts:map.players.slice(1,count+1).map(p=>p.towns[0])};
}
module.exports={check};
if(require.main===module) {
for(const size of ['tiny','normal','big']) for(let count=1;count<=12;count++) for(let seed=0;seed<32;seed++) {
  const scenario=`${size}-humans-${count}-seed-${seed}`;
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}})`);
  const map=f.evaluate('JSON.parse(JSON.stringify(generated))');
  const row={scenario,...check(map,size,count)};
  assert.deepEqual(f.evaluate(`JSON.parse(JSON.stringify(generateCoopGame(${count},{size:'${size}',seed:${seed}})))`),map,'determinism '+scenario);
  if(seed===0) {
    f.context.fixtureConfig={actors:[{role:'neutral'},...Array.from({length:count},()=>({role:'human'})),{role:'demon'}]};
    f.evaluate('generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders(){}},false)');
    row.runtimeExits=f.evaluate(`generated.portals.map(p=>grid.getHexagon(p).neighbours.some(n=>
      !isCoordNotOnMap(n,grid.arr.length,grid.arr[0].length) &&
      !new Way().isCellImpassable(n,p,grid.arr,${count+1})))`);
    assert(row.runtimeExits.every(Boolean),'runtime Way demon exits');
    const before=f.evaluate('JSON.stringify(grid.arr.flat().filter(c=>c.building.name==="demonPortal").map(c=>c.coord))');
    f.evaluate('players[1].units.slice().forEach(u=>u.kill());players[1].towns.slice().forEach(t=>t.destroy());undefined');
    assert.equal(f.evaluate('JSON.stringify(grid.arr.flat().filter(c=>c.building.name==="demonPortal").map(c=>c.coord))'),before,'elimination does not rescale');
    assert.equal(JSON.parse(before).length,count*({tiny:1,normal:2,big:3}[size]),'runtime initial portal count');
    row.elimination={initialHumans:count,survivingHumans:count-1,expectedPortalCount:map.portals.length,observedPortalCount:JSON.parse(before).length};
  }
  rows.push(row);console.log(JSON.stringify(row));
}
// Deliberate corruption probes must fail the independent auditor.
const base=f.evaluate("JSON.parse(JSON.stringify(generateCoopGame(1,{size:'tiny',seed:0})))");
for(const [name,mutate] of [
  ['dropped-portal',m=>m.portals.pop()],
  ['too-close',m=>m.portals[0]={x:m.players[1].towns[0].x,y:m.players[1].towns[0].y+2}],
  ['overlap',m=>m.goldmines[0]={...m.portals[0]}],
  ['blocked-exit',m=>m.lakes.push(...neighbours(m.portals[0]).filter(n=>n.x>=0&&n.y>=0&&n.x<m.mapSize.x&&n.y<m.mapSize.y))]
]) {
  const copy=JSON.parse(JSON.stringify(base));mutate(copy);
  assert.throws(()=>check(copy,'tiny',1)); console.log('PASS expected corruption rejection '+name);
}
f.evaluate("globalThis.impossible=generateCoopGame(1,{size:'tiny',seed:0});impossible.mapSize={x:2,y:2}");
assert.throws(()=>f.evaluate("validateCoopTypedPortals(impossible)"),/Co-op typed portals/);
console.log('PASS impossible placement fails explicitly');
fs.writeFileSync(path.join(out,'portal-layout-matrix.json'),JSON.stringify(rows,null,2)+'\n');
console.log('PASS portal-layout matrix=1152 sizes=tiny,normal,big humans=1..12 seeds=0..31 counts=H*1/2/3 distance=6/10/14 deterministic=true routes=true exits=true elimination=36 corruption_probes=4');

}
