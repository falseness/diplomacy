// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Extend an explicit cumulative selection at the real inventory boundary.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),H=require('../consume_historical_catalog'),P=require('./review_fog_records');
function prepare(tasks,baselineFile,selected,criteria=[4,5,6,7,8]){
 assert(!fs.existsSync(selected),'fresh-fog-record-projection');const baseline=A.read(baselineFile);
 assert(baseline.fogSelection&&!baseline.fogRecords,'expected-retained-fog-selection');
 fs.cpSync(baseline.fogSelection.selected,selected,{recursive:true});
 const input=structuredClone(baseline),manifest=A.read(path.join(selected,'evidence-hashes.json'));
 for(const n of criteria){const report=S.transaction(()=>P.review(n,selected,manifest)).result,name='fog-ac'+n+'-review.json';fs.writeFileSync(path.join(selected,name),JSON.stringify(report,null,2)+'\n');manifest[name]=A.hash(path.join(selected,name));const row=P.rowFor(tasks,report,manifest,n);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;}
 fs.writeFileSync(path.join(selected,'evidence-hashes.json'),JSON.stringify(manifest,null,2)+'\n');
 input.fogRecords={version:1,baseline:{file:baselineFile,sha256:A.hash(baselineFile)},selected,criteria,receipt:P.RECEIPT,readerSha256:A.hash(path.join(path.join(__dirname,'..'),'review_fog_records.js'))};return input;
}
function preflight(tasks,input){return S.transaction(()=>{
 const s=input.fogRecords;assert(s?.version===1,'missing-fog-record-selection');
 assert(Array.isArray(s.criteria)&&s.criteria.length&&new Set(s.criteria).size===s.criteria.length&&s.criteria.every(n=>[4,5,6,7,8].includes(n)),'wrong-fog-record-owner');
 assert.deepEqual(s.receipt,P.RECEIPT,'wrong-fog-record-receipt');assert.equal(A.hash(path.join(path.join(__dirname,'..'),'review_fog_records.js')),s.readerSha256,'changed-fog-record-reader');
 const root=fs.realpathSync(path.join(A.client,'artifacts'));
 for(const f of [s.baseline.file,s.selected]){assert(path.isAbsolute(f),'absolute-fog-record-path');const rel=path.relative(root,fs.realpathSync(f));assert(!rel.startsWith('..')&&!path.isAbsolute(rel),'escaped-fog-record-selection');}
 assert.equal(A.hash(s.baseline.file),s.baseline.sha256,'changed-fog-record-baseline');
 const baseline=A.read(s.baseline.file);assert(baseline.fogSelection&&!baseline.fogRecords,'unsupported-fog-record-baseline');
 const manifest=A.read(path.join(s.selected,'evidence-hashes.json')),expected=structuredClone(A.read(path.join(baseline.fogSelection.selected,'evidence-hashes.json')));
 for(const n of s.criteria)expected['fog-ac'+n+'-review.json']=A.hash(path.join(s.selected,'fog-ac'+n+'-review.json'));
 assert.deepEqual(manifest,expected,'changed-fog-record-manifest');for(const n of Object.keys(manifest))A.proofKey(s.selected,n,manifest);
 const candidate=structuredClone(input);delete candidate.fogRecords;const reports=[];
 for(const n of s.criteria){const name='fog-ac'+n+'-review.json',report=P.review(n,s.selected,manifest,s.receipt);assert.deepEqual(A.read(path.join(s.selected,name)),report,'changed-fog-record-report');const row=P.rowFor(tasks,report,manifest,n);assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'wrong-fog-record-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=baseline.reviews.find(r=>r.id===row.id);reports.push(report);}
 assert.deepEqual(candidate,baseline,'changed-fog-record-retained-selection');
 return {baseline,reports};
}).result;}
function inventory(tasks,research,input,previous,options={}){
 const start=Date.now(),ready=preflight(tasks,input),phases=[{name:'fog-records-preflight',elapsedMs:Date.now()-start}];options.onPhase?.('PASS fog-records-preflight elapsedMs='+phases[0].elapsedMs);
 const before=previous(tasks,research,ready.baseline),candidate=structuredClone(ready.baseline);
 const result=S.transaction(()=>{
 const run=A.inspectRun(tasks.find(t=>t.id==='TASK-212'),input.fogRecords.selected);assert(run.historicalValid,'invalid-fog-record-projection:'+run.issues.join(','));
 let report=before;const transitions=[];
 for(const n of input.fogRecords.criteria){const id='TASK-212/AC'+n;candidate.reviews[candidate.reviews.findIndex(r=>r.id===id)]=input.reviews.find(r=>r.id===id);
  const next=H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-212'?run:r)},tasks,research,candidate,[{id:'TASK-212',key:'TASK-212'}]);
  for(const old of [...report.criteria,...report.researchGaps].filter(r=>r.id!==id))assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-other-fog-record-target:'+old.id);
  assert.deepEqual(next.selfChecks,report.selfChecks);assert.deepEqual(next.historicalAnnex,report.historicalAnnex);assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
  const target=next.criteria.find(r=>r.id===id);assert.equal(target.status,run.currentSourceValid?'covered-current':'reviewed-historical','wrong-fog-record-disposition');
  transitions.push({id,before:report.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:target.status});options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));report=next;
 }return {report,transitions};
 }).result;
 phases.push({name:'fog-records-total',elapsedMs:Date.now()-start});return {...result,before,reports:ready.reports,phases};
}
module.exports={prepare,preflight,inventory};
