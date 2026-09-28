'use strict';
// Whole TASK-221/AC7 review consumed by the live root cumulative consumer.
// Baseline and review-present inventories are derived in one invocation from
// identical current inputs; no saved inventory verdict or total is an input.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const C=require('./reconcile_evidence_catalog'),H=require('./consume_historical_catalog');
const F=require('./review_terminal_outcomes_v2'),X=require('./ac7_terminal_reader');
const TARGET='TASK-221/AC7',KEY='TASK-221-AC7',CONTAINER='/root/diplomacy/artifacts/TASK-225';
const JOURNEYS=['terminal-victory','terminal-draw','terminal-to-coop','terminal-to-competitive'];
const TOOLS=['ac7_terminal_reader.js','ac7_consumer_selection.js','run_ac7_consumer.js','run_ac7_consumer.py','reconcile_evidence_catalog.js','consume_historical_catalog.js','review_terminal_outcomes_v2.js'];
const toolHashes=()=>Object.fromEntries(TOOLS.map(n=>[n,A.hash(path.join(__dirname,n))]));
const contained=dir=>{const rel=path.relative(fs.realpathSync(CONTAINER),fs.realpathSync(dir));assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'contained AC7 proof');};
// Reader verdicts become recomputable checks: each clause must PASS with no failures.
function review(run){
 // JSON round-trip drops the reader's per-array check helpers; the saved report is data only.
 const r=JSON.parse(JSON.stringify(X.evaluate(X.load(run))));
 return {reader:r.reader,runDir:r.runDir,pass:r.pass,results:r.results,
  checks:r.results.map(c=>({id:TARGET+'/'+c.id,expected:{result:'PASS',failures:[]},observed:{result:c.result,failures:c.failures},pass:c.result==='PASS'&&c.failures.length===0}))};
}
function rowFor(tasks,report,m){
 const text=tasks.find(t=>t.id==='TASK-221').acceptance_criteria[6],ref=file=>({file,sha256:m[file]});
 assert.equal(text,tasks.find(t=>t.id==='TASK-225').acceptance_criteria[6],'reader-clause-source');
 let at=0;for(const [,clause] of X.CLAUSES){const i=text.indexOf(clause,at);assert(i>=at,'reader-clause-partition');at=i+clause.length;}
 assert.equal(report.pass,true);assert.deepEqual(report.checks.map(c=>c.id),X.CLAUSES.map(([id])=>TARGET+'/'+id));
 return {id:TARGET,targetSha256:R.digest(text),reviewer:'Independent whole-AC7 terminal reader (ops/ac7_terminal_reader.js)',clauses:[{
  text,disposition:'reviewed',runTask:KEY,tier:'real-network',caseIds:JOURNEYS,sourceIdentity:ref('source-identities.json'),
  traces:JOURNEYS.map(j=>ref(j+'/network-traces.jsonl')),milestoneIds:['browser-journeys','two-humans','smallest-maps','seed-1','fog-join-spread'].map(id=>TARGET+'/'+id),
  proofs:['ac7-review.json','checkpoints.json','coverage-results.json','verification-plan.json','terminal-inventory.json','next-game-traces.jsonl'].map(ref),
  assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref('ac7-review.json')})),
  derivation:'All nine AC7 clauses are recomputed by the independent reader from shipped source and raw traces of one complete acquisition: journey count, humans, smallest co-op/competitive maps, seed, fog/join spread, declared fixtures, excluded diagnostics and exact per-case assertions. No stored pass boolean is consumed.',
  reason:'Whole AC7 from one fresh acquisition on current source; no other TASK-221 criterion is credited.',
  followUp:{scope:'Revalidate whole AC7 with the independent reader after any bound source changes.',acceptance:'Fresh complete terminal acquisition, all nine reader clauses PASS, current source hashes.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}
 }]};
}
function prepare(tasks,original,out){
 assert(!fs.existsSync(out),'fresh AC7 projection');contained(original);
 const originalFiles=F.manifest(original),report=review(original);assert(report.pass,'AC7 reader failed');
 fs.cpSync(path.join(original,'provider'),out,{recursive:true});
 fs.writeFileSync(path.join(out,'ac7-review.json'),JSON.stringify(report,null,2)+'\n');
 const manifest=F.manifest(out);delete manifest['evidence-hashes.json'];
 fs.writeFileSync(path.join(out,'evidence-hashes.json'),JSON.stringify(manifest,null,2)+'\n');
 return {original,selected:out,originalFiles,manifest,report,row:rowFor(tasks,report,manifest),toolHashes:toolHashes()};
}
function preflight(tasks,input){
 assert.deepEqual(input.toolHashes,toolHashes(),'AC7 tool binding');
 contained(input.original);contained(input.selected);
 // Exact per-file reasons: a deleted or altered projected proof fails closed by name.
 for(const [name,sha] of Object.entries(input.manifest)){
  const file=path.join(input.selected,name);
  assert(fs.existsSync(file),'deleted-proof:'+name);assert.equal(A.hash(file),sha,'tampered-proof:'+name);
 }
 const present=F.manifest(input.selected);delete present['evidence-hashes.json'];
 assert.deepEqual(Object.keys(present).sort(),Object.keys(input.manifest).sort(),'unbound-projection-file');
 assert.deepEqual(A.read(path.join(input.selected,'evidence-hashes.json')),input.manifest,'AC7 projection manifest');
 assert.deepEqual(F.manifest(input.original),input.originalFiles,'original AC7 proof binding');
 const expected={'ac7-review.json':input.manifest['ac7-review.json']};
 for(const [n,h] of Object.entries(input.originalFiles))if(n.startsWith('provider/'))expected[n.slice(9)]=h;
 assert.deepEqual(input.manifest,expected,'exact AC7 projection');
 const report=review(input.original);assert.deepEqual(report,input.report,'recomputed AC7 review');
 assert.deepEqual(A.read(path.join(input.selected,'ac7-review.json')),report,'saved AC7 review');
 assert.deepEqual(input.row,rowFor(tasks,report,input.manifest),'whole AC7 row');
 const run=A.inspectRun({id:KEY},input.selected);
 assert(run.historicalValid&&run.currentSourceValid,'current AC7 archive: '+run.issues.join(','));
 return {run,report};
}
function consume(tasks,research,input){
 const {run}=preflight(tasks,input),fresh=C.prepare(tasks,research);
 const baseline=C.inventory(tasks,research,fresh.candidate,fresh.annex),withRun={...baseline,runs:[...baseline.runs,run]};
 const aliases=[{key:KEY,id:'TASK-221'}],candidate=structuredClone(fresh.candidate);
 const before=H.consume(withRun,tasks,research,candidate,aliases);
 assert.deepEqual(before.criteria,baseline.criteria,'AC7 provider alone changed criteria');
 assert.deepEqual(before.researchGaps,baseline.researchGaps,'AC7 provider alone changed research gaps');
 candidate.reviews[candidate.reviews.findIndex(r=>r.id===TARGET)]=input.row;
 const after=H.consume(withRun,tasks,research,candidate,aliases);
 for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!==TARGET))
  assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'AC7 changed non-target '+old.id);
 assert.deepEqual(after.selfChecks,before.selfChecks,'AC7 changed self owners');assert.equal(after.selfChecks.length,8);
 const target=after.criteria.find(r=>r.id===TARGET);assert.equal(target.status,'covered-current','actual complete AC7 consumption: '+(target.reason||target.status));
 return {baseline,before,after,run};
}
module.exports={TARGET,KEY,review,rowFor,prepare,preflight,consume,toolHashes};
