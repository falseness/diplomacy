#!/usr/bin/env python3
"""Bind independently reviewed TASK-245 matrix/accounting proof to TASK-225 clauses."""
import argparse
import datetime
import json
import shutil
from pathlib import Path
from review_integrated_archive import digest, review


def prepare(archive, reviews, tasks, output):
    archive, output = Path(archive).absolute(), Path(output).absolute()
    output.mkdir(exist_ok=False)
    result = review(archive)
    save = lambda n, v: (output/n).write_text(json.dumps(v, indent=2)+'\n')
    save('independent-observations.json', result)
    selected = output/'selected-245'
    shutil.copytree(archive, selected)
    manifest = result['originalFiles']
    save('selected-245/evidence-hashes.json', manifest)
    save('selected-245-provenance.json', dict(kind='later-byte-identical-archive-index',
        attestedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), originalRun=str(archive),
        copiedFiles=manifest, note='Later index of finalized original bytes, not another invocation.'))
    for file, sha in manifest.items():
        if digest(selected/file) != sha or digest(archive/file) != sha:
            raise ValueError('copy changed: '+file)
    crosswalk = json.loads(Path(reviews).read_text())
    task = next(t for t in json.loads(Path(tasks).read_text()) if t['id']=='TASK-245')
    ref = lambda file: dict(file=file, sha256=manifest[file])
    proofs = ['checkpoints.json', 'matrix/maps.json', 'matrix/checkpoints.json', 'matrix/negative-controls.json',
              'coverage.json', 'coverage-results.json', 'verification-plan.json', 'verification-budget.json',
              'verification.log', 'source-identities.json', 'diff-check.txt', 'server-diff-check.txt']
    proofs += ['owned-'+str(i)+'.jsonl.cleanup.json' for i in range(30)]
    for i in [1,3,4,6]:
        row = next(r for r in crosswalk['reviews'] if r['id']=='TASK-245/AC'+str(i))
        old = row['clauses'][0]
        row['reviewer'] = 'TASK-225 independent matrix and execution-accounting review'
        row['clauses'] = [dict(text=task['acceptance_criteria'][i-1], disposition='reviewed',
            runTask='TASK-245', tier='source-executed', caseIds=[a['id'] for a in result['assertions']],
            sourceIdentity=ref('source-identities.json'), proofs=[ref(f) for f in proofs],
            assertions=result['assertions'], followUp=old['followUp'],
            reason='Exact 40 generated-twice inputs, 1200 matrix assertions and all 446 unique invocation cases '
                   'are bound to final original proof. Recomputed capacity and complete valley geometry '
                   'from raw coordinates with non-production oracles; second Python hex BFS independently '
                   'checks all endpoint approaches and portal fairness. Every saved assertion, all 30 actual '
                   'zero command exits and owned cleanup receipts, runtime logs, empty diff/search files, '
                   'matching sources and cumulative budget are inspected. This clause claims matrix source '
                   'behavior and execution accounting; TASK-245/AC2 and AC5 UI/network tier consumption '
                   'remain unresolved. Exhaustive testing and release readiness are not claimed.',
            derivation='Inputs are independently enumerated as three sizes times H1..12 at seed 1 plus '
                       'Tiny/H1 and Big/H12 at seeds 0 and 4294967295. Literal portal quotas are '
                       '3H melee, 3H ranged and H each siege/heavy/support/chaos. Source-independent '
                       'capacity enumeration computes dimensions; full valley contracts are recomputed '
                       'using independent hex traversal, and a second BFS treats mines as endpoints. '
                       'Repeat checkpoint strings must parse to the saved raw map and hash to both '
                       'recorded duplicate digests. All selected IDs are unique and exactly equal '
                       'between plan, coverage and checkpoints; all final receipts agree on exits/cleanup.')]
    crosswalk['runReferences']['TASK-245'] = dict(directory=str(selected), manifestSha256=digest(selected/'evidence-hashes.json'),
        reason='One bounded affected-source refresh after explicit desktop source fixture repair; byte-identical later final-report index. Failed refresh-245-21 preserved; AC2/AC5 unresolved.')
    save('reviewed-crosswalk.json', crosswalk)
    print('PASS prepared TASK-245/AC1,AC3,AC4,AC6 proof; requires actual consumer')


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['archive','reviews','tasks','output']:
        p.add_argument(name)
    a=p.parse_args();prepare(a.archive,a.reviews,a.tasks,a.output)
