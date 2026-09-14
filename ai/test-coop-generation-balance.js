const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const {createFixture}=require('./test-coop-harness');
const {evaluateBalance,balanced}=require('./test-coop-balance-evaluator');
const {audit,neighbours}=require('./test-coop-terrain-audit');
const {check}=require('./test-coop-portal-layout');
const index=process.argv.indexOf('--output-dir');
const out=path.resolve(index<0?'artifacts/TASK-122':process.argv[index+1]);
fs.mkdirSync(out,{recursive:true});
const f=createFixture(undefined,()=>{}), rows=[];
f.evaluate('globalThis.originalEnforce=enforceCoopStartBalance; enforceCoopStartBalance=function(...args){const result=originalEnforce(...args);globalThis.lastRepair=result;return result};undefined');
assert.deepEqual(f.evaluate('COOP_START_BALANCE'),{assetDisparity:0,pathDisparity:4});
function verify(map,size,count,label) {
  const side=Math.max({tiny:11,normal:15,big:21}[size],Math.ceil({tiny:15,normal:25,big:39}[size]*Math.sqrt(count/4)));
  assert.deepEqual(map.mapSize,{x:side,y:side});
  const metrics=evaluateBalance(map);
  assert(balanced(metrics),label+' independent balance');
  assert.equal(map.goldmines.length,count*{tiny:1,normal:2,big:3}[size]);
  assert.equal(map.players[0].towns.length,count*{tiny:1,normal:2,big:3}[size]);
  assert(map.goldmines.every(m=>m.owner===0&&m.income===20));
  const counts={expected:{humanTowns:count,neutralTowns:count*{tiny:1,normal:2,big:3}[size],goldmines:count*{tiny:1,normal:2,big:3}[size],portals:count*{tiny:1,normal:2,big:3}[size]},observed:{humanTowns:map.players.slice(1,count+1).reduce((n,p)=>n+p.towns.length,0),neutralTowns:map.players[0].towns.length,goldmines:map.goldmines.length,portals:map.portals.length}};
  assert.deepEqual(counts.observed,counts.expected,label+' exact scaled counts');
  return {counts,metrics,terrain:audit(map,label),portals:check(map,size,count)};
}
for(const size of ['tiny','normal','big']) for(let count=1;count<=12;count++) for(let seed=0;seed<32;seed++) {
  const scenario=`${size}-humans-${count}-seed-${seed}`, start=Date.now();
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}})`);
  const generationRepair=f.evaluate('lastRepair');
  assert(generationRepair.iterations>0&&generationRepair.iterations<=8);
  const original=f.evaluate('JSON.parse(JSON.stringify(generated))');
  assert(original.players.slice(1,count+1).every(p=>p.gold===100&&p.towns.length===1&&p.units.length===0));
  const normal=verify(original,size,count,scenario);
  let forcedMetrics=null,repair={iterations:0,iterationLimit:8},connectivity=null;
  if(seed===0) {
    // Force the actual balance fallback even when a normal map is already balanced.
    repair=f.evaluate('enforceCoopStartBalance(generated,true)');
    const forced=f.evaluate('JSON.parse(JSON.stringify(generated))');
    forcedMetrics=verify(forced,size,count,scenario+' forced');
    assert.deepEqual(forced.players,original.players);
    assert(repair.iterations>0&&repair.iterations<=8);
    // Seal a starting town, then repeat the same seeded rebuild through the
    // connectivity fallback. Normal-generation replays live in terrain/portal tests.
    f.context.broken=JSON.parse(JSON.stringify(original));
    f.context.ring=neighbours(original.players[1].towns[0]);
    f.evaluate('broken.lakes.push(...ring)');
    assert(!require('./test-coop-terrain-audit').routes(f.evaluate('broken')).flat().every(Boolean));
    connectivity=f.evaluate('repairCoopConnectivity(broken)');
    assert.equal(connectivity.strategy,'rebuild');
    assert.deepEqual(f.evaluate('broken'),forced);
  }
  const elapsedMs=Date.now()-start;
  assert(elapsedMs<60000,scenario+' 60-second case bound');
  const row={scenario,expected:{assetDisparity:0,pathDisparityAtMost:4,iterationLimit:8,timeLimitMs:60000},normal,generationRepair,forced:forcedMetrics,repair,connectivity,deterministic:seed===0,elapsedMs};
  rows.push(row);console.log(JSON.stringify(row));
}
const base=f.evaluate('JSON.parse(JSON.stringify(generated))');
for(const [name,mutate] of [
  ['unequal-assets',m=>m.players[1].gold++],
  ['impossible-dimensions',m=>m.mapSize={x:2,y:2}],
  ['impossible-fixed-targets',m=>m.players[1].towns=[{x:0,y:1000}]]
]) {
  f.context.bad=JSON.parse(JSON.stringify(base));mutate(f.context.bad);
  const before=JSON.stringify(f.context.bad),start=Date.now();
  assert.throws(()=>f.evaluate('enforceCoopStartBalance(bad,true)'),/Co-op starting balance bound cannot be satisfied/);
  assert.equal(JSON.stringify(f.context.bad),before,'failure is transactional');
  assert(Date.now()-start<60000);
  console.log(`PASS ${name} explicit_failure=true unchanged=true elapsedMs=${Date.now()-start}`);
}
const corrupt=JSON.parse(JSON.stringify(base));corrupt.players[1].gold++;
assert.equal(balanced(evaluateBalance(corrupt)),false);
console.log('PASS corruption-probe unequal-assets independently rejected');
fs.writeFileSync(path.join(out,'balance-repair-matrix.json'),JSON.stringify(rows,null,2)+'\n');
console.log('PASS balance matrix=1152 forced_balance=36 forced_connectivity=36 deterministic_repeats=36 iterationLimit=8 caseTimeLimitMs=60000 assets=equal pathDisparity<=4 solo=reachable');
