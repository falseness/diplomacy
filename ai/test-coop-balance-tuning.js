'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path');
const {baseline,candidates,select,simulate,score}=require('./tune-coop-progression');
const {composeCoopWave}=require('./wave-composition');
const {valueUnit,PARAMETERS}=require('./coop-army-valuation');
function reference(c,seed,round,p) {
  const mod=4294967296n;
  let n=BigInt(seed)^(BigInt(round)*2654435761n%mod);
  for(const v of [p.x,p.y])n=((n^BigInt(v))*1664525n+1013904223n)%mod;
  const pool=Object.keys(c.types).filter(id=>c.types[id].unlockRound<=round);
  const total=pool.reduce((sum,id)=>sum+c.types[id].weight,0);let end=0;
  return pool.find(id=>{end+=c.types[id].weight;return n*BigInt(total)<BigInt(end)*mod;})||null;
}
// Independent literal v1 equation, not labels or valueUnit totals.
function value(t) {return 20+(t.health-2)*20/3+(t.damage-1)*10+(t.movement-2)*20/3+(t.range-1)*50/3;}
function close(a,b) {assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);}
async function main() {
  const base=baseline(),grid=candidates();assert.equal(grid.length,36);
  assert.deepEqual(PARAMETERS,{baseline:20,health:20/3,damage:10,movement:20/3,range:50/3,siegeRangeWeight:0.25});
  const portals=[{x:9,y:2},{x:12,y:6}],map={seed:42,portals};let comparisons=0;
  for(const c of grid) {
    assert.equal(c.types.imp.unlockRound,3);
    for(const [id,t] of Object.entries(c.types)) {
      assert.equal(t.parent,base.types[id].parent);assert.equal(t.profile,base.types[id].profile);
      assert.equal(t.salary+t.healSpeed+t.economy,0);assert.equal(t.weight,base.types[id].weight);
      assert(id==='imp'||t.unlockRound>3);
      for(const k of ['health','damage','movement','range'])assert(Number.isInteger(t[k])&&t[k]>=1);
      close(valueUnit(t).value,value(t));
    }
    for(const seed of [0,1,31,42,4294967295])for(let r=0;r<=40;r++)for(const p of portals) {
      assert.equal(select(c,seed,r,p),reference(c,seed,r,p));comparisons++;
    }
    const available=simulate(c,map,40),blocked=simulate(c,map,40,'blocked'),destroyed=simulate(c,map,40,'destroyed');
    for(let r=0;r<=40;r++) {
      assert.equal(available[r].spawns.length,r<3?0:2);
      assert.equal(blocked[r].spawns.length,r<3?0:r>=5&&r<=10?1:2);
      assert.equal(destroyed[r].spawns.length,r<3?0:r>=10?1:2);
      if(r>=11)assert.deepEqual(blocked[r].spawns,available[r].spawns,'no backlog after unblock');
      if(r<3)assert.equal(available[r].cumulative,0);
    }
    assert(available[3].spawns.every(s=>s.type==='imp'));
    close(available[40].cumulative,available.flatMap(r=>r.spawns).reduce((s,t)=>s+value(c.types[t.type]),0));
  }
  for(let r=0;r<=40;r++)assert.deepEqual(simulate(base,map,r)[r].spawns.map(s=>s.type),composeCoopWave(42,r,2,portals).types);
  const literal=score(new Map([['a',[{cumulative:999},{cumulative:999},{cumulative:999},{cumulative:28},{cumulative:84}]]]),[{id:'a',armyValueByRound:[20,20,20,40,40]}],1.4);
  close(literal.meanAbsoluteRelativeDeviation,0.5);assert.equal(literal.terms,2);
  console.log(`PASS tuning tests candidates_expected=36 observed=${grid.length} bigint_selection_comparisons=${comparisons} baseline_runtime_rounds=41`);
  console.log('PASS invariants first_spawn=3 Imp_only=true one_per_available_portal=true blocked_5_10_released_11=true destroyed_from_10=true backlog=0 economy_healing_salary=0 fixed_valuation=true');
  console.log('PASS independent score expected=0.5 observed='+literal.meanAbsoluteRelativeDeviation+' terms=2 opening_excluded=true cumulative_losses_subtracted=false');
  const i=process.argv.indexOf('--audit');if(i<0)return;
  const dir=process.argv[i+1],read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const maps=read('maps.json'),human=read('human-projection.json'),cs=read('candidates.json'),chosen=read('selected-config.json'),summary=read('summary.json');
  const hs=new Map(human.scenarios.map(s=>[s.id+'/'+s.policy,s]));assert.equal(maps.length,1152);assert.equal(hs.size,3456);
  let best=Infinity,bestId;
  for(const candidate of cs) {
    let sum=0,count=0;
    for(const m of maps) {
      assert.equal(m.portals.length,m.humans*({tiny:1,normal:2,big:3}[m.size]));let cumulative=0;
      for(let r=0;r<=40;r++) {
        for(const p of m.portals) {const id=reference(candidate.config,m.seed,r,p);if(id)cumulative+=value(candidate.config.types[id]);}
        if(r>=3){sum+=Math.abs(cumulative/(1.4*hs.get(m.id+'/typical').armyValueByRound[r])-1);count++;}
      }
    }
    close(sum/count,candidate.meanAbsoluteRelativeDeviation);assert.equal(count,43776);assert.equal(candidate.terms,count);
    if(sum/count<best){best=sum/count;bestId=candidate.config.id;}
  }
  assert.equal(chosen.id,bestId);assert(best<cs[0].meanAbsoluteRelativeDeviation);
  const mapIndex=new Map(maps.map(m=>[m.id,m])),seen=new Set(),totals=new Map();let curves=0;
  const lines=require('readline').createInterface({input:fs.createReadStream(path.join(dir,'curves.jsonl')),crlfDelay:Infinity});
  for await(const line of lines) {
    const s=JSON.parse(line),config=s.name==='before'?cs[0].config:chosen,m=mapIndex.get(s.id),h=hs.get(s.id+'/'+s.policy);
    const key=[s.id,s.policy,s.name,s.sensitivity].join('/');assert(!seen.has(key));seen.add(key);assert.equal(s.rows.length,41);
    let cumulative=0,count=0;
    for(let r=0;r<=40;r++) {
      const wanted=[];
      m.portals.forEach((p,i)=>{
        if(i===0&&((s.sensitivity==='blocked'&&r>=5&&r<=10)||(s.sensitivity==='destroyed'&&r>=10)))return;
        const id=reference(config,m.seed,r,p);if(id)wanted.push({...p,type:id,value:value(config.types[id])});
      });
      const row=s.rows[r];assert.equal(row.round,r);assert.equal(row.spawns.length,wanted.length);
      wanted.forEach((w,i)=>{assert.equal(row.spawns[i].type,w.type);assert.equal(row.spawns[i].x,w.x);assert.equal(row.spawns[i].y,w.y);close(row.spawns[i].value,w.value);cumulative+=w.value;count++;});
      close(row.cumulative,cumulative);assert.equal(row.count,count);assert.equal(row.human,h.armyValueByRound[r]);close(row.target,1.4*row.human);close(row.ratio,cumulative/row.human);close(row.relativeDeviation,row.ratio/1.4-1);
    }
    const sk=[s.name,s.sensitivity,s.policy,s.size].join('/');
    if(!totals.has(sk))totals.set(sk,{sum:0,n:0,ratios:Array(41).fill(0),curves:0});const t=totals.get(sk);t.curves++;
    s.rows.forEach((r,i)=>{t.ratios[i]+=r.ratio;if(i>=3){t.sum+=Math.abs(r.relativeDeviation);t.n++;}});curves++;
  }
  assert.equal(curves,20736);assert.equal(summary.length,54);
  for(const s of summary){const t=totals.get([s.name,s.sensitivity,s.policy,s.size].join('/'));assert(t);close(s.meanAbsoluteRelativeDeviation,t.sum/t.n);assert.equal(s.terms,t.n);s.meanRatios.forEach((v,r)=>close(v,t.ratios[r]/t.curves));}
  console.log(`PASS independent artifact audit maps=1152 policies=3 candidates=36 terms_per_candidate=43776 curves=${curves} round_records=${curves*41} summary_rows=54 selected=${bestId} all_values_ratios_counts=matched`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
