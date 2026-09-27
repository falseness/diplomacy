'use strict';
// Narrow archive adapter. Original proofPaths and all original bytes are bound;
// the unchanged production inspector and clause consumer decide validity.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const A = require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R = require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const H = require('./consume_historical_catalog');
const ORIGINAL = '/root/diplomacy/artifacts/TASK-211/green-07';
const COVERAGE = '5580af417e65f71de3811ecb46e569a528431e1f241017a326a1af7bcc349f98';
function inspect(tasks, prepared) {
    const provenance = A.read(path.join(prepared, 'provenance.json'));
    assert.equal(provenance.original, ORIGINAL, 'wrong-asset-provider');
    assert.equal(provenance.coverageSha256, COVERAGE, 'wrong-asset-coverage');
    assert.equal(A.hash(path.join(ORIGINAL, 'coverage-results.json')), COVERAGE, 'changed-asset-original');
    const selected = path.join(prepared, 'selected-211');
    const manifest = A.read(path.join(selected, 'evidence-hashes.json'));
    const files = directory => fs.readdirSync(directory, {withFileTypes:true}).flatMap(e =>
        e.isDirectory() ? files(path.join(directory,e.name)).map(n => e.name+'/'+n) : [e.name]).sort();
    assert.deepEqual(Object.keys(provenance.originalFiles).sort(), files(ORIGINAL), 'incomplete-original-binding');
    for (const [name, sha] of Object.entries(provenance.originalFiles)) {
        assert.equal(A.hash(path.join(ORIGINAL, name)), sha, 'changed-original:'+name);
        const copied = name === 'coverage-results.json' ? 'original-coverage.json' : name;
        assert.equal(A.hash(path.join(selected, A.proofKey(selected, copied, manifest))), sha, 'changed-copy:'+name);
    }
    const original = A.read(path.join(ORIGINAL, 'coverage-results.json'));
    const projected = structuredClone(original);
    for (const c of projected.cases) {
        assert(!c.proof && !c.proofs && c.proofPaths?.length, 'unsupported-proofPaths-contract');
        c.proofs = c.proofPaths;
    }
    assert.deepEqual(A.read(path.join(selected, 'coverage-results.json')), projected, 'invalid-asset-projection');
    assert.deepEqual(Object.keys(manifest).sort(), [...files(ORIGINAL), 'original-coverage.json', 'ac1-independent-review.json'].sort(), 'invalid-selected-files');
    const oracle = spawnSync('python3', [path.join(__dirname, 'prepare_asset_review.py'), '--', 'recompute'],
        {encoding:'utf8', timeout:60000, maxBuffer:8*1024*1024, env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(oracle.status, 0, 'asset-oracle-failed: '+oracle.stderr);
    const report = JSON.parse(oracle.stdout);
    assert.deepEqual(A.read(path.join(selected, 'ac1-independent-review.json')), report, 'changed-independent-review');
    for (const name of Object.keys(manifest)) A.proofKey(selected, name, manifest);
    const run = A.inspectRun(tasks.find(t => t.id === 'TASK-211'), selected);
    assert(run.historicalValid, 'asset-inspection: '+run.issues.join(','));
    return {run, report, manifest};
}
function consume(before, tasks, research, baseline, prepared, row) {
    const {run, report, manifest} = inspect(tasks, prepared);
    assert.equal(row.id, 'TASK-211/AC1', 'wrong-asset-owner');
    assert.equal(row.clauses.length, 1, 'wrong-asset-partition');
    const clause = row.clauses[0], proof = {file:'ac1-independent-review.json',sha256:manifest['ac1-independent-review.json']};
    assert.equal(clause.runTask, 'TASK-211', 'wrong-asset-run-owner');
    assert.equal(clause.tier, 'natural-browser', 'wrong-asset-tier');
    assert.deepEqual(clause.caseIds, ['cold-warm-delay','failed-recovery'], 'wrong-asset-cases');
    assert.deepEqual(clause.assertions, report.checks.map(c => ({id:c.id,expected:c.expected,proof})), 'incomplete-asset-assertions');
    assert.deepEqual(clause.contextIds, clause.caseIds.map(c => c+'/connected-contexts'), 'wrong-asset-contexts');
    const candidate = structuredClone(baseline);
    candidate.reviews[candidate.reviews.findIndex(r => r.id === row.id)] = row;
    const measured = {...before, runs:before.runs.map(r => r.task === run.task ? run : r)};
    const after = H.consume(measured, tasks, research, candidate, [{key:'TASK-211',id:'TASK-211'}]);
    const target = after.criteria.find(r => r.id === row.id);
    assert.equal(target.status, run.currentSourceValid ? 'covered-current' : 'reviewed-historical', target.reason || 'asset-transition-failed');
    return after;
}
module.exports = {inspect, consume};
