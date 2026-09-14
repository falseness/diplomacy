'use strict';
// Offline only. Runtime keeps the installed version-2 configuration and saved versions.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const assert = require('assert').strict;
const {buildReport, valueUnit} = require('./coop-army-valuation');
const {COOP_WAVE_CONFIG} = require('./wave-config');
const ROOT = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function baseline() {
  const report = buildReport();
  return {id:'baseline', scale:1, delay:0, valuationModel:report.model,
    types:Object.fromEntries(report.demons.map(d => [d.id, {
      health:d.health, damage:d.damage, movement:d.movement, range:d.range,
      profile:d.profile, parent:d.parent, salary:0, healSpeed:0, economy:0,
      ...COOP_WAVE_CONFIG.types[d.id]}]))};
}
function candidates(base = baseline()) {
  const rows = [base];
  // Exhaustive finite grid; positive integer characteristics, original profiles,
  // parents and selection weights. No fitted valuation coefficients.
  for (const scale of [0.125,0.25,0.375,0.5,0.75,1]) for (const delay of [0,4,8,12,20,32]) {
    if (scale === 1 && delay === 0) continue;
    const c = structuredClone(base); c.id=`scale-${scale}-delay-${delay}`; c.scale=scale; c.delay=delay;
    for (const [id,t] of Object.entries(c.types)) {
      for (const k of ['health','damage','movement','range']) t[k]=Math.max(1,Math.round(t[k]*scale));
      t.unlockRound = id==='imp' ? 3 : t.unlockRound+delay;
    }
    rows.push(c);
  }
  return rows;
}
function select(config, seed, round, portal) {
  const pool=Object.entries(config.types).filter(([,t])=>round>=t.unlockRound);
  const total=pool.reduce((s,[,t])=>s+t.weight,0);
  let random=(seed ^ Math.imul(round,2654435761))>>>0;
  for (const coordinate of [portal.x,portal.y]) random=(Math.imul(random ^ coordinate,1664525)+1013904223)>>>0;
  let ticket=random/4294967296*total;
  for(const [id,t] of pool) {ticket-=t.weight;if(ticket<0)return id;}
  return null;
}
function simulate(config, map, rounds, sensitivity='available') {
  const values=Object.fromEntries(Object.entries(config.types).map(([id,t])=>[id,valueUnit(t).value]));
  let cumulative=0, count=0;
  return Array.from({length:rounds+1},(_,round)=>{
    const spawns=[];
    map.portals.forEach((portal,i)=>{
      // One specific portal blocked 5..10 (then free), or destroyed from 10.
      // Current-round selection is independent; nothing queues for later.
      if(i===0 && ((sensitivity==='blocked'&&round>=5&&round<=10)||(sensitivity==='destroyed'&&round>=10)))return;
      const type=select(config,map.seed,round,portal);
      if(type) {cumulative+=values[type];count++;spawns.push({x:portal.x,y:portal.y,type,value:values[type]});}
    });
    return {round,spawns,cumulative,count};
  });
}
function score(curves, scenarios, target) {
  let sum=0,n=0;
  for(const s of scenarios) for(let r=3;r<s.armyValueByRound.length;r++) {
    sum+=Math.abs(curves.get(s.id)[r].cumulative/(target*s.armyValueByRound[r])-1);n++;
  }
  assert(n>0);return {meanAbsoluteRelativeDeviation:sum/n,terms:n};
}
function sourceCheck(dir) {
  const identity=read(path.join(dir,'projection-source-identity.json')).sha256;
  for(const [file,digest] of Object.entries(identity)) assert.equal(hash(fs.readFileSync(path.join(ROOT,file))),digest,`stale human projection source: ${file}`);
  return identity;
}
function main() {
  const args=process.argv.slice(2),get=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
  const seeds=get('--seeds','0:31').split(':').map(Number), rounds=Number(get('--rounds','40')), target=Number(get('--target-ratio','1.4'));
  assert(seeds.length===2&&seeds.every(Number.isInteger)&&seeds[0]>=0&&seeds[1]>=seeds[0]&&seeds[1]<=31);
  assert(Number.isInteger(rounds)&&rounds>=3&&rounds<=40);assert.equal(target,1.4,'agreed target');
  const out=path.resolve(get('--output-dir','artifacts/TASK-126')), input=path.resolve(get('--projection-dir',out));
  fs.mkdirSync(out,{recursive:true});
  const sources=sourceCheck(input),projection=read(path.join(input,'projection.json')),access=read(path.join(input,'access.json'));
  assert.equal(projection.targetPolicy,'typical');
  const scenarios=projection.scenarios.filter(s=>s.seed>=seeds[0]&&s.seed<=seeds[1]).map(s=>({...s,armyValueByRound:s.armyValueByRound.slice(0,rounds+1)}));
  assert.equal(scenarios.length,36*(seeds[1]-seeds[0]+1)*3);
  const keys=new Set();
  for(const s of scenarios) {
    assert(!keys.has(s.id+'/'+s.policy));keys.add(s.id+'/'+s.policy);
    assert.equal(s.armyValueByRound.length,rounds+1);assert(s.armyValueByRound.every(v=>Number.isFinite(v)&&v>0));
  }
  fs.writeFileSync(path.join(out,'human-projection.json'),JSON.stringify({...projection,scenarios})+'\n');
  console.log(`PASS prerequisite source_hashes=${Object.keys(sources).length} policies=3 target=typical`);
  // Regenerate through the native authoritative loader to bound this expanded
  // sweep. Every byte is checked against the browser projection below.
  const command=[__filename,'--native-maps',input,out];
  console.log(`CWD: ${ROOT}\nCOMMAND: ${process.execPath} ${command.join(' ')}`);
  const child=require('child_process').spawnSync(process.execPath,command,{cwd:ROOT,encoding:'utf8',maxBuffer:16*1024*1024});
  process.stdout.write(child.stdout||'');process.stderr.write(child.stderr||'');
  console.log(`NATIVE_MAP_EXIT_STATUS=${child.status}`);assert.equal(child.status,0,'native map regeneration');
  const regenerated=new Map(read(path.join(out,'native-maps.json')).map(m=>[m.id,m.map]));
  const maps=[];
  for(const a of access.filter(a=>a.seed>=seeds[0]&&a.seed<=seeds[1])) {
    const map=regenerated.get(a.id);assert(map,'regenerated map present');
    assert.equal(hash(JSON.stringify(map)),a.mapHash,'same generated map as human access');
    assert.equal(map.portals.length,a.humans*({tiny:1,normal:2,big:3}[a.size]));
    maps.push({mapSnapshot:map,id:a.id,size:a.size,humans:a.humans,seed:a.seed,mapHash:a.mapHash,portals:map.portals.map(({x,y})=>({x,y}))});
    console.log(`PASS map=${a.id} portals_expected=${map.portals.length} portals_observed=${map.portals.length} human_map_hash=matched`);
  }
  assert.equal(maps.length,36*(seeds[1]-seeds[0]+1));
  fs.writeFileSync(path.join(out,'maps.json'),JSON.stringify(maps,null,2)+'\n');
  const typical=scenarios.filter(s=>s.policy==='typical'), considered=[];let best=null;
  for(const config of candidates()) {
    const curves=new Map(maps.map(m=>[m.id,simulate(config,m,rounds)]));
    const result={config,...score(curves,typical,target)};considered.push(result);
    if(!best||result.meanAbsoluteRelativeDeviation<best.meanAbsoluteRelativeDeviation)best=result;
    console.log(`CANDIDATE ${config.id} score=${result.meanAbsoluteRelativeDeviation} terms=${result.terms}`);
  }
  const installed=considered.find(c=>c.config.scale===0.5&&c.config.delay===32);
  assert(installed,'installed version-2 candidate');
  fs.writeFileSync(path.join(out,'installed-config.json'),JSON.stringify({balanceVersion:2,...installed},null,2)+'\n');
  console.log(`PASS installed-fixed-config version=2 humans=1..12 score=${installed.meanAbsoluteRelativeDeviation} terms=${installed.terms} runtime_unchanged=true`);
  const selected={version:'fixed-demon-balance-v2-proposal',targetRatio:target,...best.config};
  fs.writeFileSync(path.join(out,'candidates.json'),JSON.stringify(considered,null,2)+'\n');
  fs.writeFileSync(path.join(out,'selected-config.json'),JSON.stringify(selected,null,2)+'\n');
  fs.writeFileSync(path.join(out,'before-after.json'),JSON.stringify({before:considered[0].config,after:selected,
    values:Object.fromEntries([['before',considered[0].config],['after',selected]].map(([k,c])=>[k,Object.fromEntries(Object.entries(c.types).map(([id,t])=>[id,valueUnit(t)]))]))},null,2)+'\n');
  const stream=fs.openSync(path.join(out,'curves.jsonl'),'w'),summary=[];
  try {
    for(const [name,config] of [['before',considered[0].config],['after',selected]]) for(const sensitivity of ['available','blocked','destroyed']) {
      const curves=new Map(maps.map(m=>[m.id,simulate(config,m,rounds,sensitivity)]));
      for(const s of scenarios) {
        const rows=curves.get(s.id).map((d,r)=>({...d,human:s.armyValueByRound[r],target:target*s.armyValueByRound[r],ratio:d.cumulative/s.armyValueByRound[r],relativeDeviation:d.cumulative/(target*s.armyValueByRound[r])-1}));
        fs.writeSync(stream,JSON.stringify({id:s.id,size:s.size,humans:s.humans,seed:s.seed,policy:s.policy,name,sensitivity,rows})+'\n');
      }
      for(const policy of ['typical','conservative','expansion']) for(const size of ['tiny','normal','big']) {
        const subset=scenarios.filter(s=>s.policy===policy&&s.size===size);
        const meanRatios=Array.from({length:rounds+1},(_,r)=>subset.reduce((sum,s)=>sum+curves.get(s.id)[r].cumulative/s.armyValueByRound[r],0)/subset.length);
        summary.push({name,sensitivity,policy,size,...score(curves,subset,target),meanRatios});
      }
    }
  } finally {fs.closeSync(stream);}
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  // Standalone SVG plot, exact underlying numbers retained in summary/curves.
  const lines=summary.filter(s=>s.policy==='typical'&&s.sensitivity==='available');
  const ymax=Math.max(1.6,...lines.flatMap(s=>s.meanRatios)),colors={tiny:'#2563eb',normal:'#159447',big:'#c2410c'};
  const points=vs=>vs.map((v,r)=>`${60+r/rounds*740},${340-v/ymax*280}`).join(' ');
  fs.writeFileSync(path.join(out,'ratios.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="470" viewBox="0 0 900 470"><rect width="900" height="470" fill="white"/><text x="60" y="25">Cumulative demon / human value — typical, mean across H1–12 and seeds</text><path d="M60 50 V340 H810" fill="none" stroke="black"/><text x="5" y="60">${ymax.toFixed(2)}</text><text x="25" y="340">0</text><text x="60" y="365">Round 0</text><text x="760" y="365">${rounds}</text><polyline points="${points(Array(rounds+1).fill(target))}" stroke="black" stroke-dasharray="3 3" fill="none"/>${lines.map(s=>`<polyline points="${points(s.meanRatios)}" stroke="${colors[s.size]}" stroke-dasharray="${s.name==='before'?'7 4':'none'}" fill="none" stroke-width="2"/>`).join('')}<text x="60" y="400">Blue Tiny; green Normal; orange Big. Dashed before; solid after; dotted target 1.4.</text><text x="60" y="430">All portals available. No combat losses subtracted. Opening rounds 0–2 ratio = 0.</text></svg>\n`);
  const table=summary.filter(s=>s.sensitivity==='available').map(s=>`| ${s.name} | ${s.policy} | ${s.size} | ${s.meanAbsoluteRelativeDeviation.toFixed(6)} | ${s.meanRatios[3].toFixed(4)} | ${s.meanRatios[rounds].toFixed(4)} |`).join('\n');
  fs.writeFileSync(path.join(out,'report.md'),`# Fixed demon tuning proposal\n\nSelected ${selected.id}; baseline score ${considered[0].meanAbsoluteRelativeDeviation}; selected score ${best.meanAbsoluteRelativeDeviation}. Exhaustive deterministic grid of ${considered.length} candidates: characteristic multipliers 0.125/0.25/0.375/0.5/0.75/1, unlock delays 0/4/8/12/20/32. Round integer stats to nearest, minimum 1; retain parent/profile and weights. Imp unlock remains 3; others shift by delay. Every full candidate and score is in candidates.json; first candidate wins ties. This bounded grid is not a global optimum.\n\nScore = mean abs(D/(1.4*H)-1), equally weighted over ${best.terms} typical map/round terms (36 size/count combinations, ${seeds[1]-seeds[0]+1} seeds, rounds 3–${rounds}). D sums every spawned unit's fixed TASK-105 v1 value from actual proposed characteristics; H is TASK-106 cumulative completed recruits plus initial army. Neither total subtracts combat losses. Human policy constants remain those of TASK-106, with access and capacity recalculated on every scaled generated map; these are arithmetic projections, not combat simulation.\n\nRounds 0–2 have zero demon value, ratio 0 and relative deviation -1 and are excluded from scoring. First eligible round 3 is Imp-only. Exactly one spawn per empty living portal; initial humans times 1/2/3 portals. Each coordinate uses the runtime unsigned LCG and original weights; unavailable portals do not accrue backlog. All settings are fixed and ignore wealth and surviving-human count. Salary/healing/economy remain zero and parent interactions are retained. Runtime retains the installed version-2 fixed configuration for all H1–12, with saved version-1 behavior preserved. The offline winner is a comparison, not an automatic balance migration; installed-config.json records its separate score. Changing global stats from arithmetic alone would invalidate saved replay progression and requires a separately versioned gameplay decision.\n\nExact matching is not claimed: no pre-round-3 spawning is allowed; round-3 output is a single integer-stat Imp per portal against humans' accumulated opening recruitment. Portal multipliers differ by size while one global stat/schedule table is chosen, and seed-dependent access and selection create additional unavoidable variation for these fixed settings. Discrete unlocks/stats and this finite search restrict matching further. Late unlocks beyond round 40 are explicitly retained, not scored as observed units.\n\ncurves.jsonl retains all before/after per-round values, ratios, individual spawns and counts for all three policies and sensitivities. Blocked sensitivity blocks the first generated portal in rounds 5–10 inclusive, releasing it at 11; destroyed removes it from round 10 permanently. Other portals remain available. These are separate from optimization, with unchanged human projections to isolate spawn availability; no combat losses are inferred. summary.json reports their separate scores and ratio series. ratios.svg charts the typical baseline and selected available cases, without clipping.\n\n| Setting | Policy | Size | Mean absolute relative deviation | Round 3 ratio | Final ratio |\n|---|---|---|---:|---:|---:|\n${table}\n`);
  const files=['ai/tune-coop-progression.js','ai/test-coop-balance-tuning.js','ai/coop-economy-projection.js',...Object.keys(buildReport().sourceHashes)];
  fs.writeFileSync(path.join(out,'source-identity.json'),JSON.stringify({sha256:Object.fromEntries([...new Set(files)].map(file=>[file,hash(fs.readFileSync(path.join(ROOT,file)))])),prerequisiteSourceHashes:sources,inputHashes:Object.fromEntries(['projection.json','access.json','projection-source-identity.json'].map(file=>[path.join(input,file),hash(fs.readFileSync(path.join(input,file)))]))},null,2)+'\n');
  console.log(`PASS tuning maps=${maps.length} candidates=${considered.length} scored_rounds=3..${rounds} terms=${best.terms} selected=${selected.id} before=${considered[0].meanAbsoluteRelativeDeviation} after=${best.meanAbsoluteRelativeDeviation}`);
}
if(require.main===module) {
  if(process.argv[2]==='--native-maps') {
    Object.assign(global,require('./coop-map-scaling'));
    require('../../diplomacy_server/server/loadGameCode');
    const vm=require('vm'), input=process.argv[3], out=process.argv[4];
    const rows=read(path.join(input,'access.json')).map(a=>{
      const map=JSON.parse(vm.runInThisContext(`JSON.stringify(generateCoopGame(${a.humans},{size:'${a.size}',seed:${a.seed}}))`));
      assert.equal(hash(JSON.stringify(map)),a.mapHash,`native/browser map ${a.id}`);
      console.log(`PASS native-browser-map ${a.id} hash=matched`);return {id:a.id,map};
    });
    fs.writeFileSync(path.join(out,'native-maps.json'),JSON.stringify(rows)+'\n');
  } else main();
}
module.exports={baseline,candidates,select,simulate,score,sourceCheck};
