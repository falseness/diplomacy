'use strict';
// Add explicitly reviewed sequence criteria to the retained selection.
// The projection supplies exact file proofs for the four existing browser cases;
// original coverage/plan bytes remain separately bound and semantics are recomputed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews'),Self=require('/root/diplomacy_server/tests/reliability/helpers/evidence-self');
const S=require('./evidence_selection'),F=require('./review_sequence_criteria'),H=require('./consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-114/reviewed-crosswalk.json');
const baseSha='a1a87f070aa7a80ca45330fa40f99c759aa317b9285836bf01551e8296667802';
const toolNames=['review_sequence_criteria.js','review_sequence_evidence.js','review_sequence_lifecycle.js','review_sequence_rounds.js','review_sequence_failure.js','sequence_failure_hashes.json','evidence_sequence_selection.js','evidence_sequence_gate.js'];
const toolHashes=()=>Object.fromEntries(toolNames.map(n=>[n,A.hash(path.join(__dirname,n))]));
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
const projection=F.projection;
function projectPlan(plan){return structuredClone(plan);}
// Revalidate the immutable ancestry against the self wording it actually bound,
// then explicitly carry the same owners onto current self targets. No self pass.
function selfRows(tasks,base){
 return R.targets(tasks,[]).filter(t=>t.task==='TASK-225').map(t=>{
  const old=base.reviews.find(r=>r.id===t.id);assert(old&&old.clauses.length===1,'missing-retained-self-owner');
  const row={...structuredClone(old),targetSha256:R.digest(t.text)};row.clauses[0].text=t.text;
  Self.ownership(t,row);return row;
 });
}
function legacyTasks(tasks,base){const copy=structuredClone(tasks),self=copy.find(t=>t.id==='TASK-225');self.acceptance_criteria=self.acceptance_criteria.map((_,i)=>base.reviews.find(r=>r.id==='TASK-225/AC'+(i+1)).clauses[0].text);return copy;}
function rebindSelf(report,tasks,rows){
 const updated=R.targets(tasks,[]).filter(t=>t.task==='TASK-225').map(t=>Self.ownership(t,rows.find(r=>r.id===t.id)));
 assert.equal(updated.length,8);for(const r of updated)assert.deepEqual(r.ownership,report.selfChecks.find(c=>c.id===r.id).ownership,'changed-self-checkpoint-owner');
 const criteria=report.criteria.map(r=>updated.find(c=>c.id===r.id)||r);
 return {...report,criteria,selfChecks:updated,clauseDispositions:report.clauseDispositions.map(c=>{const r=updated.find(r=>r.id===c.target);return r?{...c,text:r.clauses[c.index].text}:c;})};
}
function prepare(tasks,original,out,criteria=F.HISTORICAL,receipt=null){
 assert(!fs.existsSync(out),'fresh-sequence-projection-required');fs.mkdirSync(out,{recursive:true});
 const selected=path.join(out,'selected-220');fs.cpSync(original,selected,{recursive:true});
 const coverage=A.read(path.join(original,'coverage-results.json')),originalFiles=Object.fromEntries(files(original).map(n=>[n,A.hash(path.join(original,n))]));
 const report=F.review(original,criteria,receipt,originalFiles),save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
 fs.renameSync(path.join(selected,'coverage-results.json'),path.join(selected,'original-coverage.json'));
 fs.renameSync(path.join(selected,'verification-plan.json'),path.join(selected,'original-verification-plan.json'));
 save('verification-plan.json',projectPlan(A.read(path.join(original,'verification-plan.json'))));
 const projected=projection(coverage);projected.evidenceHashes['verification-plan.json']=A.hash(path.join(selected,'verification-plan.json'));save('coverage-results.json',projected);save('sequence-independent-review.json',report);
 const manifest=Object.fromEntries(files(selected).map(n=>[n,A.hash(path.join(selected,n))]));save('evidence-hashes.json',manifest);
 const input=A.read(BASE);input.sequenceSelection={version:1,baseline:{file:BASE,sha256:baseSha},original,coverageSha256:A.hash(path.join(original,'coverage-results.json')),originalFiles,selected,criteria,receipt,toolHashes:toolHashes()};
 for(const row of selfRows(tasks,input))input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;
 for(const n of input.sequenceSelection.criteria){const row=F.rowFor(tasks,report,manifest,n);input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;}
 return input;
}
function preflight(tasks,input){
 return S.transaction(()=>{
 const s=input.sequenceSelection;assert(s?.version===1,'missing-sequence-selection');assert(s.criteria.length&&s.criteria.every(n=>F.CURRENT.includes(n))&&new Set(s.criteria).size===s.criteria.length,'wrong-sequence-owner');
 assert.deepEqual(s.baseline,{file:BASE,sha256:baseSha},'wrong-sequence-baseline');assert.equal(A.hash(BASE),s.baseline.sha256,'changed-sequence-baseline');
 assert.deepEqual(toolHashes(),s.toolHashes,'changed-sequence-tools');
 assert(path.isAbsolute(s.original)&&path.isAbsolute(s.selected),'absolute-sequence-path-required');
 const root=fs.realpathSync(path.join(A.client,'artifacts'));for(const p of [s.original,s.selected]){const relative=path.relative(root,fs.realpathSync(p));assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'escaped-sequence-provider');}
 assert.equal(A.hash(path.join(s.original,'coverage-results.json')),s.coverageSha256,'wrong-sequence-release');
 const base=A.read(BASE),candidate=structuredClone(input);delete candidate.sequenceSelection;
 const owned=selfRows(tasks,base);
 for(const row of owned){assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'changed-current-self-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=base.reviews.find(r=>r.id===row.id);}
 const manifest=A.read(path.join(s.selected,'evidence-hashes.json'));
 assert.deepEqual(files(s.original),Object.keys(s.originalFiles).sort(),'omitted-original-sequence-proof');
 for(const [n,sha] of Object.entries(s.originalFiles)){
  A.proofKey(s.original,n,s.originalFiles);
  assert.equal(manifest[n==='coverage-results.json'?'original-coverage.json':n==='verification-plan.json'?'original-verification-plan.json':n],sha,'changed-sequence-projection:'+n);
 }
 assert.deepEqual(Object.keys(manifest).sort(),[...Object.keys(s.originalFiles).filter(n=>!['coverage-results.json','verification-plan.json'].includes(n)),'original-coverage.json','coverage-results.json','verification-plan.json','original-verification-plan.json','sequence-independent-review.json'].sort(),'omitted-sequence-manifest-row');
 for(const n of Object.keys(manifest))A.proofKey(s.selected,n,manifest);
 const projected=projection(A.read(path.join(s.original,'coverage-results.json')));projected.evidenceHashes['verification-plan.json']=A.hash(path.join(s.selected,'verification-plan.json'));assert.deepEqual(A.read(path.join(s.selected,'coverage-results.json')),projected,'wrong-sequence-projection');
 assert.deepEqual(A.read(path.join(s.selected,'verification-plan.json')),projectPlan(A.read(path.join(s.original,'verification-plan.json'))),'wrong-sequence-plan-projection');
 const report=F.review(s.original,s.criteria,s.receipt,s.originalFiles);assert.deepEqual(A.read(path.join(s.selected,'sequence-independent-review.json')),report,'changed-sequence-report');
 for(const n of s.criteria){const row=F.rowFor(tasks,report,manifest,n);assert.deepEqual(candidate.reviews.find(r=>r.id===row.id),row,'wrong-sequence-row');candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=base.reviews.find(r=>r.id===row.id);}
 assert.deepEqual(candidate,base,'omitted-or-changed-sequence-retained-row');
 const run=A.inspectRun(tasks.find(t=>t.id==='TASK-220'),s.selected);assert(run.historicalValid,'invalid-sequence-projection:'+run.issues.join(','));
 return {baseline:base,run,report,selfRows:owned};
 }).result;
}
function inventory(tasks,research,input,baselineInventory,options={}){
 const begin=Date.now(),ready=preflight(tasks,input),phases=[{name:'sequence-independent-preflight',elapsedMs:Date.now()-begin}];
 options.onPhase?.('PASS sequence-independent-preflight elapsedMs='+phases[0].elapsedMs);
 const retained=baselineInventory(legacyTasks(tasks,ready.baseline),research,ready.baseline);
 const baseline=rebindSelf(retained,tasks,ready.selfRows),candidate=structuredClone(ready.baseline);
 for(const row of ready.selfRows)candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=row;
 // Keep the same exact provider in both sides; unreviewed rows remain unresolved.
 const before=H.consume({...baseline,runs:baseline.runs.map(r=>r.task==='TASK-220'?ready.run:r)},tasks,research,candidate,[{id:'TASK-220',key:'TASK-220'}]);
 assert.deepEqual(before.criteria,baseline.criteria,'provider-alone-granted-coverage');
 assert.deepEqual(before.researchGaps,baseline.researchGaps);
 assert.deepEqual(before.selfChecks,baseline.selfChecks);
 let report=before;const transitions=[];
 for(const row of selfRows(tasks,input))input.reviews[input.reviews.findIndex(r=>r.id===row.id)]=row;
 for(const n of input.sequenceSelection.criteria){const id='TASK-220/AC'+n;candidate.reviews[candidate.reviews.findIndex(r=>r.id===id)]=input.reviews.find(r=>r.id===id);
  const next=H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-220'?ready.run:r)},tasks,research,candidate,[{id:'TASK-220',key:'TASK-220'}]);
  for(const old of [...report.criteria,...report.researchGaps].filter(r=>r.id!==id))assert.deepEqual([...next.criteria,...next.researchGaps].find(r=>r.id===old.id),old,'changed-non-target:'+old.id);
  assert.deepEqual(next.selfChecks,report.selfChecks);assert.deepEqual(next.historicalAnnex,report.historicalAnnex);assert.deepEqual(next.inputIssues,[]);assert.deepEqual(next.unexplainedGaps,[]);
  const target=next.criteria.find(r=>r.id===id);assert.equal(target.status,ready.run.currentSourceValid?'covered-current':'reviewed-historical','sequence-disposition:'+JSON.stringify(target));
  transitions.push({id,before:report.unresolvedPriorArchives.length,after:next.unresolvedPriorArchives.length,status:target.status});report=next;
  options.onPhase?.('PASS complete criterion '+JSON.stringify(transitions.at(-1)));
 }
 return {report,before,transitions,phases,independent:ready.report};
}
module.exports={prepare,preflight,inventory,projection,selfRows,legacyTasks,rebindSelf};
