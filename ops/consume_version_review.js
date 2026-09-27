'use strict';
// Cumulative AC2 adapter: preserve and revalidate the explicit review-60 AC1
// projection. Never mutate that archive or silently reset to an older catalog.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const B=require('./consume_asset_review'), H=require('./consume_historical_catalog');
const BASE=path.join(A.client,'artifacts/TASK-225/review-60');
const binding={original:path.join(BASE,'provider'),coverageSha256:'4ac678806c0b77fbdb3da574cf9e21159306c4f75a5803f63f792a002754e3c7'};
const reportName='ac2-independent-review.json';
function recompute() {
    const r=spawnSync('python3',[path.join(__dirname,'review_version_gameplay.py'),binding.original,binding.coverageSha256],
        {encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(r.status,0,'version-oracle-failed: '+r.stderr);
    return JSON.parse(r.stdout);
}
function rowFor(tasks,report,manifest) {
    const text=tasks.find(t=>t.id==='TASK-211').acceptance_criteria[1];
    const ref=file=>({file,sha256:manifest[file]});
    return {id:'TASK-211/AC2',targetSha256:R.digest(text),reviewer:'Independent recorded-release gameplay and persistence oracle',clauses:[{
        text,disposition:'reviewed',runTask:'TASK-211',tier:'natural-browser',caseIds:['old-client','old-server'],
        sourceIdentity:ref('source-identities.json'),
        proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),reportName].map(ref),
        assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref(reportName)})),
        traces:['asset-events.jsonl','asset-requests.jsonl','persistence-checkpoints.json'].map(ref),
        contextIds:['old-client','old-server'].map(c=>'gameplay/'+c+'/connected-contexts'),
        milestoneIds:['old-client','old-server'].flatMap(c=>['initial/exact','round0/move/exact','round0/persisted/exact','round0/round/p1','round0/round/p2'].map(n=>'gameplay/'+c+'/'+n)),
        reason:'Both recorded release combinations reviewed; legacy rejection precedes game mutation, candidate recovery and previous-server turns match independent fixture-derived state and database evidence.',
        derivation:report.derivation,
        followUp:{scope:'If any bound source changes, refresh only the affected assets/version provider after readers freeze and repeat both retained AC1 and AC2 reviews.',
            acceptance:'Exact release/source identities, two contexts, full wire/input/database proof and independently expected boards; current coverage only on matching sources.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}
    }]};
}
function prepare(out,tasks) {
    assert(!fs.existsSync(out),'fresh version projection required');
    fs.cpSync(path.join(BASE,'prepared'),out,{recursive:true});
    const selected=path.join(out,'selected-211'),report=recompute();
    const save=(n,x)=>fs.writeFileSync(path.join(selected,n),JSON.stringify(x,null,2)+'\n');
    save(reportName,report);
    const manifest=A.read(path.join(selected,'evidence-hashes.json'));
    manifest[reportName]=A.hash(path.join(selected,reportName));save('evidence-hashes.json',manifest);
    const row=rowFor(tasks,report,manifest);
    fs.writeFileSync(path.join(out,'version-review.json'),JSON.stringify(row,null,2)+'\n');
    return row;
}
function consume(before,tasks,research,candidate,prepared,row,releaseBinding=binding) {
    assert.deepEqual(releaseBinding,binding,'wrong-version-release-identity');
    assert.equal(row.id,'TASK-211/AC2','wrong-version-owner');
    // Reject a copied base with a modified canonical/original binding as well.
    assert.deepEqual(A.read(path.join(prepared,'provenance.json')),A.read(path.join(BASE,'prepared/provenance.json')),'changed-version-provenance');
    const original=B.inspect(tasks,path.join(BASE,'prepared'),binding);
    const selected=path.join(prepared,'selected-211'),manifest=A.read(path.join(selected,'evidence-hashes.json'));
    const expected={...original.manifest,[reportName]:A.hash(path.join(selected,reportName))};
    assert.deepEqual(manifest,expected,'changed-version-manifest');
    for(const n of Object.keys(manifest)) A.proofKey(selected,n,manifest);
    const report=recompute();
    assert.deepEqual(A.read(path.join(selected,reportName)),report,'changed-version-review');
    assert.deepEqual(row,rowFor(tasks,report,manifest),'wrong-version-review-ownership');
    assert.deepEqual(candidate.reviews.find(r=>r.id==='TASK-211/AC1'),A.read(path.join(BASE,'prepared/review.json')),'lost-current-AC1');
    const run=A.inspectRun(tasks.find(t=>t.id==='TASK-211'),selected);
    assert(run.historicalValid,'invalid-version-archive: '+run.issues.join(','));
    const next=structuredClone(candidate);
    next.reviews[next.reviews.findIndex(r=>r.id===row.id)]=row;
    const after=H.consume({...before,runs:before.runs.map(r=>r.task===run.task?run:r)},tasks,research,next,[{id:'TASK-211',key:'TASK-211'}]);
    const result=after.criteria.find(r=>r.id===row.id);
    assert.equal(result.status,run.currentSourceValid?'covered-current':'reviewed-historical',result.reason||'version-transition-failed');
    return {after,candidate:next,report};
}
module.exports={BASE,binding,prepare,consume,recompute};
