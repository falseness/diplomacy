'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C = require('./reconcile_evidence_catalog');
const B = require('./consume_asset_review');
const out = path.resolve(process.argv[2]), start = Date.now();
assert(!fs.existsSync(out), 'fresh output required'); fs.mkdirSync(out,{recursive:true});
const save = (n,x) => fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
const tasks = A.read(path.join(A.client,'artifacts/tasks.json'));
const research = A.read(path.join(A.client,'artifacts/online-coop-coverage-audit-2026-09-14/scenario-matrix.json'));
const base = path.join(A.client,'artifacts/TASK-225/review-50/consumer');
const baseline = A.read(path.join(base,'reviewed-crosswalk.json')), annex = A.read(path.join(base,'historical-annex.json'));
const tools = Object.fromEntries(['prepare_asset_review.py','consume_asset_review.js','run_asset_review.js',
    'review_asset_archive.py','reconcile_evidence_catalog.js','consume_historical_catalog.js'].map(n => [n,A.hash(path.join(__dirname,n))]));
save('task-input.json',tasks); save('research-input.json',research); save('tool-identities.json',tools);
save('baseline-crosswalk.json',baseline); save('historical-annex.json',annex);
save('scoped-plan.json',{fullInvocation:false,estimateMs:300000,budgetMs:3600000,stopWorkMs:3300000,
    cases:['complete-AC1-historical-transition','delete-proof','tamper-proof','change-owner','change-assertion','change-projection'],
    tiers:['retained shipped-browser proof; source-executed independent consumer'],
    exclusions:['no provider refresh','no AC2/AC3 closure','no full audit while local prerequisites unresolved']});
const prepared = path.join(out,'prepared');
const child = spawnSync('python3',[path.join(__dirname,'prepare_asset_review.py'),prepared,path.join(out,'task-input.json')],
    {encoding:'utf8',timeout:60000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
save('prepare-command.json',{argv:child.spawnargs,cwd:process.cwd(),stdout:child.stdout,stderr:child.stderr,actualExit:child.status});
assert.equal(child.status,0,child.stderr); process.stdout.write(child.stdout);
const before = C.inventory(tasks,research,baseline,annex); save('before-inventory.json',before);
console.log('PASS baseline consumed inputIssues='+before.inputIssues.length+' unexplained='+before.unexplainedGaps.length);
const row = A.read(path.join(prepared,'review.json'));
// Preserve the exact old consumer rejection before applying the narrow adapter.
save('original-inspection.json',before.runs.find(r => r.task === 'TASK-211'));
const after = B.consume(before,tasks,research,baseline,prepared,row); save('current-inventory.json',after);
for (const old of [...before.criteria,...before.researchGaps].filter(r => r.id !== row.id))
    assert.deepEqual([...after.criteria,...after.researchGaps].find(r => r.id === old.id),old,'changed-nontarget:'+old.id);
assert.equal(before.criteria.find(r => r.id === row.id).status,'unresolved-local');
assert.equal(after.criteria.find(r => r.id === row.id).status,'reviewed-historical');
assert.deepEqual(after.selfChecks,before.selfChecks); assert.equal(after.selfChecks.length,8);
assert.equal(after.inputIssues.length,0); assert.equal(after.unexplainedGaps.length,0);
assert.deepEqual(after.unresolvedPriorArchives,before.unresolvedPriorArchives);
const candidate = structuredClone(baseline);
candidate.reviews[candidate.reviews.findIndex(r => r.id === row.id)] = row;
save('reviewed-crosswalk.json',candidate);
// Candidate requires this adapter and prepared archive; raw crosswalk alone is not a gate input.
const controls = [];
function reject(id, mutate, pattern) {
    const copy = path.join(out,'control-'+id); fs.cpSync(prepared,copy,{recursive:true});
    const changed = structuredClone(row); mutate(copy,changed);
    let reason;
    try { B.consume(before,tasks,research,baseline,copy,changed); } catch(e) { reason=e.message; }
    assert(reason && pattern.test(reason),id+': '+reason);
    controls.push({id,pass:true,reason}); console.log('PASS rejects '+id+': '+reason.split('\n')[0]);
}
reject('delete-proof',p => fs.unlinkSync(path.join(p,'selected-211/asset-requests.jsonl')),/ENOENT/);
reject('tamper-proof',p => fs.appendFileSync(path.join(p,'selected-211/asset-events.jsonl'),'{}\n'),/evidence-hash-mismatch/);
reject('change-owner',(_,r) => {r.clauses[0].runTask='TASK-212';},/wrong-asset-run-owner/);
reject('change-assertion',(_,r) => {r.clauses[0].assertions.pop();},/incomplete-asset-assertions/);
reject('change-projection',p => {const f=path.join(p,'selected-211/coverage-results.json'),c=A.read(f);c.cases.pop();fs.writeFileSync(f,JSON.stringify(c));},/invalid-asset-projection/);
save('controls.json',controls);
for (const [n,h] of Object.entries(tools)) assert.equal(A.hash(path.join(__dirname,n)),h,'changed-review-tool');
C.validate(tasks,research,baseline,annex);
assert(Date.now()-start<3300000,'scoped cumulative deadline');
save('comparison.json',{pass:true,target:row.id,before:'unresolved-local',after:'reviewed-historical',semanticReviewsAdded:1,
    currentCoverageAdded:0,priorBefore:before.unresolvedPriorArchives.length,priorAfter:after.unresolvedPriorArchives.length,
    inputIssues:0,unexplained:0,nonTargetDispositionsPreserved:true,selfChecks:8,controls:controls.length,fullAuditReady:false,
    laterTaskDependencies:after.unresolvedPriorArchives.filter(id => /^TASK-23[12]\//.test(id)),
    next:'Retain AC1 semantic review; freeze dependencies before bounded refresh. TASK-230 intended-red contract and all remaining local proof still unresolved.'});
save('scoped-budget.json',{passScoped:true,elapsedMs:Date.now()-start,startedMs:start,finishedMs:Date.now(),cleanup:true,
    ownedProcesses:[],fullInvocation:false});
console.log('PASS TASK-211/AC1 unresolved-local -> reviewed-historical; currentCoverageAdded=0 selfChecks=8 inputIssues=0 unexplained=0 controls=5 fullAuditReady=false');
