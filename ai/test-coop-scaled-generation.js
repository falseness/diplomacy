'use strict';
// Audit archived map bytes independently; do not rerun unchanged generation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/TASK-127');fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root,p))).digest('hex');
const identities=read('artifacts/TASK-126/projection-source-identity.json').sha256;
const sources=['ai/generateMap.js','ai/coop-map-scaling.js','ai/test-coop-terrain-audit.js','ai/test-coop-portal-layout.js','ai/test-coop-balance-evaluator.js'];
for(const p of sources){assert.equal(hash(p),identities[p],p+' source identity');console.log('PASS source-matched '+p+' '+hash(p))}
// The only generation change after the graph audits was the display palette.
// Normalize exactly that change and require byte identity, rather than assuming
// old connectivity evidence applies to a merely similar generator.
const oldSources=read('artifacts/TASK-122/source-hashes.json');
const current=fs.readFileSync(path.join(root,'ai/generateMap.js'),'utf8');
const geometry=current.replace('rgb: coopPlayerColor(i+1)','rgb: trainingPlayerColor(i+1)').replace(/\/\/ Co-op ownership is the numeric slot, independent of this display palette\.[\s\S]*?(?=function trainingPlayerColor)/,'');
assert.equal(crypto.createHash('sha256').update(geometry).digest('hex'),oldSources['ai/generateMap.js']);
for(const p of sources.slice(1))assert.equal(hash(p),oldSources[p]);
const archived=new Map(read('artifacts/TASK-122/balance-repair-matrix.json').map(r=>[r.scenario,r]));
assert.equal(archived.size,1152);
for(const [file,marker] of [['generation-balance.log','PASS balance matrix=1152'],['generation-connectivity.log','PASS connectivity matrix=1152'],['portal-layout.log','PASS portal-layout matrix=1152']]){const log=fs.readFileSync(path.join(root,'artifacts/TASK-122',file),'utf8');assert(log.includes(marker)&&log.includes('actual_exit_status=0'))}
console.log('PASS archived graph-audit sources geometry=byte-identical palette-only-change=true required_parent_exits=0');
const native=read('artifacts/TASK-126/native-maps.json'),projected=new Map(read('artifacts/TASK-126/maps.json').map(r=>[r.id,r.mapSnapshot]));
assert.equal(native.length,1152);assert.equal(projected.size,1152);const seen=new Set(),rows=[];
for(const {id,map} of native){
 const [,size,h,s]=/^(tiny|normal|big)-H(\d+)-seed(\d+)$/.exec(id);const count=+h,seed=+s;
 assert(count>=1&&count<=12&&seed>=0&&seed<32&&!seen.has(id));seen.add(id);
 assert.deepEqual(map,projected.get(id),'independent native/browser deterministic replay '+id);
 const side=Math.max({tiny:11,normal:15,big:21}[size],Math.ceil({tiny:15,normal:25,big:39}[size]*Math.sqrt(count/4))),n=count*{tiny:1,normal:2,big:3}[size];
 assert.deepEqual(map.mapSize,{x:side,y:side});assert.equal(map.portals.length,n);assert.equal(map.goldmines.length,n);assert.equal(map.players[0].towns.length,n);
 const archivedRow=archived.get(`${size}-humans-${count}-seed-${seed}`);assert(archivedRow);
 const {terrain,portals,metrics}=archivedRow.normal;
 assert.deepEqual(portals.portals,map.portals);assert.deepEqual(portals.starts,map.players.slice(1,count+1).map(p=>p.towns[0]));
 assert.equal(terrain.area,side*side);assert(terrain.disjoint&&terrain.inBounds&&terrain.startingNeighborhoods);
 assert.equal(terrain.connectivity.observed.length,count);
 assert(terrain.connectivity.observed.every(r=>r.length===n*3&&r.every(v=>v===true)));
 assert.equal(portals.observed.distanceMatrix.length,count);
 assert(portals.observed.distanceMatrix.every(r=>r.length===n&&r.every(d=>d>={tiny:6,normal:10,big:14}[size])));
 assert.equal(portals.observed.exits.length,n);assert(portals.observed.exits.every(r=>r.length>0));
 assert(archivedRow.elapsedMs<60000);
 for(const [kind,density] of [['mountains',.08],['lakes',.06],['bushes',.10]]){assert.equal(terrain.categories[kind].observed.count,Math.round(side*side*density));assert(terrain.categories[kind].observed.clusteredFraction>=.8)}
 for(const [kind,density] of [['mountains',.08],['lakes',.06],['bushes',.10]])assert.equal(map[kind].length,Math.round(side*side*density));
 assert.equal(metrics.length,count);
 for(const kind of ['gold','towns','units','mine','town','portal']){const a=metrics.map(r=>r[kind]);assert(Math.max(...a)-Math.min(...a)<=(['gold','towns','units'].includes(kind)?0:4))}
 assert(metrics.every(m=>m.gold===100&&m.towns===1&&m.units===1));
 const row={id,expected:{side,resources:n,distance:{tiny:6,normal:10,big:14}[size],deterministic:true},observed:{side:map.mapSize.x,resources:map.portals.length,distance:portals.observed.minimumHexDistance,deterministic:true},terrain,portals,metrics};
 rows.push(row);console.log('PASS matrix '+id+' dimensions counts density distance balance exits deterministic');
}
fs.writeFileSync(path.join(out,'matrix-audit.json'),JSON.stringify(rows)+'\n');
fs.writeFileSync(path.join(out,'matrix-identities.json'),JSON.stringify(Object.fromEntries([...sources,'artifacts/TASK-126/native-maps.json','artifacts/TASK-126/maps.json','artifacts/TASK-126/verification.log','artifacts/TASK-122/balance-repair-matrix.json','artifacts/TASK-122/source-hashes.json'].map(p=>[p,hash(p)])),null,2)+'\n');
console.log('PASS independent scaled-generation matrix=1152 presets=3 counts=12 seeds=32 dimensions counts density distance balance exits deterministic source-matched');
