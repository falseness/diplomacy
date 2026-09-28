'use strict';
// Version 2: explicit reviewed current implementation and immutable historical ancestry.
// Current AC1 owns a separate provider key so refreshing it cannot implicitly refresh
// AC2/AC3 or other unresolved rows. Frozen terminal/sequence ancestry stays intact.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_terminal_outcomes_v2'),J=require('./review_terminal_ac2_v2'),H=require('./consume_historical_catalog');
const BASE='/root/diplomacy/artifacts/TASK-225/review-127/historical-selection.json';
const key='TASK-221-AC1';
const toolHashes=()=>({...require('./historical_source_binding').toolIdentities(),...Object.fromEntries([
    'review_terminal_outcomes_v2.js','review_terminal_ac2_v2.js','review_terminal_ac2_join.js',
    'review_terminal_semantics.js','review_terminal_boundary.js',
    'evidence_terminal_ac1_current_selection_v2.js','evidence_terminal_ac1_current_gate_v2.js'
].map(n=>[n,A.hash(path.join(__dirname,n))]))});
function row(tasks,report,manifest) {
    const result=F.rowFor(tasks,report,manifest,1);
    const clause=result.clauses[0];
    clause.runTask=key;
    clause.reason='Whole outcome criterion independently derived from the exact current provider; other terminal rows retain their own bindings.';
    return result;
}
function prepare(tasks,original,out,receipt) {
    assert(!fs.existsSync(out),'fresh AC1 projection');
    const bound=F.manifest(original),report=J.review(original,receipt,bound);
    fs.cpSync(original,out,{recursive:true});
    const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
    save('terminal-independent-review.json',report);
    const manifest=F.manifest(out);delete manifest['evidence-hashes.json'];save('evidence-hashes.json',manifest);
    return {original,selected:out,originalFiles:bound,receipt,baseline:{file:BASE,sha256:A.hash(BASE)},
        row:row(tasks,report,manifest),report,toolHashes:toolHashes()};
}
function preflight(tasks,input) {
    assert.deepEqual(input.toolHashes,toolHashes(),'AC1 reader tool binding');
    assert.deepEqual(input.baseline,{file:BASE,sha256:A.hash(BASE)},'AC1 ancestry binding');
    for(const dir of [input.original,input.selected]) {
        const rel=path.relative(fs.realpathSync('/root/diplomacy/artifacts'),fs.realpathSync(dir));
        assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'AC1 contained proof');
    }
    assert.deepEqual(F.manifest(input.original),input.originalFiles,'AC1 changed original');
    const report=J.review(input.original,input.receipt,input.originalFiles);
    assert.deepEqual(report,input.report,'AC1 recomputed report');
    assert.deepEqual(A.read(path.join(input.selected,'terminal-independent-review.json')),report,'AC1 selected report');
    const manifest=A.read(path.join(input.selected,'evidence-hashes.json'));
    const expected={...input.originalFiles,'terminal-independent-review.json':A.hash(path.join(input.selected,'terminal-independent-review.json'))};
    delete expected['evidence-hashes.json'];assert.deepEqual(manifest,expected,'AC1 exact projection');
    for(const n of Object.keys(manifest))A.proofKey(input.selected,n,manifest);
    assert.deepEqual(input.row,row(tasks,report,manifest),'AC1 complete row');
    const run=A.inspectRun({id:key},input.selected);assert(run.historicalValid,'AC1 valid archive');
    return {run,report};
}
function consume(tasks,research,input,baseline,retained) {
    const {run,report}=preflight(tasks,input), candidate=A.read(BASE);
    // The immutable ancestry may bind an older self wording. The baseline
    // consumer already validates and carries owners to the current wording.
    for(const self of baseline.selfChecks) {
        const old=candidate.reviews.find(r=>r.id===self.id);
        old.targetSha256=R.digest(tasks.find(t=>t.id==='TASK-225').acceptance_criteria[Number(self.id.split('AC')[1])-1]);
    }
    candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC2')]=retained.ac2Selection.row;
    candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC3')]=retained.ac3Selection.row;
    const withRun={...baseline,runs:[...baseline.runs,run]};
    const before=H.consume(withRun,tasks,research,candidate,[{key:'TASK-221-AC2',id:'TASK-221'},{key:'TASK-221-AC3',id:'TASK-221'},{key,id:'TASK-221'}]);
    assert.deepEqual(before.criteria,baseline.criteria,'AC1 provider alone changed criteria');
    candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC1')]=input.row;
    const after=H.consume(withRun,tasks,research,candidate,[{key:'TASK-221-AC2',id:'TASK-221'},{key:'TASK-221-AC3',id:'TASK-221'},{key,id:'TASK-221'}]);
    for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!=='TASK-221/AC1'))
        assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'AC1 changed nontarget '+old.id);
    assert.deepEqual(after.selfChecks,before.selfChecks);assert.deepEqual(after.historicalAnnex,before.historicalAnnex);
    const target=after.criteria.find(r=>r.id==='TASK-221/AC1');
    assert.equal(target.status,run.currentSourceValid?'covered-current':'reviewed-historical','AC1 actual consumer disposition');
    return {before,after,report,transition:{id:target.id,status:target.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length}};
}
module.exports={prepare,preflight,consume,BASE};
