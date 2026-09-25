'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R = require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const C = require('./reconcile_evidence_catalog');
const out = path.resolve(process.argv[2]), started = Date.now();
assert(!fs.existsSync(out), 'fresh directory required'); fs.mkdirSync(out, {recursive: true});
const save = (n, x) => fs.writeFileSync(path.join(out, n), JSON.stringify(x, null, 2) + '\n', {flag: 'wx'});
const tasks = A.read(path.join(A.client, 'artifacts/tasks.json'));
const research = A.read(path.join(A.client, 'artifacts/online-coop-coverage-audit-2026-09-14/scenario-matrix.json'));
const frozen = C.prepare(tasks, research);
const tools = Object.fromEntries(['reconcile_evidence_catalog.js', 'run_catalog_reconciliation.js'].map(f => [f, A.hash(path.join(__dirname, f))]));
save('verification-plan.json', {scope: 'catalog reconciliation prerequisite only; not the complete TASK-225 gate',
    estimateMs: 300000, stopWorkMs: 3300000, budgetMs: 3600000,
    cases: ['same-input-actual-consumer', 'current-target-conservation', 'historical-provenance', 'stale-follow-ups', 'self-ownership',
        'unknown-target', 'missing-target', 'tampered-definition', 'invalid-provider', 'changed-self-text', 'changed-self-owner', 'omitted-annex-row'],
    tiers: ['source-executed consumer over real retained network/browser archives'],
    exclusions: ['no gameplay replay', 'no G09 closure', 'no freshness restoration', 'no complete invocation']});
save('task-input.json', tasks); save('research-input.json', research); save('tool-identities.json', tools);
save('historical-annex.json', frozen.annex); save('reviewed-crosswalk.json', frozen.candidate);
const controls = [];
function rejects(id, change, pattern) {
    const c = structuredClone(frozen.candidate), a = structuredClone(frozen.annex);
    change(c, a); let reason;
    try { C.validate(tasks, research, c, a); } catch (e) { reason = e.message; }
    assert(reason && pattern.test(reason), id + ': ' + reason);
    controls.push({id, pass: true, reason}); console.log('PASS rejects ' + id + ': ' + reason.split('\n')[0]);
}
rejects('unknown-target', c => c.reviews.push({...c.reviews[0], id: 'TASK-999/AC1'}), /unknown-or-unaccounted-target/);
rejects('missing-target', c => c.reviews.pop(), /unknown-or-unaccounted-target/);
rejects('tampered-definition', (c, a) => {a.providers[0].definition.description += ' tamper'; c.catalogReconciliation.annexSha256 = C.hashObject(a);}, /tampered-historical-definition/);
rejects('invalid-provider', (c, a) => {a.providers[0].run = a.providers[1].run; c.catalogReconciliation.annexSha256 = C.hashObject(a);}, /invalid-provider-binding/);
rejects('changed-self-text', c => c.reviews.find(r => r.id === 'TASK-225/AC1').clauses[0].text += ' tamper', /incomplete-clause-partition/);
rejects('changed-self-owner', c => c.reviews.find(r => r.id === 'TASK-225/AC1').clauses[0].checkpointIds.pop(), /invalid-self-ownership/);
rejects('omitted-annex-row', (c, a) => {a.reviews.pop(); c.catalogReconciliation.annexSha256 = C.hashObject(a);}, /unaccounted-historical-review/);
save('controls.json', controls);
const before = R.inventory(tasks, research, frozen.original); save('before-inventory.json', before);
assert(Date.now() - started < 3300000, 'cumulative deadline');
const after = C.inventory(tasks, research, frozen.candidate, frozen.annex); save('current-inventory.json', after);
const oldRows = [...before.criteria, ...before.researchGaps], newRows = [...after.criteria, ...after.researchGaps];
assert.deepEqual(oldRows.map(r => [r.id, r.text]), newRows.map(r => [r.id, r.text]), 'current-target-conservation');
// Same measured source/proof state on both sides, not a selected historical measurement.
for (const run of before.runs) assert.deepEqual(after.runs.find(r => r.task === run.task), run, 'changed-measured-run:' + run.task);
const changes = oldRows.filter(r => JSON.stringify(r) !== JSON.stringify(newRows.find(n => n.id === r.id))).map(r => {
    const n = newRows.find(n => n.id === r.id); return {id: r.id, before: r.status, after: n.status, beforeReason: r.reason, covered: n.covered};
});
assert.deepEqual(changes.map(c => c.id).sort(), [...Array.from({length: 9}, (_, i) => 'TASK-224/AC' + (i + 1)), 'TASK-225/AC1', 'G11'].sort());
assert.equal(after.inputIssues.length, 0); assert.equal(after.unexplainedGaps.length, 0);
assert.equal(after.selfChecks.length, 8); assert(after.selfChecks.every(c => c.status === 'awaiting-current-invocation'));
for (const id of ['TASK-209/AC1', 'TASK-209/AC2']) assert.equal(newRows.find(r => r.id === id).status, 'covered-current');
for (const id of ['TASK-209/AC3', 'G09']) assert.equal(newRows.find(r => r.id === id).status, 'unresolved-local');
assert(changes.every(c => !c.covered), 'metadata repair cannot manufacture gameplay closure');
assert.deepEqual(before.unresolvedPriorArchives, after.unresolvedPriorArchives);
assert.equal(after.priorArchivesComplete, false);
for (const [f, h] of Object.entries(tools)) assert.equal(A.hash(path.join(__dirname, f)), h, 'changed-tool');
C.validate(tasks, research, frozen.candidate, frozen.annex);
assert(Date.now() - started < 3300000, 'cumulative deadline');
save('comparison.json', {pass: true, inputIssuesBefore: before.inputIssues.length, inputIssuesAfter: after.inputIssues.length,
    unexplainedBefore: before.unexplainedGaps.length, unexplainedAfter: after.unexplainedGaps.length,
    currentTargets: newRows.length, historicalReviews: frozen.annex.reviews.length, historicalProviders: 4,
    selfChecks: 8, priorBefore: before.unresolvedPriorArchives.length, priorAfter: after.unresolvedPriorArchives.length,
    changes, semanticClosures: 0, freshnessRestorations: 0, fullAuditReady: false, controls: controls.length});
save('scoped-budget.json', {passScoped: true, startedMs: started, finishedMs: Date.now(), elapsedMs: Date.now() - started,
    cleanup: true, ownedProcesses: [], fullInvocation: false});
console.log(`PASS catalog reconciliation inputIssues=${before.inputIssues.length}->0 unexplained=${before.unexplainedGaps.length}->0 historicalReviews=22 selfChecks=8 prior=${after.unresolvedPriorArchives.length} semanticClosures=0 fullAuditReady=false`);
