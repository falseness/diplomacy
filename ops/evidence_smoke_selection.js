'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'),R=require('./review_smoke_capture'),H=require('./consume_historical_catalog');
const BASE='/root/diplomacy/artifacts/TASK-225/review-127/historical-selection.json';
const toolHashes=()=>Object.fromEntries(['smoke_capture_provider.js','smoke_capture_policy.json','review_smoke_capture.js','evidence_smoke_selection.js','evidence_smoke_gate.js','run_smoke_capture_review.js'].map(n=>[n,A.hash(path.join(__dirname,n))]));
function prepare(tasks,dir,receipt){
 const originalFiles=F.manifest(dir),report=R.review(dir,receipt,originalFiles);
 assert(!fs.existsSync(path.join(dir,'smoke-review.json')),'fresh additive review');
 fs.writeFileSync(path.join(dir,'smoke-review.json'),JSON.stringify(report,null,2)+'\n');
 const manifest=F.manifest(dir);delete manifest['evidence-hashes.json'];
 assert(!fs.existsSync(path.join(dir,'evidence-hashes.json')),'fresh additive manifest');
 fs.writeFileSync(path.join(dir,'evidence-hashes.json'),JSON.stringify(manifest,null,2)+'\n');
 return {directory:dir,originalFiles,manifest,receipt,report,rows:[1,2,3].map(n=>R.rowFor(tasks,n,report,manifest)),toolHashes:toolHashes()};
}
function preflight(tasks,input){
 const base=fs.realpathSync('/root/diplomacy/artifacts/TASK-225'),dir=fs.realpathSync(input.directory),rel=path.relative(base,dir);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'contained supplemental proof');
 assert.deepEqual(input.toolHashes,toolHashes(),'smoke tool binding');
 const actual=F.manifest(dir);delete actual['evidence-hashes.json'];assert.deepEqual(actual,input.manifest,'smoke complete proof binding');
 for(const [n,h]of Object.entries(input.originalFiles))assert.equal(actual[n],h,'original provider bytes unchanged');
 assert.deepEqual(A.read(path.join(dir,'evidence-hashes.json')),actual,'smoke manifest binding');
 const report=R.review(dir,input.receipt,input.originalFiles);assert.deepEqual(report,input.report,'smoke recomputed review');assert.deepEqual(A.read(path.join(dir,'smoke-review.json')),report,'smoke stored review');
 assert.deepEqual(input.rows,[1,2,3].map(n=>R.rowFor(tasks,n,report,actual)),'smoke complete rows');
 const run=A.inspectRun({id:'TASK-223-SMOKE'},dir);assert(run.historicalValid&&run.currentSourceValid,'smoke fresh archive: '+run.issues.join(','));return {run,report};
}
function consume(tasks,research,input,baseline){
 const {run}=preflight(tasks,input),candidate=A.read(BASE),withRun={...baseline,runs:[...baseline.runs,run]},transitions=[];
 // H only recomputes rows bound to this supplemental provider. Earlier reviews
 // and all eight self owners are inherited from the freshly executed gate.
 let before=H.consume(withRun,tasks,research,candidate,[{key:'TASK-223-SMOKE',id:'TASK-223'}]);
 assert.deepEqual(before.criteria,baseline.criteria,'provider alone changed criteria');
 const absent=before;
 for(const row of input.rows){
  candidate.reviews[candidate.reviews.findIndex(r=>r.id===row.id)]=row;
  const after=H.consume(withRun,tasks,research,candidate,[{key:'TASK-223-SMOKE',id:'TASK-223'}]);
  for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!==row.id))assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'changed non-target '+old.id);
  assert.deepEqual(after.selfChecks,before.selfChecks,'eight self owners');assert.equal(after.selfChecks.length,8);
  const target=after.criteria.find(r=>r.id===row.id);assert.equal(target.status,'covered-current','actual smoke whole-row consumption');
  transitions.push({id:row.id,beforeStatus:before.criteria.find(r=>r.id===row.id).status,status:target.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length});before=after;
 }
 return {before:absent,after:before,transitions};
}
module.exports={prepare,preflight,consume,toolHashes};
