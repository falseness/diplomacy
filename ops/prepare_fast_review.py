#!/usr/bin/env python3
"""Bind TASK-231 execution clauses to original proof; no gameplay tier promotion."""
import argparse
import json
from pathlib import Path

from review_fast_archive import digest, review


def prepare(archive, reviews, output):
    archive = Path(archive).resolve(strict=True)
    output = Path(output).resolve()
    output.mkdir(exist_ok=False)
    result = review(archive)
    (output / 'independent-execution-review.json').write_text(json.dumps(result, indent=2) + '\n')
    manifest = json.loads((archive / 'evidence-hashes.json').read_text())
    crosswalk = json.loads(Path(reviews).read_text())
    ref = lambda name: dict(file=name, sha256=manifest[name])
    checkpoint = 'fast/children/001-reliability_fast-opening/evidence/coop/checkpoints.json'
    report = json.loads((archive / checkpoint).read_text())
    # Fixed invocation shape, not producer-derived gameplay arithmetic.
    assertions = []
    for name in ['coop:participants', 'coop:connected-contexts', 'coop:distinct-contexts']:
        rows = [c for c in report['checkpoints'] if c['id'] == name]
        if len(rows) != 1 or rows[0] != dict(id=name, expected=2, observed=2, **{'pass':True}):
            raise ValueError('missing exact two-human execution checkpoint: ' + name)
        assertions.append(dict(id=name, expected=2, proof=ref(checkpoint)))
    proof_names = ['verification-plan.json', 'child-results.json', 'coverage-results.json',
                   'discovery-manifest.json', 'source-identities.json',
                   'fast-owned.jsonl.cleanup.json', 'focused-owned.jsonl.cleanup.json']
    for child in json.loads((archive / 'child-results.json').read_text())['children']:
        for key in ['stdoutPath', 'stderrPath']:
            proof_names.append(str(Path(child[key]).resolve().relative_to(archive)))
    for index in [1]:
        row = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-231/AC' + str(index))
        old = row['clauses'][0]
        text = ''.join(c['text'] for c in row['clauses'])
        row['reviewer'] = 'TASK-225 independent exact-selection/raw-TAP execution review'
        row['clauses'] = [dict(text=text, disposition='reviewed', runTask='TASK-231',
            tier='source-executed', caseIds=result['cases'], sourceIdentity=ref('source-identities.json'),
            proofs=[ref(n) for n in proof_names], assertions=assertions, followUp=old['followUp'],
            reason='Checks complete bounded execution, all nine children and thirty literal cases, '
                   'raw TAP, zero exits/skips, retained exhaustive discovery, exact sources and '
                   'identity-checked cleanup. This criterion concerns execution evidence; this '
                   'review does not independently certify gameplay semantics or promote any '
                   'source fixture to HTTPS/MongoDB/browser coverage. AC2/AC3/AC4/AC5 remain unresolved.',
            derivation='Independently fixed selection: six fast suites with 24 cases and three '
                       'focused suites with six cases. Compare literal names to both plan and '
                       'raw TAP; every selected child must exit zero without skips, cancellation '
                       'or failures. Both top-level commands share the start+3300000 deadline. '
                       'Two humans imply two participants and two distinct connected contexts. '
                       'All recorded sources must hash to current files; archived plans/results '
                       'and child logs are directly consumed, with later read-only review separate.')]
    crosswalk['runReferences']['TASK-231'] = dict(directory=str(archive),
        manifestSha256=digest(archive / 'evidence-hashes.json'),
        reason='One dependency-justified bounded refresh: 16 recorded source files changed since '
               'green-05. Original archive and failed reproductions remain immutable. '
               'Only execution criterion AC1 is reviewed; remaining semantics stay unresolved.')
    (output / 'reviewed-crosswalk.json').write_text(json.dumps(crosswalk, indent=2) + '\n')
    print('PASS prepared TASK-231 AC1 execution review; actual inventory consumption required')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ['archive', 'reviews', 'output']:
        p.add_argument(key)
    a = p.parse_args()
    prepare(a.archive, a.reviews, a.output)
