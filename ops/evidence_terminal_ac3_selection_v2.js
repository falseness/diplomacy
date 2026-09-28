'use strict';
// Version 2: explicit reviewed current implementation and immutable historical ancestry.
// AC3 owns a separate provider key so refreshing it cannot implicitly refresh
// AC1 or other unresolved rows. Frozen terminal/sequence ancestry stays intact.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const F=require('./review_terminal_outcomes_v2'),J=require('./review_terminal_ac3_v2'),H=require('./consume_historical_catalog');
const BASE='/root/diplomacy/artifacts/TASK-225/review-127/historical-selection.json';
const key='TASK-221-AC3';
const toolHashes=()=>({...require('./historical_source_binding').toolIdentities(),...Object.fromEntries(['review_terminal_outcomes_v2.js','evidence_terminal_selection_v2.js','evidence_terminal_gate_v2.js','review_terminal_ac3_v2.js','terminal_ac3_provider.js',
    'review_terminal_semantics.js','review_terminal_boundary.js','evidence_terminal_ac3_selection_v2.js','evidence_terminal_ac3_gate_v2.js'].map(n=>[n,A.hash(path.join(__dirname,n))]))});
function row(tasks,report,manifest) {
    const text=tasks.find(t=>t.id==='TASK-221').acceptance_criteria[2],ref=file=>({file,sha256:manifest[file]});
    return {id:'TASK-221/AC3',targetSha256:R.digest(text),reviewer:'Independent joined terminal lifecycle',clauses:[{
        text,disposition:'reviewed',runTask:key,tier:'natural-browser',caseIds:F.CASES,
        sourceIdentity:ref('source-identities.json'),traces:F.CASES.map(id=>ref(id+'/network-traces.jsonl')),
        contextIds:F.CASES.map(id=>'terminal/AC1/'+id+'/contexts'),
        milestoneIds:['coop','competitive'].map(mode=>'terminal/AC3/'+mode+'/p1/callbacks-full-raw'),
        proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),'terminal-ac3-review.json'].map(ref),
        assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref('terminal-ac3-review.json')})),
        reason:'One whole AC3 only, with original four journeys and all non-target dispositions preserved.',derivation:report.derivation,
        followUp:{scope:'Refresh this exact whole criterion on source changes.',acceptance:'Complete joined terminal AC3 proof on current sources.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}
    }]};
}
function prepare(tasks,original,out,receipt) {
    assert(!fs.existsSync(out),'fresh AC3 projection');
    const bound=F.manifest(original),report=J.review(original,receipt,bound);
    fs.cpSync(original,out,{recursive:true});
    const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
    save('terminal-ac3-review.json',report);
    const manifest=F.manifest(out);delete manifest['evidence-hashes.json'];save('evidence-hashes.json',manifest);
    return {original,selected:out,originalFiles:bound,receipt,baseline:{file:BASE,sha256:A.hash(BASE)},
        row:row(tasks,report,manifest),report,toolHashes:toolHashes()};
}
function preflight(tasks,input) {
    assert.deepEqual(input.toolHashes,toolHashes(),'AC3 reader tool binding');
    assert.deepEqual(input.baseline,{file:BASE,sha256:A.hash(BASE)},'AC3 ancestry binding');
    for(const dir of [input.original,input.selected]) {
        const rel=path.relative(fs.realpathSync('/root/diplomacy/artifacts'),fs.realpathSync(dir));
        assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'AC3 contained proof');
    }
    assert.deepEqual(F.manifest(input.original),input.originalFiles,'AC3 changed original');
    const report=J.review(input.original,input.receipt,input.originalFiles);
    assert.deepEqual(report,input.report,'AC3 recomputed report');
    assert.deepEqual(A.read(path.join(input.selected,'terminal-ac3-review.json')),report,'AC3 selected report');
    const manifest=A.read(path.join(input.selected,'evidence-hashes.json'));
    const expected={...input.originalFiles,'terminal-ac3-review.json':A.hash(path.join(input.selected,'terminal-ac3-review.json'))};
    delete expected['evidence-hashes.json'];assert.deepEqual(manifest,expected,'AC3 exact projection');
    for(const n of Object.keys(manifest))A.proofKey(input.selected,n,manifest);
    assert.deepEqual(input.row,row(tasks,report,manifest),'AC3 complete row');
    const run=A.inspectRun({id:key},input.selected);assert(run.historicalValid,'AC3 valid archive');
    return {run,report};
}
function consume(tasks,research,input,baseline,ac2) {
    const {run,report}=preflight(tasks,input), candidate=A.read(BASE);
    // The immutable ancestry may bind an older self wording. The baseline
    // consumer already validates and carries owners to the current wording.
    for(const self of baseline.selfChecks) {
        const old=candidate.reviews.find(r=>r.id===self.id);
        old.targetSha256=R.digest(tasks.find(t=>t.id==='TASK-225').acceptance_criteria[Number(self.id.split('AC')[1])-1]);
    }
    candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC2')]=ac2.row;
    const withRun={...baseline,runs:[...baseline.runs,run]};
    const before=H.consume(withRun,tasks,research,candidate,[{key:'TASK-221-AC2',id:'TASK-221'},{key,id:'TASK-221'}]);
    assert.deepEqual(before.criteria,baseline.criteria,'AC3 provider alone changed criteria');
    candidate.reviews[candidate.reviews.findIndex(r=>r.id==='TASK-221/AC3')]=input.row;
    const after=H.consume(withRun,tasks,research,candidate,[{key:'TASK-221-AC2',id:'TASK-221'},{key,id:'TASK-221'}]);
    for(const old of [...before.criteria,...before.researchGaps].filter(r=>r.id!=='TASK-221/AC3'))
        assert.deepEqual([...after.criteria,...after.researchGaps].find(r=>r.id===old.id),old,'AC3 changed nontarget '+old.id);
    assert.deepEqual(after.selfChecks,before.selfChecks);assert.deepEqual(after.historicalAnnex,before.historicalAnnex);
    const target=after.criteria.find(r=>r.id==='TASK-221/AC3');
    assert.equal(target.status,run.currentSourceValid?'covered-current':'reviewed-historical','AC3 actual consumer disposition');
    return {before,after,report,transition:{id:target.id,status:target.status,before:before.unresolvedPriorArchives.length,after:after.unresolvedPriorArchives.length}};
}
module.exports={prepare,preflight,consume,BASE};
