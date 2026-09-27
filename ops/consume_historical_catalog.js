'use strict';
// Legacy tier validators require their original task labels. Resolve a validated
// historical identity only for the individual review, never in global run lookup.
const assert = require('node:assert/strict');
const R = require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
function consume(report, tasks, research, candidate, providers) {
    const bindings = new Map(providers.map(p => [p.key, p.id]));
    const results = R.targets(tasks, research).map(target => {
        const row = candidate.reviews.find(r => r.id === target.id);
        const previous = [...report.criteria, ...report.researchGaps].find(r => r.id === target.id);
        if (!row.clauses.some(c => bindings.has(c.runTask))) return previous;
        const projected = structuredClone(row), selected = [];
        for (const clause of projected.clauses.filter(c => c.disposition === 'reviewed')) {
            const key = clause.runTask, run = report.runs.find(r => r.task === key);
            assert(run, 'missing-bound-provider:' + key);
            clause.runTask = bindings.get(key) || key;
            // Reject two definitions competing for the same legacy lookup label.
            const prior = selected.find(r => r.task === clause.runTask);
            assert(!prior || prior.directory === run.directory, 'ambiguous-provider-label');
            if (!prior) selected.push({...run, task: clause.runTask});
        }
        const result = R.disposition(target, projected, selected, tasks);
        // Keep the externally reviewable definition-bound names in the report.
        if (result.clauses) result.clauses.forEach((c, i) => {
            if (row.clauses[i].runTask) c.runTask = row.clauses[i].runTask;
        });
        return result;
    });
    // Recompute only summaries of actual consumer results. No disposition or
    // source-validity flag is manufactured by the identity adapter.
    const unresolved = results.filter(r => !['covered-current', 'deferred-public', 'partially-deferred'].includes(r.status));
    const prior = unresolved.filter(r => r.task !== 'TASK-225');
    const unexplained = results.filter(r => !r.explained).map(r => r.id);
    return {...report,
        criteria: results.filter(r => r.task), researchGaps: results.filter(r => !r.task),
        selfChecks: results.filter(r => r.task === 'TASK-225'),
        unresolvedPriorArchives: prior.map(r => r.id), unresolvedRequiredLocal: unresolved.map(r => r.id),
        unexplainedGaps: unexplained,
        priorArchivesComplete: report.inputIssues.length === 0 && prior.length === 0,
        pass: report.inputIssues.length === 0 && unresolved.length === 0,
        auditComplete: report.inputIssues.length === 0 && unexplained.length === 0,
        scenarioCoverageComplete: unresolved.length === 0 && results.every(r => r.covered),
        followUps: results.flatMap(r => (r.clauses || []).flatMap((c, index) =>
            ['unresolved-local', 'reviewed-historical'].includes(c.status) ? [{id: r.id, index, text: c.text, status: c.status, ...c.followUp}] : [])),
        clauseDispositions: results.flatMap(r => (r.clauses || []).map((c, index) =>
            ({target: r.id, index, text: c.text, status: c.status, covered: c.status === 'covered-current', dependencies: c.dependencies || []}))),
    };
}
module.exports = {consume};
