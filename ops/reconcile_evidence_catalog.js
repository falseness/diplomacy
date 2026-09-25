'use strict';
// Explicit provider-only adapter: historical definitions never enter target enumeration.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R = require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const S = require('/root/diplomacy_server/tests/reliability/helpers/evidence-self');
const BASE = path.join(A.client, 'artifacts/TASK-225/review-43/prepared/reviewed-crosswalk.json');
const BASE_HASH = '826391242edc7aae5240db0d5d3f42f66702ec0d53a7c9f092c326eeaad54c23';
const HISTORY = path.join(A.client, 'artifacts/TASK-225/green-03/task-input.json');
const HISTORY_HASH = 'bfdae2157f605760f12c02559e6387c999903ca428e7d75ff4f855891b8cb867';
const IDS = ['TASK-230', 'TASK-231', 'TASK-244', 'TASK-245'];
const hashObject = x => R.digest(JSON.stringify(x));
function followUp(id) {
    return {scope: `Refresh the exact stale reviewed local clause ${id} after dependencies freeze; retain its independent oracle, case selection and evidence tier.`,
        acceptance: 'One fresh complete bounded provider invocation, exact consumed clause assertions, matching source and evidence hashes, actual zero exits and owned cleanup. Historical proof alone must not close this clause.',
        targetMs: 2700000, stopWorkMs: 3300000, budgetMs: 3600000};
}
function prepare(tasks, research) {
    assert.equal(A.hash(BASE), BASE_HASH, 'changed-original-review');
    assert.equal(A.hash(HISTORY), HISTORY_HASH, 'changed-historical-catalog');
    const original = A.read(BASE), history = A.read(HISTORY), current = R.targets(tasks, research);
    const annex = {schemaVersion: 1, role: 'historical-only; no current targets or coverage',
        origin: {file: BASE, sha256: A.hash(BASE)}, definitionSource: {file: HISTORY, sha256: HISTORY_HASH},
        providers: IDS.map(id => ({id, definition: history.find(t => t.id === id), run: original.runReferences[id]})),
        reviews: original.reviews.filter(r => !current.some(t => t.id === r.id))};
    const candidate = structuredClone(original);
    candidate.reviews = candidate.reviews.filter(r => current.some(t => t.id === r.id));
    for (const id of IDS) delete candidate.runReferences[id];
    for (const row of candidate.reviews) {
        if (row.id.startsWith('TASK-224/') || row.id === 'G11')
            for (const c of row.clauses) if (c.disposition === 'reviewed') c.followUp = followUp(row.id);
        if (row.id === 'TASK-225/AC1') {
            const target = current.find(t => t.id === row.id);
            row.targetSha256 = R.digest(target.text);
            row.clauses = [{text: target.text, disposition: 'current-invocation',
                reason: 'Current AC1 owns complete enumeration, validated reviews, lifecycle and real-target transition. Independent criterion consumption is allowed while G09 remains unresolved; final completeness still requires all local clauses and a declared long-phase contract. These obligations await this invocation, not historical proof.',
                checkpointIds: [...S.OWNERS[row.id]]}];
        }
    }
    candidate.catalogReconciliation = {schemaVersion: 1, annexSha256: hashObject(annex),
        currentTargetsSha256: hashObject(current), originalSha256: A.hash(BASE)};
    return {original, candidate, annex};
}
function validate(tasks, research, candidate, annex) {
    assert.equal(A.hash(BASE), BASE_HASH, 'changed-original-review');
    assert.equal(A.hash(BASE), annex.origin.sha256, 'changed-original-review');
    assert.equal(annex.origin.file, BASE, 'wrong-original-review');
    assert.equal(annex.definitionSource.file, HISTORY, 'wrong-historical-catalog');
    assert.equal(annex.definitionSource.sha256, HISTORY_HASH, 'changed-historical-definition-binding');
    assert.equal(A.hash(HISTORY), HISTORY_HASH, 'changed-historical-catalog');
    assert.equal(candidate.catalogReconciliation.annexSha256, hashObject(annex), 'changed-historical-annex');
    const all = R.targets(tasks, research), original = A.read(BASE), history = A.read(HISTORY);
    assert.equal(candidate.catalogReconciliation.originalSha256, A.hash(BASE), 'changed-original-binding');
    assert.equal(candidate.catalogReconciliation.currentTargetsSha256, hashObject(all), 'changed-current-targets');
    assert.deepEqual(candidate.reviews.map(r => r.id).sort(), all.map(t => t.id).sort(), 'unknown-or-unaccounted-target');
    assert.deepEqual(annex.reviews, original.reviews.filter(r => !all.some(t => t.id === r.id)), 'unaccounted-historical-review');
    assert.deepEqual(annex.providers.map(p => p.id), IDS, 'unknown-historical-provider');
    for (const provider of annex.providers) {
        assert(!tasks.some(t => t.id === provider.id), 'historical-provider-is-current');
        assert.deepEqual(provider.definition, history.find(t => t.id === provider.id), 'tampered-historical-definition');
        assert.deepEqual(provider.run, original.runReferences[provider.id], 'invalid-provider-binding');
        assert.equal(A.hash(path.join(provider.run.directory, 'evidence-hashes.json')), provider.run.manifestSha256, 'changed-provider-manifest');
        for (const row of annex.reviews.filter(r => r.id.startsWith(provider.id + '/'))) {
            const text = provider.definition.acceptance_criteria[Number(row.id.split('/AC')[1]) - 1];
            assert.equal(row.targetSha256, R.digest(text), 'historical-review-definition-mismatch');
            assert.equal(row.clauses.map(c => c.text).join(''), text, 'historical-clause-partition');
        }
    }
    for (const t of all.filter(t => t.task === 'TASK-225')) S.ownership(t, candidate.reviews.find(r => r.id === t.id));
    // No arbitrary review rewriting is authorized by a normalization envelope.
    const expected = prepare(tasks, research);
    assert.deepEqual(candidate, expected.candidate, 'unexpected-reconciliation-change');
    return true;
}
function inventory(tasks, research, candidate, annex) {
    validate(tasks, research, candidate, annex);
    const refs = {...candidate.runReferences};
    // inspectRun consumes identity/run metadata only. Empty criteria explicitly
    // exclude these provider projections from the existing consumer's targets.
    const providers = annex.providers.map(p => {
        refs[p.id] = p.run;
        return {id: p.id, status: 'historical-provider-only', acceptance_criteria: [], artifacts_feedback: ''};
    });
    assert.deepEqual(R.targets([...tasks, ...providers], research), R.targets(tasks, research), 'target-conservation');
    const report = R.inventory([...tasks, ...providers], research, {...candidate, runReferences: refs});
    report.historicalProviders = annex.providers.map(p => ({id: p.id, currentTarget: false,
        definitionSha256: hashObject(p.definition), run: p.run, annexSha256: hashObject(annex)}));
    report.historicalAnnex = {reviews: annex.reviews.map(r => r.id), sha256: hashObject(annex),
        coverageClaim: false, retainedObligations: ['TASK-231/AC4 natural-clock/death/result recovery remains unproved; use relevant research clauses, never catalog absence, to assess local obligations.']};
    return report;
}
module.exports = {prepare, validate, inventory, hashObject, BASE, HISTORY};
