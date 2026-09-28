'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_terminal_outcomes_v2'),T=require('./review_terminal_tiers'),H=require('./consume_historical_catalog');
const BASE='/root/diplomacy/artifacts/TASK-225/review-127/historical-selection.json';
const key='TASK-221-AC6';
const toolHashes=()=>({...require('./historical_source_binding').toolIdentities(),...Object.fromEntries([
 'review_terminal_tiers.js','terminal_ac6_policy.json','review_terminal_outcomes_v2.js','review_terminal_ac2_v2.js',
 'review_terminal_ac2_join.js','review_terminal_semantics.js','review_terminal_boundary.js','review_terminal_ac3_v2.js',
 'evidence_terminal_ac6_selection.js','evidence_terminal_ac6_gate.js',
 'evidence_terminal_ac1_current_selection_v2.js','evidence_terminal_ac1_current_gate_v2.js'
].map(n=>[n,A.hash(path.join(__dirname,n))]))});
function prepare(tasks,original,out,receipt) {
 assert(!fs.existsSync(out),'fresh AC6 projection');
 const bound=F.manifest(original),report=T.review(original,receipt,bound);
 fs.cpSync(original,out,{recursive:true});
 const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
 save('terminal-tier-review.json',report);
 const manifest=F.manifest(out);delete manifest['evidence-hashes.json'];save('evidence-hashes.json',manifest);
 return {original,selected:out,originalFiles:bound,receipt,baseline:{file:BASE,sha256:A.hash(BASE)},
  row:T.rowFor(tasks,report,manifest),report,toolHashes:toolHashes()};
}
function preflight(tasks,input) {
 assert.deepEqual(input.toolHashes,toolHashes(),'AC6 reader tool binding');
 assert.deepEqual(input.baseline,{file:BASE,sha256:A.hash(BASE)},'AC6 ancestry binding');
 for(const dir of [input.original,input.selected]) {
  const rel=path.relative(fs.realpathSync('/root/diplomacy/artifacts'),fs.realpathSync(dir));
  assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'AC6 contained proof');
 }
 assert.deepEqual(F.manifest(input.original),input.originalFiles,'AC6 changed original');
 const report=T.review(input.original,input.receipt,input.originalFiles);
 assert.deepEqual(report,input.report,'AC6 recomputed report');
 assert.deepEqual(A.read(path.join(input.selected,'terminal-tier-review.json')),report,'AC6 selected report');
 const manifest=A.read(path.join(input.selected,'evidence-hashes.json'));
 const expected={...input.originalFiles,'terminal-tier-review.json':A.hash(path.join(input.selected,'terminal-tier-review.json'))};
 delete expected['evidence-hashes.json'];assert.deepEqual(manifest,expected,'AC6 exact projection');
 for(const n of Object.keys(manifest))A.proofKey(input.selected,n,manifest);
 assert.deepEqual(input.row,T.rowFor(tasks,report,manifest),'AC6 complete row');
 const run=A.inspectRun({id:key},input.selected);assert(run.historicalValid,'AC6 valid archive');
 return {run,report};
}
function consume(tasks,research,input,baseline,retained) {
 const {run,report}=preflight(tasks,input),candidate=A.read(BASE);
 for(const self of baseline.selfChecks) {
  const old=candidate.reviews.find(r=>r.id===self.id);
  old.targetSha256=R.digest(tasks.find(t=>t.id==='TASK-225').acceptance_criteria[Number(self.id.split('AC')[1])-1]);
 }
 for(const [n,k] of [[1,'ac1Selection'],[2,'ac2Selection'],[3,'ac3Selection']])
  candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC'+n)]=retained[k].row;
 const aliases=[1,2,3,6].map(n=>({key:'TASK-221-AC'+n,id:'TASK-221'}));
 const withRun={...baseline,runs:[...baseline.runs,run]};
 const before=H.consume(withRun,tasks,research,candidate,aliases);
 assert.deepEqual(before.criteria,baseline.criteria,'AC6 provider alone changed criteria');
 candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC6')]=input.row;
 const after=H.consume(withRun,tasks,research,candidate,aliases);
 for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!=='TASK-221/AC6'))
  assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'AC6 changed nontarget '+old.id);
 assert.deepEqual(after.selfChecks,before.selfChecks);assert.deepEqual(after.historicalAnnex,before.historicalAnnex);
 const target=after.criteria.find(r=>r.id==='TASK-221/AC6');
 assert.equal(target.status,run.currentSourceValid?'covered-current':'reviewed-historical','AC6 actual consumer disposition');
 return {before,after,report,transition:{id:target.id,status:target.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length}};
}
module.exports={prepare,preflight,consume,toolHashes};
