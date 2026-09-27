'use strict';
// Extend the immutable AC1+AC2 selection. All prior rows/proofs remain bound.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const H=require('./consume_historical_catalog'),V=require('./consume_version_review');
const BASE=path.join(A.client,'artifacts/TASK-225/review-64');
const reportName='ac3-independent-review.json';
function recompute(){
    const r=spawnSync('python3',[path.join(__dirname,'review_asset_recovery.py'),V.binding.original,V.binding.coverageSha256],
        {encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(r.status,0,'recovery-oracle-failed: '+r.stderr);return JSON.parse(r.stdout);
}
function rowFor(tasks,report,manifest){
    const text=tasks.find(t=>t.id==='TASK-211').acceptance_criteria[2],ref=file=>({file,sha256:manifest[file]});
    const cases=['cold-warm-delay','failed-recovery','old-client','old-server'];
    return {id:'TASK-211/AC3',targetSha256:R.digest(text),reviewer:'Independent asset recovery input/wire/database oracle',clauses:[{
        text,disposition:'reviewed',runTask:'TASK-211',tier:'natural-browser',caseIds:cases,sourceIdentity:ref('source-identities.json'),
        proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),reportName].map(ref),
        assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref(reportName)})),
        traces:['asset-events.jsonl','asset-requests.jsonl','persistence-checkpoints.json'].map(ref),
        contextIds:cases.map(c=>(c.startsWith('old-')?'gameplay/':'recovery/')+c+'/connected-contexts'),
        milestoneIds:cases.flatMap(c=>['initial/exact','round0/move/exact','round0/persisted/exact','round0/round/p1','round0/round/p2'].map(n=>(c.startsWith('old-')?'gameplay/':'recovery/')+c+'/'+n)),
        reason:'All four retained journeys connect after recovery/reload and complete independently checked input, wire and persisted turns. Requests/content hashes and exact induced versus unexpected errors are bound.',
        derivation:report.derivation,followUp:{scope:'If bound source changes, refresh only the affected assets/version provider after readers freeze and repeat retained AC1/AC2/AC3 reviews.',acceptance:'Exact contexts, input/wire/database boards, request/source hashes and error accounting. Historical proof cannot certify changed source.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}
    }]};
}
function prepare(out,tasks){
    assert(!fs.existsSync(out),'fresh recovery projection required');fs.cpSync(path.join(BASE,'prepared'),out,{recursive:true});
    const selected=path.join(out,'selected-211'),report=recompute();
    const save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
    save(reportName,report);const manifest=A.read(path.join(selected,'evidence-hashes.json'));
    manifest[reportName]=A.hash(path.join(selected,reportName));save('evidence-hashes.json',manifest);
    const row=rowFor(tasks,report,manifest);fs.writeFileSync(path.join(out,'recovery-review.json'),JSON.stringify(row,null,2)+'\n');return row;
}
function consume(before,tasks,research,candidate,prepared,row,binding=V.binding){
    assert.deepEqual(binding,V.binding,'wrong-recovery-release-identity');assert.equal(row.id,'TASK-211/AC3','wrong-recovery-owner');
    for(const id of ['TASK-211/AC1','TASK-211/AC2'])assert.deepEqual(candidate.reviews.find(r=>r.id===id),A.read(path.join(BASE,'reviewed-crosswalk.json')).reviews.find(r=>r.id===id),'lost-prior-review:'+id);
    for(const name of ['provenance.json','review.json','version-review.json'])assert.deepEqual(A.read(path.join(prepared,name)),A.read(path.join(BASE,'prepared',name)),'changed-prior-binding:'+name);
    const selected=path.join(prepared,'selected-211'),manifest=A.read(path.join(selected,'evidence-hashes.json'));
    const prior=A.read(path.join(BASE,'prepared/selected-211/evidence-hashes.json'));
    assert.deepEqual(manifest,{...prior,[reportName]:A.hash(path.join(selected,reportName))},'changed-recovery-manifest');
    for(const name of Object.keys(manifest))A.proofKey(selected,name,manifest);
    const report=recompute();assert.deepEqual(A.read(path.join(selected,reportName)),report,'changed-recovery-review');
    assert.deepEqual(row,rowFor(tasks,report,manifest),'wrong-recovery-review-ownership');
    const run=A.inspectRun(tasks.find(t=>t.id==='TASK-211'),selected);assert(run.historicalValid,'invalid-recovery-archive:'+run.issues.join(','));
    for(const id of row.clauses[0].contextIds)assert(row.clauses[0].assertions.some(a=>a.id===id&&Number.isInteger(a.expected)&&a.expected>=2),'missing-connected-context-assertions');
    const next=structuredClone(candidate);next.reviews[next.reviews.findIndex(r=>r.id===row.id)]=row;
    const after=H.consume({...before,runs:before.runs.map(r=>r.task===run.task?run:r)},tasks,research,next,[{id:'TASK-211',key:'TASK-211'}]);
    const result=after.criteria.find(r=>r.id===row.id);assert.equal(result.status,run.currentSourceValid?'covered-current':'reviewed-historical',result.reason||'recovery-transition-failed');
    return {after,candidate:next,report};
}
module.exports={BASE,prepare,consume,recompute};
