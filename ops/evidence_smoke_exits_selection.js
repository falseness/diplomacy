'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'),T=require('./review_smoke_exits'),H=require('./consume_historical_catalog');
const BASE='/root/diplomacy/artifacts/TASK-225/review-127/historical-selection.json';
const toolHashes=()=>Object.fromEntries(['review_smoke_exits.js','review_smoke_bounds.js','smoke_exits_policy.json','evidence_smoke_exits_selection.js','evidence_smoke_exits_gate.js'].map(n=>[n,A.hash(path.join(__dirname,n))]));
function prepare(tasks,original,out,receipt){
 assert(!fs.existsSync(out),'fresh exit-provenance projection');const originalFiles=F.manifest(original),report=T.review(original,receipt,originalFiles);
 fs.cpSync(original,out,{recursive:true});fs.writeFileSync(path.join(out,'smoke-exits-review.json'),JSON.stringify(report,null,2)+'\n');
 const manifest=F.manifest(out);delete manifest['evidence-hashes.json'];fs.writeFileSync(path.join(out,'evidence-hashes.json'),JSON.stringify(manifest,null,2)+'\n');
 return {original,selected:out,originalFiles,manifest,receipt,report,row:T.rowFor(tasks,report,manifest),toolHashes:toolHashes()};
}
function preflight(tasks,input){
 assert.deepEqual(input.toolHashes,toolHashes(),'exit-provenance tool binding');
 for(const d of [input.original,input.selected]){const rel=path.relative(fs.realpathSync('/root/diplomacy/artifacts/TASK-225'),fs.realpathSync(d));assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'contained exit-provenance proof');}
 assert.deepEqual(F.manifest(input.original),input.originalFiles,'original smoke proof binding');
 const report=T.review(input.original,input.receipt,input.originalFiles);assert.deepEqual(report,input.report,'recomputed exit-provenance report');
 assert.deepEqual(A.read(path.join(input.selected,'smoke-exits-review.json')),report,'saved exit-provenance report');
 const manifest={...input.originalFiles,'smoke-exits-review.json':A.hash(path.join(input.selected,'smoke-exits-review.json'))};delete manifest['evidence-hashes.json'];
 assert.deepEqual(input.manifest,manifest,'exact exit-provenance projection');assert.deepEqual(A.read(path.join(input.selected,'evidence-hashes.json')),manifest,'exit-provenance manifest');
 for(const n of Object.keys(manifest))A.proofKey(input.selected,n,manifest);
 assert.deepEqual(input.row,T.rowFor(tasks,report,manifest),'whole exit-provenance row');
 const run=A.inspectRun({id:'TASK-223-EXITS'},input.selected);assert(run.currentSourceValid&&run.historicalValid,'current exit-provenance archive '+run.issues);return {run,report};
}
function consume(tasks,research,input,baseline){
 const {run}=preflight(tasks,input),candidate=A.read(BASE),withRun={...baseline,runs:[...baseline.runs,run]};
 const aliases=[{key:'TASK-223-EXITS',id:'TASK-223'}];
 const before=H.consume(withRun,tasks,research,candidate,aliases);assert.deepEqual(before.criteria,baseline.criteria,'exit-provenance provider alone changed criteria');
 candidate.reviews[candidate.reviews.findIndex(r=>r.id===input.row.id)]=input.row;
 const after=H.consume(withRun,tasks,research,candidate,aliases);
 for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!==input.row.id))assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'exit-provenance changed non-target '+old.id);
 assert.deepEqual(after.selfChecks,before.selfChecks);assert.equal(after.selfChecks.length,8);
 const target=after.criteria.find(r=>r.id===input.row.id);assert.equal(target.status,'covered-current','actual complete exit-provenance consumption');
 return {before,after,transition:{id:target.id,beforeStatus:before.criteria.find(r=>r.id===target.id).status,status:target.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length}};
}
module.exports={prepare,preflight,consume,toolHashes};
