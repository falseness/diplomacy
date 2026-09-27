'use strict';
// Resume the selected real reviews after the numeric scope change. This is a
// prerequisite inventory, never a replacement for the complete evidence gate.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R = require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const C = require('./reconcile_evidence_catalog');
const H = require('./consume_historical_catalog');
const B = require('./consume_asset_review');
const BASE = path.join(A.client, 'artifacts/TASK-225/review-50/consumer');
function select(tasks, research) {
    assert.equal(A.hash(path.join(BASE, 'reviewed-crosswalk.json')), '4667d0e616884d63fd85712859c041c27c1d2ca012ad2e7048e29b5a4bc7fe07');
    assert.equal(A.hash(path.join(BASE, 'historical-annex.json')), '6835bf1de32970b0e5669c2711d33a01c7aa0c8a41a8219e059c709d225ddc5f');
    const baseline = A.read(path.join(BASE, 'reviewed-crosswalk.json'));
    const annex = A.read(path.join(BASE, 'historical-annex.json'));
    const fresh = C.prepare(tasks, research);
    const withoutSelf = a => ({...a,reviews:a.reviews.filter(r => !r.id.startsWith('TASK-225/'))});
    assert.deepEqual(withoutSelf(fresh.annex), withoutSelf(annex), 'historical-annex-changed');
    for (const row of annex.reviews)
        assert.deepEqual(fresh.annex.reviews.find(r => r.id === row.id), row, 'lost-historical-review:' + row.id);
    for (const row of fresh.annex.reviews.filter(r => !annex.reviews.some(old => old.id === r.id))) {
        assert(row.id.startsWith('TASK-225/'), 'unexpected-annex-addition');
        assert.deepEqual(row, fresh.original.reviews.find(r => r.id === row.id), 'changed-historical-self-definition');
    }
    assert.deepEqual(fresh.candidate.runReferences, baseline.runReferences, 'selected-providers-changed');
    // Only current self definitions/ownership and informational later targets
    // may differ. Never regenerate or silently discard an earlier review.
    for (const row of fresh.candidate.reviews) {
        const task = row.id.split('/')[0];
        if (task === 'TASK-225' || R.laterTask(task)) continue;
        assert.deepEqual(row, baseline.reviews.find(r => r.id === row.id), 'changed-selected-review:' + row.id);
    }
    const oldTasks = A.read(path.join(BASE, 'task-input.json'));
    const oldResearch = A.read(path.join(BASE, 'research-input.json'));
    const required = (ts, rs) => R.targets(ts, rs).filter(t => t.task !== 'TASK-225' && !R.laterTask(t.task));
    assert.deepEqual(required(tasks, research), required(oldTasks, oldResearch), 'changed-required-definitions');
    C.validate(tasks, research, fresh.candidate, fresh.annex);
    return {candidate: fresh.candidate, annex:fresh.annex, baseline, baselineAnnex:annex};
}
function scopeChecks(report, tasks, research, candidate, providers) {
    const checks = [];
    function check(id, expected, observed) {
        assert.deepEqual(observed, expected, id);
        checks.push({id, expected, observed, pass: true});
    }
    const signature = r => ({inputIssues:r.inputIssues, unresolved:r.unresolvedRequiredLocal,
        prior:r.unresolvedPriorArchives, pass:r.pass, complete:r.priorArchivesComplete,
        scenarios:r.scenarioCoverageComplete, self:r.selfChecks,
        required:[...r.criteria,...r.researchGaps].filter(t => !R.laterTask(t.task))});
    const rerun = (ts, rs, rows) => H.consume(report, ts, rs, rows, providers);
    const variants = structuredClone(tasks);
    for (const t of variants.filter(t => R.laterTask(t.id))) {
        t.status = 'pending'; t.artifacts_feedback = '/missing/invalid-later-proof';
    }
    const corruptLater = structuredClone(candidate);
    corruptLater.reviews = corruptLater.reviews.filter(r => !R.laterTask(r.id.split('/')[0]));
    corruptLater.runReferences['TASK-232'] = {directory:'/missing/invalid-later-proof'};
    check('later-missing-invalid-proof-invariant', signature(report), signature(rerun(variants,research,corruptLater)));
    variants.push({id:'TASK-1000',status:'done',acceptance_criteria:['No proof exists for this later task.']});
    const added = rerun(variants,research,corruptLater);
    check('added-later-task-invariant', signature(report), signature(added));
    check('added-later-task-uncovered', ['outside-task-scope',false],
        [added.criteria.at(-1).status,added.criteria.at(-1).covered]);
    check('all-later-criteria-uncovered', true, report.criteria.filter(t => R.laterTask(t.task))
        .every(t => t.status === 'outside-task-scope' && t.covered === false));
    check('no-later-required-targets', [], report.unresolvedRequiredLocal.filter(id => R.laterTask(id.split('/')[0])));
    check('eight-self-checks', 8, report.selfChecks.length);
    check('all-research-obligations', 22, report.researchGaps.length);
    check('G09-remains-required', true, report.unresolvedPriorArchives.includes('G09'));
    check('zero-input-issues', [], report.inputIssues);
    check('zero-unexplained-dispositions', [], report.unexplainedGaps);
    return checks;
}
function main(out) {
    out = path.resolve(out); assert(!fs.existsSync(out), 'fresh output required'); fs.mkdirSync(out,{recursive:true});
    const save = (n,x) => fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
    const tasks = A.read(path.join(A.client,'artifacts/tasks.json'));
    const research = A.read(path.join(A.client,'artifacts/online-coop-coverage-audit-2026-09-14/scenario-matrix.json'));
    const selected = select(tasks,research);
    save('task-input.json',tasks); save('research-input.json',research);
    save('baseline-crosswalk.json',selected.baseline); save('baseline-annex.json',selected.baselineAnnex);
    save('historical-annex.json',selected.annex);
    save('catalog-crosswalk.json',selected.candidate);
    const before = C.inventory(tasks,research,selected.candidate,selected.annex);
    save('before-inventory.json',before);
    const prepared = path.join(A.client,'artifacts/TASK-225/review-53/prepared');
    assert.equal(A.hash(path.join(prepared,'review.json')), 'ce92793039cb2f135a9867d6cc7addca2a71d0e284d6552d545e6558dce7e778');
    const row = A.read(path.join(prepared,'review.json'));
    // Revalidate retained proof; do not repeat the completed AC1 experiment or
    // manufacture a current claim from its stale archive.
    const report = B.consume(before,tasks,research,selected.candidate,prepared,row);
    const candidate = structuredClone(selected.candidate);
    candidate.reviews[candidate.reviews.findIndex(r => r.id === row.id)] = row;
    save('reviewed-crosswalk.json',candidate); save('current-inventory.json',report);
    const providers = selected.annex.providers.map(p => ({id:p.id,key:C.providerKey(p)}));
    providers.push({id:'TASK-211',key:'TASK-211'});
    const checks = scopeChecks(report,tasks,research,candidate,providers);
    assert.equal(report.criteria.find(r => r.id === row.id).status,'reviewed-historical');
    assert(report.retainedConcurrentReviews.every(r => r.status === 'reviewed-historical'));
    const historicalLongPhase = selected.annex.reviews.find(r => r.id === 'TASK-209/AC3');
    assert(historicalLongPhase.clauses.some(c => c.disposition === 'unresolved'));
    save('checkpoints.json',{checks});
    save('remaining-clause-plan.json',{fullAuditReady:report.priorArchivesComplete,
        requiredPrior:report.unresolvedPriorArchives, followUps:report.followUps,
        selfChecks:report.selfChecks, outsideScope:report.criteria.filter(r => R.laterTask(r.task)).map(r => r.id),
        historicalObligations:report.historicalAnnex.retainedObligations, historicalLongPhase,
        retainedConcurrentReviews:report.retainedConcurrentReviews,
        selection:{crosswalk:path.join(out,'reviewed-crosswalk.json'),annex:path.join(out,'historical-annex.json'),
            prepared,adapter:'ops/consume_asset_review.js',rawCrosswalkIsGateInput:false}});
    save('comparison.json',{scopeChecks:checks.length,inputIssues:report.inputIssues.length,
        unexplained:report.unexplainedGaps.length,requiredPrior:report.unresolvedPriorArchives.length,
        selfChecks:report.selfChecks.length,research:report.researchGaps.length,
        outsideScope:report.criteria.filter(r => R.laterTask(r.task)).length,
        retainedAC1:report.criteria.find(r => r.id === row.id).status,
        semanticReviewsAdded:0,currentCoverageAdded:0,fullAuditReady:report.priorArchivesComplete});
    for (const c of checks) console.log('PASS '+c.id);
    console.log(`PASS scoped inventory requiredPrior=${report.unresolvedPriorArchives.length} outsideScope=${report.criteria.filter(r=>R.laterTask(r.task)).length} selfChecks=8 research=22 inputIssues=0 unexplained=0`);
    console.log('INCOMPLETE full audit: required prior local proof remains; no current coverage added');
}
if (require.main === module) main(process.argv[2]);
module.exports = {select, scopeChecks};
