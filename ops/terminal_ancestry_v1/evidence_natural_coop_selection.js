// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Add explicitly reviewed natural criteria to the complete retained selection. This
// Projection expands directory proofs and makes the Chromium browser tier explicit;
// original coverage/plan bytes remain separately bound and semantics are recomputed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),F=require('./review_natural_coop_evidence'),H=require('../consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-98/reviewed-crosswalk.json');
const baseSha='57868aff0c9bc8e174802ff8f91522fc10920b9a8acd91cf51e8c1b72e5defbc';
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
function projection(coverage){
 const result=structuredClone(coverage);assert.deepEqual(result.cases.map(c=>c.id),F.CASES,'wrong-natural-cases');
 for(const c of result.cases){
  assert.equal(c.proof,c.id,'unsupported-natural-proof-format');
  c.proof=Object.keys(coverage.evidenceHashes).filter(n=>n.startsWith(c.id+'/')).sort();
  assert(c.proof.length>0,'missing-natural-proofs');
 }
 return result;
}
function projectPlan(plan){
 const result=structuredClone(plan),browser=result.cases.find(c=>c.id==='browser');
 assert.equal(browser.tier,'shipped Chromium UI and real HTTPS/Socket.IO/MongoDB','unexpected-natural-tier');
 browser.tier='shipped Chromium browser UI and real HTTPS/Socket.IO/MongoDB';return result;
}
function prepare(tasks,original,out,criteria=F.HISTORICAL,receipt=null){
 assert(!fs.existsSync(out),'fresh-natural-projection-required');fs.mkdirSync(out,{recursive:true});
 const selected=path.join(out,'selected-215');fs.cpSync(original,selected,{recursive:true});
 const coverage=A.read(path.join(original,'coverage-results.json')),originalFiles=Object.fromEntries(files(original).map(n=>[n,A.hash(path.join(original,n))]));
 const report=F.review(original,criteria,receipt,originalFiles),save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
 fs.renameSync(path.join(selected,'coverage-results.json'),path.join(selected,'original-coverage.json'));
 fs.renameSync(path.join(selected,'verification-plan.json'),path.join(selected,'original-verification-plan.json'));
 save('verification-plan.json',projectPlan(A.read(path.join(original,'verification-plan.json'))));
 const projected=projection(coverage);projected.evidenceHashes['verification-plan.json']=A.hash(path.join(selected,'verification-plan.json'));save('coverage-results.json',projected);save('natural-independent-review.json',report);
 const manifest=Object.fromEntries(files(selected).map(n=>[n,A.hash(path.join(selected,n))]));save('evidence-hashes.json',manifest);
 const input=A.read(BASE);input.naturalSelection={version:1,baseline:{file:BASE,sha256:baseSha},original,coverageSha256:A.hash(path.join(original,'coverage-results.json')),originalFiles,selected,criteria,receipt,readerSha256:A.hash(path.join(path.join(__dirname,'..'),'review_natural_coop_evidence.js'))};
 for(const n of input.naturalSelection.criteria){const row=F.rowFor(tasks,report,manifest,n);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;}
 return input;
}
function preflight(tasks,input){
 return S.transaction(()=>{
 const s=input.naturalSelection;assert(s?.version===1,'missing-natural-selection');assert([F.HISTORICAL,F.CURRENT].some(v=>JSON.stringify(v)===JSON.stringify(s.criteria)),'wrong-natural-owner');
 assert.deepEqual(s.baseline,{file:BASE,sha256:baseSha},'wrong-natural-baseline');assert.equal(A.hash(BASE),s.baseline.sha256,'changed-natural-baseline');
 assert.equal(A.hash(path.join(path.join(__dirname,'..'),'review_natural_coop_evidence.js')),s.readerSha256,'changed-natural-reader');
 assert(path.isAbsolute(s.original)&&path.isAbsolute(s.selected),'absolute-natural-path-required');
 const root=fs.realpathSync(path.join(A.client,'artifacts'));for(const p of [s.original,s.selected]){const relative=path.relative(root,fs.realpathSync(p));assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'escaped-natural-provider');}
 assert.equal(A.hash(path.join(s.original,'coverage-results.json')),s.coverageSha256,'wrong-natural-release');
 const base=A.read(BASE),candidate=structuredClone(input);delete candidate.naturalSelection;
 const manifest=A.read(path.join(s.selected,'evidence-hashes.json'));
 assert.deepEqual(files(s.original),Object.keys(s.originalFiles).sort(),'omitted-original-natural-proof');
 for(const [n,sha] of Object.entries(s.originalFiles)){
  A.proofKey(s.original,n,s.originalFiles);
  assert.equal(manifest[n==='coverage-results.json'?'original-coverage.json':n==='verification-plan.json'?'original-verification-plan.json':n],sha,'changed-natural-projection:'+n);
 }
 assert.deepEqual(Object.keys(manifest).sort(),[...Object.keys(s.originalFiles).filter(n=>!['coverage-results.json','verification-plan.json'].includes(n)),'original-coverage.json','coverage-results.json','verification-plan.json','original-verification-plan.json','natural-independent-review.json'].sort(),'omitted-natural-manifest-row');
 for(const n of Object.keys(manifest))A.proofKey(s.selected,n,manifest);
 const projected=projection(A.read(path.join(s.original,'coverage-results.json')));projected.evidenceHashes['verification-plan.json']=A.hash(path.join(s.selected,'verification-plan.json'));assert.deepEqual(A.read(path.join(s.selected,'coverage-results.json')),projected,'wrong-natural-projection');
 assert.deepEqual(A.read(path.join(s.selected,'verification-plan.json')),projectPlan(A.read(path.join(s.original,'verification-plan.json'))),'wrong-natural-plan-projection');
 const report=F.review(s.original,s.criteria,s.receipt,s.originalFiles);assert.deepEqual(A.read(path.join(s.selected,'natural-independent-review.json')),report,'changed-natural-report');
 for(const n of s.criteria){const row=F.rowFor(tasks,report,manifest,n);assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'wrong-natural-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=base.reviews.find(r=>r.id===row.id);}
 assert.deepEqual(candidate,base,'omitted-or-changed-natural-retained-row');
 const run=A.inspectRun(tasks.find(t=>t.id==='TASK-215'),s.selected);assert(run.historicalValid,'invalid-natural-projection:'+run.issues.join(','));
 return {baseline:base,run,report};
 }).result;
}
function inventory(tasks,research,input,baselineInventory,options={}){
 const begin=Date.now(),ready=preflight(tasks,input),phases=[{name:'natural-independent-preflight',elapsedMs:Date.now()-begin}];
 options.onPhase?.('PASS natural-independent-preflight elapsedMs='+phases[0].elapsedMs);
 const before=baselineInventory(tasks,research,ready.baseline),candidate=structuredClone(ready.baseline);let report=before;const transitions=[];
 for(const n of input.naturalSelection.criteria){const id='TASK-215/AC'+n;candidate.reviews[candidate.reviews.findIndex(r=>r.id===id)]=input.reviews.find(r=>r.id===id);
  const next=H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-215'?ready.run:r)},tasks,research,candidate,[{id:'TASK-215',key:'TASK-215'}]);
  for(const old of [...report.criteria,...report.researchGaps].filter(r=>r.id!==id))assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-non-target:'+old.id);
  assert.deepEqual(next.selfChecks,report.selfChecks);assert.deepEqual(next.historicalAnnex,report.historicalAnnex);assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
  const target=next.criteria.find(r=>r.id===id);assert.equal(target.status,ready.run.currentSourceValid?'covered-current':'reviewed-historical','natural-disposition:'+JSON.stringify(target));
  transitions.push({id,before:report.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:target.status});report=next;
  options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));
 }
 return {report,before,transitions,phases,independent:ready.report};
}
module.exports={prepare,preflight,inventory,projection};
