'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),F=require('./review_sequence_criteria');
const original=path.resolve('artifacts/TASK-220/green-20260925-03');
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)).map(n=>e.name+'/'+n):[e.name]);
const hashes=d=>Object.fromEntries(files(d).map(n=>[n,A.hash(path.join(d,n))]));
test('whole historical criteria have unique serialized independent ownership; receipt clauses stay unresolved',()=>{
 const r=F.review(original,F.HISTORICAL,null,hashes(original));assert.deepEqual(r.criteria,[1,2,3,6,7]);assert(r.unresolved.includes('independent-parent-OS-receipt-missing'));assert(r.unresolved.includes('current-source-mismatch'));
 for(const c of JSON.parse(JSON.stringify(r)).checks)assert.deepEqual(c.observed,c.expected,c.id);
 for(const owner of r.criteria)assert(r.checks.some(c=>c.owner===owner));
 assert.throws(()=>F.review(original,[4,5,8],null,hashes(original)),/independent-parent-OS-receipt-missing/);
});
for(const [name,file,mutate,pattern] of [
 ['fog','competitive-actions-1/competitive-1-tiny-deathmatch-h2-fog-on-simultaneous/journal.json',v=>{v.find(r=>r.stage==='initial').state.fog=false;},/actual-fog/],
 ['minimum-map','competitive-actions-0/case-manifest.json',v=>{v.cases[0].size.y=11;},/minimum-map/],
 ['inventory','competitive-actions-0/inventory.json',v=>{v.inventory.pop();},/inventory/],
 ['completed-actions','coop-actions-0/checkpoints.json',v=>{const c=v.checkpoints.find(r=>r.id==='coop:twelve-legal-actions');c.expected=c.observed=11;},/completed-actions/]
])test('criterion reader rejects hash-rebound '+name,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-criterion-'));
 try{fs.cpSync(original,dir,{recursive:true});const p=path.join(dir,file),v=A.read(p);mutate(v);fs.writeFileSync(p,JSON.stringify(v));const cov=A.read(path.join(dir,'coverage-results.json'));cov.evidenceHashes[file]=A.hash(p);fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(cov));assert.throws(()=>F.review(dir,F.HISTORICAL,null,hashes(dir)),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('current self wording is rebound without changing checkpoint owners or granting completion',()=>{
 const S=require('./evidence_sequence_selection'),Self=require('/root/diplomacy_server/tests/reliability/helpers/evidence-self'),R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
 const tasks=A.read('artifacts/tasks.json'),base=A.read('artifacts/TASK-225/review-114/reviewed-crosswalk.json'),rows=S.selfRows(tasks,base);
 const legacy=S.legacyTasks(tasks,base),old=R.targets(legacy,[]).filter(t=>t.task==='TASK-225').map(t=>Self.ownership(t,base.reviews.find(r=>r.id===t.id)));
 const report={selfChecks:old,criteria:old,clauseDispositions:old.map(r=>({target:r.id,index:0,text:r.text}))};
 const result=S.rebindSelf(report,tasks,rows);assert.equal(result.selfChecks.length,8);
 for(const r of result.selfChecks){assert.equal(r.status,'awaiting-current-invocation');assert.equal(r.covered,false);assert.deepEqual(r.ownership,old.find(c=>c.id===r.id).ownership);}
 assert.equal(result.selfChecks[0].text,tasks.find(t=>t.id==='TASK-225').acceptance_criteria[0]);
 const broken=structuredClone(base);broken.reviews.find(r=>r.id==='TASK-225/AC1').clauses[0].checkpointIds.pop();assert.throws(()=>S.selfRows(tasks,broken),/invalid-self-ownership/);
});
