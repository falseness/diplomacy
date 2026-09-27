'use strict';
// Add explicitly reviewed fog criteria to the complete retained selection. This
// projection changes only proof syntax; original bytes remain separately bound.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),F=require('./review_fog_visibility'),H=require('./consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-75/reviewed-crosswalk.json');
const baseSha='2365379923257088162afe846d96b4cf3032a77a922580f12b160e8cba049c22';
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
function projection(coverage){const result=structuredClone(coverage);assert.deepEqual(result.cases.map(c=>c.id),F.CASES,'wrong-fog-case-selection');for(const c of result.cases){assert(!c.proof&&!c.proofs,'unexpected-fog-proof-format');c.proofs=['visibility-checkpoints.json','checkpoints.json'];if(F.BROWSER.includes(c.id))c.proofs.push(c.id+'/network-traces.jsonl',c.id+'/input-trace.jsonl');}return result;}
function prepare(tasks,original,out){
 assert(!fs.existsSync(out),'fresh-fog-projection-required');fs.mkdirSync(out,{recursive:true});
 const selected=path.join(out,'selected-212');fs.cpSync(original,selected,{recursive:true});
 const coverage=A.read(path.join(original,'coverage-results.json')),originalFiles=Object.fromEntries(files(original).map(n=>[n,A.hash(path.join(original,n))]));
 const report=F.review(original),save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
 fs.renameSync(path.join(selected,'coverage-results.json'),path.join(selected,'original-coverage.json'));
 save('coverage-results.json',projection(coverage));save('fog-independent-review.json',report);
 const manifest=Object.fromEntries(files(selected).map(n=>[n,A.hash(path.join(selected,n))]));save('evidence-hashes.json',manifest);
 const input=A.read(BASE);input.fogSelection={version:1,baseline:{file:BASE,sha256:baseSha},original,coverageSha256:A.hash(path.join(original,'coverage-results.json')),originalFiles,selected,criteria:[1,2,3],readerSha256:A.hash(path.join(__dirname,'review_fog_visibility.js'))};
 for(const n of input.fogSelection.criteria){const row=F.rowFor(tasks,report,manifest,n);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;}
 return input;
}
function preflight(tasks,input){
 return S.transaction(()=>{
 const s=input.fogSelection;assert(s?.version===1,'missing-fog-selection');assert.deepEqual(s.criteria,[1,2,3],'wrong-fog-owner');
 assert.deepEqual(s.baseline,{file:BASE,sha256:baseSha},'wrong-fog-baseline');assert.equal(A.hash(BASE),s.baseline.sha256,'changed-fog-baseline');
 assert.equal(A.hash(path.join(__dirname,'review_fog_visibility.js')),s.readerSha256,'changed-fog-reader');
 assert(path.isAbsolute(s.original)&&path.isAbsolute(s.selected),'absolute-fog-path-required');
 const root=fs.realpathSync(path.join(A.client,'artifacts')),relative=path.relative(root,fs.realpathSync(s.original));
 assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'escaped-fog-provider');
 assert.equal(A.hash(path.join(s.original,'coverage-results.json')),s.coverageSha256,'wrong-fog-release');
 const base=A.read(BASE),candidate=structuredClone(input);delete candidate.fogSelection;
 const manifest=A.read(path.join(s.selected,'evidence-hashes.json'));
 assert.deepEqual(files(s.original),Object.keys(s.originalFiles).sort(),'omitted-original-fog-proof');
 for(const [n,sha] of Object.entries(s.originalFiles)){
  A.proofKey(s.original,n,s.originalFiles);
  assert.equal(manifest[n==='coverage-results.json'?'original-coverage.json':n],sha,'changed-fog-projection:'+n);
 }
 assert.deepEqual(Object.keys(manifest).sort(),[...Object.keys(s.originalFiles).filter(n=>n!=='coverage-results.json'),'original-coverage.json','coverage-results.json','fog-independent-review.json'].sort(),'omitted-fog-manifest-row');
 for(const n of Object.keys(manifest))A.proofKey(s.selected,n,manifest);
 assert.deepEqual(A.read(path.join(s.selected,'coverage-results.json')),projection(A.read(path.join(s.original,'coverage-results.json'))),'wrong-fog-projection');
 const report=F.review(s.original);assert.deepEqual(A.read(path.join(s.selected,'fog-independent-review.json')),report,'changed-fog-report');
 for(const n of s.criteria){const row=F.rowFor(tasks,report,manifest,n);assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'wrong-fog-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=base.reviews.find(r=>r.id===row.id);}
 assert.deepEqual(candidate,base,'omitted-or-changed-fog-retained-row');
 const run=A.inspectRun(tasks.find(t=>t.id==='TASK-212'),s.selected);assert(run.historicalValid,'invalid-fog-projection:'+run.issues.join(','));
 return {baseline:base,run,report};
 }).result;
}
function inventory(tasks,research,input,baselineInventory,options={}){
 const begin=Date.now(),ready=preflight(tasks,input),phases=[{name:'fog-independent-preflight',elapsedMs:Date.now()-begin}];
 options.onPhase?.('PASS fog-independent-preflight elapsedMs='+phases[0].elapsedMs);
 const before=baselineInventory(tasks,research,ready.baseline),candidate=structuredClone(ready.baseline);let report=before;const transitions=[];
 for(const n of input.fogSelection.criteria){const id='TASK-212/AC'+n;candidate.reviews[candidate.reviews.findIndex(r=>r.id===id)]=input.reviews.find(r=>r.id===id);
  const next=H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-212'?ready.run:r)},tasks,research,candidate,[{id:'TASK-212',key:'TASK-212'}]);
  for(const old of [...report.criteria,...report.researchGaps].filter(r=>r.id!==id))assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-non-target:'+old.id);
  assert.deepEqual(next.selfChecks,report.selfChecks);assert.deepEqual(next.historicalAnnex,report.historicalAnnex);assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
  const target=next.criteria.find(r=>r.id===id);assert.equal(target.status,ready.run.currentSourceValid?'covered-current':'reviewed-historical','fog-disposition:'+JSON.stringify(target));
  transitions.push({id,before:report.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:target.status});report=next;
  options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));
 }
 return {report,before,transitions,phases,independent:ready.report};
}
module.exports={prepare,preflight,inventory,projection};
