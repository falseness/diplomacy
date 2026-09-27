'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),F=require('./review_matrix_evidence');
const original=path.join(A.client,'artifacts/TASK-214/green-20260925T025827Z');
function changed(file,mutate,pattern){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-reader-'));try{fs.cpSync(original,dir,{recursive:true});const value=A.read(path.join(dir,file));mutate(value);fs.writeFileSync(path.join(dir,file),JSON.stringify(value));const coverage=A.read(path.join(dir,'coverage-results.json'));coverage.evidenceHashes[file]=A.hash(path.join(dir,file));fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(coverage));assert.throws(()=>F.review(dir),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('historical complete AC1/7 independently derived, no numeric scale claim',()=>{const r=F.review(original);assert.equal(r.checks.length,196);assert.deepEqual(r.criteria,[1,7]);});
for(const [id,file,mutate,pattern] of [
 ['wrong seed','verification-plan.json',v=>v.cases[0].seed=2,/matrix\/chromium-coop-desktop\/plan/],
 ['wrong engine','verification-plan.json',v=>v.cases[1].engine='chromium',/matrix\/firefox-competitive-desktop\/plan/],
 ['wrong mode','verification-plan.json',v=>v.cases[0].coop=false,/matrix\/chromium-coop-desktop\/plan/],
 ['wrong humans','verification-plan.json',v=>v.cases[0].humans=4,/matrix\/chromium-coop-desktop\/plan/],
 ['wrong fixture','chromium-coop-desktop/declared-fixture.json',v=>v.spec.seed=2,/matrix\/chromium-coop-desktop\/fixture/],
 ['wrong actual fixture mode','chromium-coop-desktop/declared-fixture.json',v=>v.b.gameSettings.coop=null,/matrix\/chromium-coop-desktop\/fixture-mode/],
 ['wrong actual participants','checkpoints.json',v=>{const r=v.checkpoints.find(c=>c.id==='chromium-coop-desktop/participants');r.expected=r.observed=1;},/matrix\/chromium-coop-desktop\/participants/],
 ['wrong viewport','checkpoints.json',v=>{const r=v.checkpoints.find(c=>c.id==='webkit-coop-mobile/portrait');r.expected=r.observed=[844,390];},/matrix\/webkit-coop-mobile\/portrait/],
 ['omitted case','coverage-results.json',v=>v.cases.pop(),/matrix\/case-ids/],
 ['duplicate checkpoint','checkpoints.json',v=>v.checkpoints.push(v.checkpoints.find(c=>c.id==='chromium-coop-desktop/participants')),/duplicate-matrix-checkpoint/]
])test(id+' after hash rebinding',()=>changed(file,mutate,pattern));
test('complete historical rows pass real disposition with bounded refresh',()=>{
 const S=require('./evidence_matrix_selection'),R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
 const parent=fs.mkdtempSync(path.join(A.client,'artifacts/TASK-225/matrix-disposition-test-'));
 try{
  const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),input=S.prepare(tasks,original,path.join(parent,'prepared')),ready=S.preflight(tasks,input);
  for(const n of F.HISTORICAL){const row=input.reviews.find(r=>r.id==='TASK-214/AC'+n),target=R.targets(tasks,[]).find(t=>t.id===row.id),result=R.disposition(target,row,[ready.run],tasks);assert.equal(result.status,'reviewed-historical',JSON.stringify(result));assert.equal(result.covered,false);
   const broken=structuredClone(row);delete broken.clauses[0].followUp.budgetMs;assert.equal(R.disposition(target,broken,[ready.run],tasks).reason,'invalid-follow-up-budget');}
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
