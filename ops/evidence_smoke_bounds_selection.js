'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'),T=require('./review_smoke_bounds'),H=require('./consume_historical_catalog');
const BASE='/root/diplomacy/artifacts/TASK-225/review-127/historical-selection.json';
const toolHashes=()=>Object.fromEntries(['review_smoke_bounds.js','review_smoke_tiers.js','smoke_tiers_policy.json','evidence_smoke_bounds_selection.js','evidence_smoke_bounds_gate.js'].map(n=>[n,A.hash(path.join(__dirname,n))]));
function prepare(tasks,original,out,receipt){
 assert(!fs.existsSync(out),'fresh bounded projection');const originalFiles=F.manifest(original),report=T.review(original,receipt,originalFiles);
 fs.cpSync(original,out,{recursive:true});fs.writeFileSync(path.join(out,'smoke-bounds-review.json'),JSON.stringify(report,null,2)+'\n');
 const manifest=F.manifest(out);delete manifest['evidence-hashes.json'];fs.writeFileSync(path.join(out,'evidence-hashes.json'),JSON.stringify(manifest,null,2)+'\n');
 return {original,selected:out,originalFiles,manifest,receipt,report,row:T.rowFor(tasks,report,manifest),toolHashes:toolHashes()};
}
function preflight(tasks,input){
 assert.deepEqual(input.toolHashes,toolHashes(),'bounded tool binding');
 for(const d of [input.original,input.selected]){const rel=path.relative(fs.realpathSync('/root/diplomacy/artifacts/TASK-225'),fs.realpathSync(d));assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'contained bounded proof');}
 assert.deepEqual(F.manifest(input.original),input.originalFiles,'original smoke proof binding');
 const report=T.review(input.original,input.receipt,input.originalFiles);assert.deepEqual(report,input.report,'recomputed bounded report');
 assert.deepEqual(A.read(path.join(input.selected,'smoke-bounds-review.json')),report,'saved bounded report');
 const manifest={...input.originalFiles,'smoke-bounds-review.json':A.hash(path.join(input.selected,'smoke-bounds-review.json'))};delete manifest['evidence-hashes.json'];
 assert.deepEqual(input.manifest,manifest,'exact bounded projection');assert.deepEqual(A.read(path.join(input.selected,'evidence-hashes.json')),manifest,'bounded manifest');
 for(const n of Object.keys(manifest))A.proofKey(input.selected,n,manifest);
 assert.deepEqual(input.row,T.rowFor(tasks,report,manifest),'whole bounded row');
 const run=A.inspectRun({id:'TASK-223-BOUNDS'},input.selected);assert(run.currentSourceValid&&run.historicalValid,'current bounded archive '+run.issues);return {run,report};
}
function consume(tasks,research,input,baseline){
 const {run}=preflight(tasks,input),candidate=A.read(BASE),withRun={...baseline,runs:[...baseline.runs,run]};
 const aliases=[{key:'TASK-223-BOUNDS',id:'TASK-223'}];
 const before=H.consume(withRun,tasks,research,candidate,aliases);assert.deepEqual(before.criteria,baseline.criteria,'bounded provider alone changed criteria');
 candidate.reviews[candidate.reviews.findIndex(r=>r.id===input.row.id)]=input.row;
 const after=H.consume(withRun,tasks,research,candidate,aliases);
 for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!==input.row.id))assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'bounded changed non-target '+old.id);
 assert.deepEqual(after.selfChecks,before.selfChecks);assert.equal(after.selfChecks.length,8);
 const target=after.criteria.find(r=>r.id===input.row.id);assert.equal(target.status,'covered-current','actual complete bounded consumption');
 return {before,after,transition:{id:target.id,beforeStatus:before.criteria.find(r=>r.id===target.id).status,status:target.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length}};
}
module.exports={prepare,preflight,consume,toolHashes};
