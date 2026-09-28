// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Add explicitly reviewed matrix criteria to the complete retained selection. This
// projection changes only proof syntax; original bytes remain separately bound.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),F=require('./review_matrix_evidence_v2'),H=require('../consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-92/reviewed-crosswalk.json');
const baseSha='c4eda3d92ce47df75fbd9c9a2c4f0a0c4301cff8f0fc35128806a5388595c99d';
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
function projection(coverage){
 const result=structuredClone(coverage);assert.deepEqual(result.cases.map(c=>c.id),F.CASES,'wrong-matrix-cases');
 for(const c of result.cases){
  assert.deepEqual(c.proof,['checkpoints.json',c.id+'/network-traces.jsonl',c.id+'/screenshots/'],'unsupported-matrix-proof-format');
  const shots=Object.keys(coverage.evidenceHashes).filter(n=>n.startsWith(c.id+'/screenshots/')&&n.endsWith('.png')).sort();
  assert.equal(shots.length,c.id==='webkit-coop-mobile'?5:3,'missing-matrix-captures');
  c.proof=['checkpoints.json',c.id+'/network-traces.jsonl',...shots];
 }
 return result;
}
function prepare(tasks,original,out,criteria=F.HISTORICAL,receipt=null){
 assert(!fs.existsSync(out),'fresh-matrix-projection-required');fs.mkdirSync(out,{recursive:true});
 const selected=path.join(out,'selected-214');fs.cpSync(original,selected,{recursive:true});
 const coverage=A.read(path.join(original,'coverage-results.json')),originalFiles=Object.fromEntries(files(original).map(n=>[n,A.hash(path.join(original,n))]));
 const report=F.review(original,criteria,receipt,originalFiles),save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
 fs.renameSync(path.join(selected,'coverage-results.json'),path.join(selected,'original-coverage.json'));
 save('coverage-results.json',projection(coverage));save('matrix-independent-review.json',report);
 const manifest=Object.fromEntries(files(selected).map(n=>[n,A.hash(path.join(selected,n))]));save('evidence-hashes.json',manifest);
 const input=A.read(BASE);input.matrixSelection={version:1,baseline:{file:BASE,sha256:baseSha},original,coverageSha256:A.hash(path.join(original,'coverage-results.json')),originalFiles,selected,criteria,receipt,readerSha256:A.hash(path.join(path.join(__dirname,'..'),'review_matrix_evidence_v2.js'))};
 for(const n of input.matrixSelection.criteria){const row=F.rowFor(tasks,report,manifest,n);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;}
 return input;
}
function preflight(tasks,input){
 return S.transaction(()=>{
 const s=input.matrixSelection;assert(s?.version===1,'missing-matrix-selection');assert([F.HISTORICAL,F.CURRENT].some(v=>JSON.stringify(v)===JSON.stringify(s.criteria)),'wrong-matrix-owner');
 assert.deepEqual(s.baseline,{file:BASE,sha256:baseSha},'wrong-matrix-baseline');assert.equal(A.hash(BASE),s.baseline.sha256,'changed-matrix-baseline');
 assert.equal(A.hash(path.join(path.join(__dirname,'..'),'review_matrix_evidence_v2.js')),s.readerSha256,'changed-matrix-reader');
 assert(path.isAbsolute(s.original)&&path.isAbsolute(s.selected),'absolute-matrix-path-required');
 const root=fs.realpathSync(path.join(A.client,'artifacts'));for(const p of [s.original,s.selected]){const relative=path.relative(root,fs.realpathSync(p));assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'escaped-matrix-provider');}
 assert.equal(A.hash(path.join(s.original,'coverage-results.json')),s.coverageSha256,'wrong-matrix-release');
 const base=A.read(BASE),candidate=structuredClone(input);delete candidate.matrixSelection;
 const manifest=A.read(path.join(s.selected,'evidence-hashes.json'));
 assert.deepEqual(files(s.original),Object.keys(s.originalFiles).sort(),'omitted-original-matrix-proof');
 for(const [n,sha] of Object.entries(s.originalFiles)){
  A.proofKey(s.original,n,s.originalFiles);
  assert.equal(manifest[n==='coverage-results.json'?'original-coverage.json':n],sha,'changed-matrix-projection:'+n);
 }
 assert.deepEqual(Object.keys(manifest).sort(),[...Object.keys(s.originalFiles).filter(n=>n!=='coverage-results.json'),'original-coverage.json','coverage-results.json','matrix-independent-review.json'].sort(),'omitted-matrix-manifest-row');
 for(const n of Object.keys(manifest))A.proofKey(s.selected,n,manifest);
 assert.deepEqual(A.read(path.join(s.selected,'coverage-results.json')),projection(A.read(path.join(s.original,'coverage-results.json'))),'wrong-matrix-projection');
 const report=F.review(s.original,s.criteria,s.receipt,s.originalFiles);assert.deepEqual(A.read(path.join(s.selected,'matrix-independent-review.json')),report,'changed-matrix-report');
 for(const n of s.criteria){const row=F.rowFor(tasks,report,manifest,n);assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'wrong-matrix-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=base.reviews.find(r=>r.id===row.id);}
 assert.deepEqual(candidate,base,'omitted-or-changed-matrix-retained-row');
 const run=A.inspectRun(tasks.find(t=>t.id==='TASK-214'),s.selected);assert(run.historicalValid,'invalid-matrix-projection:'+run.issues.join(','));
 return {baseline:base,run,report};
 }).result;
}
function inventory(tasks,research,input,baselineInventory,options={}){
 const begin=Date.now(),ready=preflight(tasks,input),phases=[{name:'matrix-independent-preflight',elapsedMs:Date.now()-begin}];
 options.onPhase?.('PASS matrix-independent-preflight elapsedMs='+phases[0].elapsedMs);
 const before=baselineInventory(tasks,research,ready.baseline),candidate=structuredClone(ready.baseline);let report=before;const transitions=[];
 for(const n of input.matrixSelection.criteria){const id='TASK-214/AC'+n;candidate.reviews[candidate.reviews.findIndex(r=>r.id===id)]=input.reviews.find(r=>r.id===id);
  const next=H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-214'?ready.run:r)},tasks,research,candidate,[{id:'TASK-214',key:'TASK-214'}]);
  for(const old of [...report.criteria,...report.researchGaps].filter(r=>r.id!==id))assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-non-target:'+old.id);
  assert.deepEqual(next.selfChecks,report.selfChecks);assert.deepEqual(next.historicalAnnex,report.historicalAnnex);assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
  const target=next.criteria.find(r=>r.id===id);assert.equal(target.status,ready.run.currentSourceValid?'covered-current':'reviewed-historical','matrix-disposition:'+JSON.stringify(target));
  transitions.push({id,before:report.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:target.status});report=next;
  options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));
 }
 return {report,before,transitions,phases,independent:ready.report};
}
module.exports={prepare,preflight,inventory,projection};
