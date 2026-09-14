const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const {createFixture}=require('./test-coop-harness');
const {evaluateBalance,balanced}=require('./test-coop-balance-evaluator');
const {audit,neighbours}=require('./test-coop-terrain-audit');
const {check}=require('./test-coop-portal-layout');
const {expectedMap}=require('./test-coop-generation-fixtures');
const index=process.argv.indexOf('--output-dir');
const out=path.resolve(index<0?'artifacts/TASK-086':process.argv[index+1]);
fs.mkdirSync(out,{recursive:true});
const f=createFixture(undefined,()=>{}), rows=[];
assert.deepEqual(f.evaluate('COOP_START_BALANCE'),{assetDisparity:0,pathDisparity:4});
function verify(map,size,count,label) {
  assert.deepEqual(map.mapSize,{x:{tiny:15,normal:25,big:39}[size],y:{tiny:15,normal:25,big:39}[size]});
  const metrics=evaluateBalance(map);
  assert(balanced(metrics),label+' independent balance');
  assert.equal(map.goldmines.length,count);
  assert(map.goldmines.every(m=>m.owner===0&&m.income===20));
  return {metrics,terrain:audit(map,label),portals:check(map,size,count)};
}
for(const size of ['tiny','normal','big']) for(let count=1;count<=4;count++) for(let seed=0;seed<32;seed++) {
  const scenario=`${size}-humans-${count}-seed-${seed}`, start=Date.now();
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}})`);
  const original=f.evaluate('JSON.parse(JSON.stringify(generated))');
  assert.deepEqual(original.players,expectedMap(count,seed,size).players);
  const normal=verify(original,size,count,scenario);
  // Force the actual balance fallback even when a normal map is already balanced.
  const repair=f.evaluate('enforceCoopStartBalance(generated,true)');
  const forced=f.evaluate('JSON.parse(JSON.stringify(generated))');
  const forcedMetrics=verify(forced,size,count,scenario+' forced');
  assert.deepEqual(forced.players,original.players);
  assert(repair.iterations>0&&repair.iterations<=8);
  // Seal a starting town, then repeat the same seeded rebuild through the
  // connectivity fallback. Normal-generation replays live in terrain/portal tests.
  f.context.broken=JSON.parse(JSON.stringify(original));
  f.context.ring=neighbours(original.players[1].towns[0]);
  f.evaluate('broken.lakes.push(...ring)');
  assert(!require('./test-coop-terrain-audit').routes(f.evaluate('broken')).flat().every(Boolean));
  const connectivity=f.evaluate('repairCoopConnectivity(broken)');
  assert.equal(connectivity.strategy,'rebuild');
  assert.deepEqual(f.evaluate('broken'),forced);
  const elapsedMs=Date.now()-start;
  assert(elapsedMs<15000,scenario+' 15-second case bound');
  const row={scenario,expected:{assetDisparity:0,pathDisparityAtMost:4,iterationLimit:8,timeLimitMs:15000},normal,forced:forcedMetrics,repair,connectivity,deterministic:true,elapsedMs};
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
  assert(Date.now()-start<15000);
  console.log(`PASS ${name} explicit_failure=true unchanged=true elapsedMs=${Date.now()-start}`);
}
const corrupt=JSON.parse(JSON.stringify(base));corrupt.players[1].gold++;
assert.equal(balanced(evaluateBalance(corrupt)),false);
console.log('PASS corruption-probe unequal-assets independently rejected');
fs.writeFileSync(path.join(out,'balance-repair-matrix.json'),JSON.stringify(rows,null,2)+'\n');
console.log('PASS balance matrix=384 forced_balance=384 forced_connectivity=384 deterministic_repeats=384 iterationLimit=8 caseTimeLimitMs=15000 assets=equal pathDisparity<=4 solo=reachable');
