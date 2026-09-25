'use strict';
// Same measured archive inventory, differing only in the complete AC2 review.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict'), os=require('node:os');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const [prepared,out]=process.argv.slice(2);
fs.mkdirSync(out,{recursive:false});
const read=f=>JSON.parse(fs.readFileSync(f)),write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const baselineFile='/root/diplomacy/artifacts/TASK-225/review-30/prepared/reviewed-crosswalk.json';
assert.equal(A.hash(baselineFile),'81f4f5931d10393f55fd32604994c951d064355d421882348d214455d9ac4e24');
const baseline=read(baselineFile), candidate=read(path.join(prepared,'reviewed-crosswalk.json'));
const tasks=read('/root/diplomacy/artifacts/tasks.json');
const research=read('/root/diplomacy/artifacts/online-coop-coverage-audit-2026-09-14/scenario-matrix.json');
// One expensive inventory. Before/after use its exact same inspected run objects,
// source validity, task text, and raw proofs. Only the AC2 review varies.
const after=R.inventory(tasks,research,candidate);write('current-inventory.json',after);
const all=R.targets(tasks,research);
const before=all.map(t=>R.disposition(t,baseline.reviews.find(r=>r.id===t.id),after.runs,tasks));
const current=[...after.criteria,...after.researchGaps];
const changed=all.filter(t=>JSON.stringify(before.find(r=>r.id===t.id))!==JSON.stringify(current.find(r=>r.id===t.id))).map(t=>t.id);
assert.deepEqual(changed,['TASK-209/AC2']);
const target=all.find(t=>t.id==='TASK-209/AC2'), row=candidate.reviews.find(r=>r.id===target.id);
const positive=current.find(r=>r.id===target.id);
write('ac2-disposition.json',positive);
assert.equal(positive.status,'covered-current',positive.reason);
assert.equal(current.find(r=>r.id==='G09').status,'unresolved-local');
assert.equal(current.find(r=>r.id==='TASK-209/AC3').status,'unresolved-local');
assert.equal(after.selfChecks.length,8);
const prior=before.filter(r=>r.task!=='TASK-225'&&!['covered-current','deferred-public','partially-deferred'].includes(r.status)).map(r=>r.id);
assert.deepEqual(prior.filter(id=>id!==target.id),after.unresolvedPriorArchives);
const run=after.runs.find(r=>r.task==='TASK-209'),controls=[];
// Mutate only a disposable copy, keeping the selected proof and old archives immutable.
for(const kind of ['delete-packets','tamper-packets','delete-review','tamper-review']) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task225-consumer-'));
 try {
  fs.cpSync(run.directory,dir,{recursive:true});
  const file=path.join(dir,kind.endsWith('packets')?'recipient-packets.jsonl':'ac2-independent-review.json');
  if(kind.startsWith('delete'))fs.unlinkSync(file);else fs.appendFileSync(file,'tampered\n');
  const observed=R.disposition(target,row,[{...run,directory:dir}],tasks);
  assert.equal(observed.status,'invalid-review');
  controls.push({kind,status:observed.status,reason:observed.reason,pass:true});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
write('before-dispositions.json',before);write('consumer-controls.json',controls);
write('comparison.json',{pass:true,changed,priorBefore:prior.length,priorAfter:after.unresolvedPriorArchives.length,
 selfChecks:8,allEarlierDispositionsPreserved:true,publicStatuses:Object.fromEntries(tasks.filter(t=>/^TASK-22[6789]$/.test(t.id)).map(t=>[t.id,t.status])),
 fullAuditReady:false,controls:controls.length,comparison:'Identical measured sources/runs and proof inputs; only complete AC2 review differs.'});
console.log(`PASS actual consumer AC2=covered-current prior=${prior.length}->${after.unresolvedPriorArchives.length} selfChecks=8 controls=4 G09=unresolved fullAuditReady=false`);
