'use strict';
// Real retained catalogs and crosswalks; metadata checks never certify gameplay.
const assert = require('node:assert/strict');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R = require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const C = require('./reconcile_evidence_catalog');
const tasks = A.read('artifacts/tasks.json');
const research = A.read('artifacts/online-coop-coverage-audit-2026-09-14/scenario-matrix.json');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
const selected = C.prepare(tasks, research);
test('current catalog preserves every exact target', () => {
    assert(C.validate(tasks, research, selected.candidate, selected.annex));
    assert.deepEqual(selected.candidate.reviews.map(r => r.id), R.targets(tasks, research).map(t => t.id));
});
test('reused TASK-230 and TASK-231 criteria cannot inherit archived reviews', () => {
    for (const id of ['TASK-230', 'TASK-231']) {
        const target = tasks.find(t => t.id === id);
        assert(target, 'current collision fixture missing');
        target.acceptance_criteria.forEach((text, i) => {
            const row = selected.candidate.reviews.find(r => r.id === id + '/AC' + (i + 1));
            assert.equal(row.targetSha256, R.digest(text));
            assert(row.clauses.every(c => c.disposition === 'unresolved'));
        });
        assert(!Object.hasOwn(selected.candidate.runReferences, id));
        assert(selected.annex.reviews.some(r => r.id.startsWith(id + '/')));
    }
});
test('identical criterion text cannot transfer a provider-only task definition', () => {
    const copy = structuredClone(tasks);
    const archived = selected.annex.providers.find(p => p.id === 'TASK-230').definition;
    copy.find(t => t.id === 'TASK-230').acceptance_criteria[0] = archived.acceptance_criteria[0];
    const prepared = C.prepare(copy, research);
    assert(prepared.candidate.reviews.find(r => r.id === 'TASK-230/AC1').clauses.every(c => c.disposition === 'unresolved'));
    assert(prepared.annex.reviews.some(r => r.id === 'TASK-230/AC1'));
});
test('absent TASK-209 provider and TASK-210 reviews remain historical only', () => {
    assert(!tasks.some(t => ['TASK-209', 'TASK-210'].includes(t.id)));
    assert(selected.annex.providers.some(p => p.id === 'TASK-209'));
    assert(!Object.hasOwn(selected.candidate.runReferences, 'TASK-209'));
    for (const id of ['TASK-209', 'TASK-210']) {
        assert(selected.annex.reviews.some(r => r.id.startsWith(id + '/')));
        assert(!selected.candidate.reviews.some(r => r.id.startsWith(id + '/')));
    }
});
test('G11 uses definition-bound historical provider rather than current TASK-230', () => {
    const provider = selected.annex.providers.find(p => p.id === 'TASK-230');
    const clauses = selected.candidate.reviews.find(r => r.id === 'G11').clauses.filter(c => c.disposition === 'reviewed');
    assert(clauses.length);
    assert(clauses.some(c => c.runTask === C.providerKey(provider)));
    assert(clauses.every(c => c.runTask !== 'TASK-230'));
});
test('changed criterion with same task number is rejected', () => {
    const altered = structuredClone(tasks);
    altered.find(t => t.id === 'TASK-230').acceptance_criteria[0] += ' changed';
    assert.throws(() => C.validate(altered, research, selected.candidate, selected.annex), /changed-current-targets/);
});
test('historical run redirected to current task is rejected', () => {
    const candidate = structuredClone(selected.candidate);
    candidate.reviews.find(r => r.id === 'G11').clauses.find(c => c.disposition === 'reviewed').runTask = 'TASK-230';
    assert.throws(() => C.validate(tasks, research, candidate, selected.annex), /unexpected-reconciliation-change/);
});
test('original historical task catalog still normalizes without invented targets', () => {
    const old = A.read('artifacts/TASK-225/review-45/consumer/task-input.json');
    const result = C.prepare(old, research);
    assert(C.validate(old, research, result.candidate, result.annex));
    assert.equal(result.candidate.reviews.length, 198);
});
console.log('PASS catalog identity tests=' + count + ' gameplayClosures=0');
