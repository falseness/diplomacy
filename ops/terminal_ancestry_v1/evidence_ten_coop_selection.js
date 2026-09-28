// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Add explicitly reviewed natural criteria to the complete retained selection. This
// Projection expands directory proofs and makes the Chromium browser tier explicit;
// original coverage/plan bytes remain separately bound and semantics are recomputed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),F=require('./review_ten_coop_evidence'),H=require('../consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-107/reviewed-crosswalk.json');
const baseSha='28da249ec7b248cbcba6d5bd4bd8544c21144489fe997dfe6c13bb856130b1b2';
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
function projection(coverage){
 const result=structuredClone(coverage);assert.deepEqual(result.cases.map(c=>c.id),F.CASES,'wrong-ten-cases');
 for(const c of result.cases){
  assert.equal(c.proof,c.id,'unsupported-ten-proof-format');
  c.proof=Object.keys(coverage.evidenceHashes).filter(n=>n.startsWith(c.id+'/')).sort();
  assert(c.proof.length>0,'missing-ten-proofs');
 }
 return result;
}
function projectPlan(plan){
 const result=structuredClone(plan),browser=result.cases.find(c=>c.id==='browser');
 assert.equal(browser.tier,'shipped Chromium UI and real HTTPS/Socket.IO/MongoDB','unexpected-ten-tier');
 browser.tier='shipped Chromium browser UI and real HTTPS/Socket.IO/MongoDB';return result;
}
function prepare(tasks,original,out,criteria=F.HISTORICAL,receipt=null){
 assert(!fs.existsSync(out),'fresh-ten-projection-required');fs.mkdirSync(out,{recursive:true});
 const selected=path.join(out,'selected-217');fs.cpSync(original,selected,{recursive:true});
 const coverage=A.read(path.join(original,'coverage-results.json')),originalFiles=Object.fromEntries(files(original).map(n=>[n,A.hash(path.join(original,n))]));
 const report=F.review(original,criteria,receipt,originalFiles),save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
 fs.renameSync(path.join(selected,'coverage-results.json'),path.join(selected,'original-coverage.json'));
 fs.renameSync(path.join(selected,'verification-plan.json'),path.join(selected,'original-verification-plan.json'));
 save('verification-plan.json',projectPlan(A.read(path.join(original,'verification-plan.json'))));
 const projected=projection(coverage);projected.evidenceHashes['verification-plan.json']=A.hash(path.join(selected,'verification-plan.json'));save('coverage-results.json',projected);save('ten-independent-review.json',report);
 const manifest=Object.fromEntries(files(selected).map(n=>[n,A.hash(path.join(selected,n))]));save('evidence-hashes.json',manifest);
 const input=A.read(BASE);input.tenSelection={version:1,baseline:{file:BASE,sha256:baseSha},original,coverageSha256:A.hash(path.join(original,'coverage-results.json')),originalFiles,selected,criteria,receipt,readerSha256:A.hash(path.join(path.join(__dirname,'..'),'review_ten_coop_evidence.js'))};
 for(const n of input.tenSelection.criteria){const row=F.rowFor(tasks,report,manifest,n);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;}
 return input;
}
function preflight(tasks,input){
 return S.transaction(()=>{
 const s=input.tenSelection;assert(s?.version===1,'missing-ten-selection');assert([F.HISTORICAL,F.CURRENT].some(v=>JSON.stringify(v)===JSON.stringify(s.criteria)),'wrong-ten-owner');
 assert.deepEqual(s.baseline,{file:BASE,sha256:baseSha},'wrong-ten-baseline');assert.equal(A.hash(BASE),s.baseline.sha256,'changed-ten-baseline');
 assert.equal(A.hash(path.join(path.join(__dirname,'..'),'review_ten_coop_evidence.js')),s.readerSha256,'changed-ten-reader');
 assert(path.isAbsolute(s.original)&&path.isAbsolute(s.selected),'absolute-ten-path-required');
 const root=fs.realpathSync(path.join(A.client,'artifacts'));for(const p of [s.original,s.selected]){const relative=path.relative(root,fs.realpathSync(p));assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'escaped-ten-provider');}
 assert.equal(A.hash(path.join(s.original,'coverage-results.json')),s.coverageSha256,'wrong-ten-release');
 const base=A.read(BASE),candidate=structuredClone(input);delete candidate.tenSelection;
 const manifest=A.read(path.join(s.selected,'evidence-hashes.json'));
 assert.deepEqual(files(s.original),Object.keys(s.originalFiles).sort(),'omitted-original-ten-proof');
 for(const [n,sha] of Object.entries(s.originalFiles)){
  A.proofKey(s.original,n,s.originalFiles);
  assert.equal(manifest[n==='coverage-results.json'?'original-coverage.json':n==='verification-plan.json'?'original-verification-plan.json':n],sha,'changed-ten-projection:'+n);
 }
 assert.deepEqual(Object.keys(manifest).sort(),[...Object.keys(s.originalFiles).filter(n=>!['coverage-results.json','verification-plan.json'].includes(n)),'original-coverage.json','coverage-results.json','verification-plan.json','original-verification-plan.json','ten-independent-review.json'].sort(),'omitted-ten-manifest-row');
 for(const n of Object.keys(manifest))A.proofKey(s.selected,n,manifest);
 const projected=projection(A.read(path.join(s.original,'coverage-results.json')));projected.evidenceHashes['verification-plan.json']=A.hash(path.join(s.selected,'verification-plan.json'));assert.deepEqual(A.read(path.join(s.selected,'coverage-results.json')),projected,'wrong-ten-projection');
 assert.deepEqual(A.read(path.join(s.selected,'verification-plan.json')),projectPlan(A.read(path.join(s.original,'verification-plan.json'))),'wrong-ten-plan-projection');
 const report=F.review(s.original,s.criteria,s.receipt,s.originalFiles);assert.deepEqual(A.read(path.join(s.selected,'ten-independent-review.json')),report,'changed-ten-report');
 for(const n of s.criteria){const row=F.rowFor(tasks,report,manifest,n);assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'wrong-ten-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=base.reviews.find(r=>r.id===row.id);}
 assert.deepEqual(candidate,base,'omitted-or-changed-ten-retained-row');
 const run=A.inspectRun(tasks.find(t=>t.id==='TASK-217'),s.selected);assert(run.historicalValid,'invalid-ten-projection:'+run.issues.join(','));
 return {baseline:base,run,report};
 }).result;
}
function inventory(tasks,research,input,baselineInventory,options={}){
 const begin=Date.now(),ready=preflight(tasks,input),phases=[{name:'ten-independent-preflight',elapsedMs:Date.now()-begin}];
 options.onPhase?.('PASS ten-independent-preflight elapsedMs='+phases[0].elapsedMs);
 const baseline=baselineInventory(tasks,research,ready.baseline),candidate=structuredClone(ready.baseline);
 // Keep the same exact provider in both sides; unreviewed rows remain unresolved.
 const before=H.consume({...baseline,runs:baseline.runs.map(r=>r.task==='TASK-217'?ready.run:r)},tasks,research,candidate,[{id:'TASK-217',key:'TASK-217'}]);
 assert.deepEqual(before.criteria,baseline.criteria,'provider-alone-granted-coverage');
 assert.deepEqual(before.researchGaps,baseline.researchGaps);
 assert.deepEqual(before.selfChecks,baseline.selfChecks);
 let report=before;const transitions=[];
 for(const n of input.tenSelection.criteria){const id='TASK-217/AC'+n;candidate.reviews[candidate.reviews.findIndex(r=>r.id===id)]=input.reviews.find(r=>r.id===id);
  const next=H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-217'?ready.run:r)},tasks,research,candidate,[{id:'TASK-217',key:'TASK-217'}]);
  for(const old of [...report.criteria,...report.researchGaps].filter(r=>r.id!==id))assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-non-target:'+old.id);
  assert.deepEqual(next.selfChecks,report.selfChecks);assert.deepEqual(next.historicalAnnex,report.historicalAnnex);assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
  const target=next.criteria.find(r=>r.id===id);assert.equal(target.status,ready.run.currentSourceValid?'covered-current':'reviewed-historical','ten-disposition:'+JSON.stringify(target));
  transitions.push({id,before:report.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:target.status});report=next;
  options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));
 }
 return {report,before,transitions,phases,independent:ready.report};
}
module.exports={prepare,preflight,inventory,projection};
