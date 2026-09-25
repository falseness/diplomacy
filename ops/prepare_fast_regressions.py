#!/usr/bin/env python3
"""Prepare TASK-231 AC2 only from original failures and a bounded readiness probe.

The selected parent is preserved, with later reviews explicitly separated from
its original invocation. Controlled fixture proof never closes AC4 or AC6.
"""
import argparse
import copy
import json
from pathlib import Path
import shutil

from prepare_fast_receipts import files, save, validate_selection
from review_fast_archive import digest
from review_fast_regressions import build
from review_fast_map_repair import review as map_review


def readiness_review(root, archive):
    root, archive = Path(root), Path(archive)
    rows = [json.loads(line) for line in (root / 'readiness-02.jsonl').read_text().splitlines()]
    if [(r['context'], r['page']) for r in rows] != [(c, p) for p in range(4) for c in range(2)]:
        raise ValueError('readiness:exact-eight-waits')
    if any(r['timeoutMs'] != 15000 or not r['passed'] or r.get('error') or
           not 0 <= r['elapsedMs'] <= 15000 for r in rows):
        raise ValueError('readiness:original-bound')
    receipt = json.loads((root / 'readiness-02-exit.json').read_text())
    if receipt['exit'] != 0 or '--test' not in receipt['command'] or receipt['command'][-1] != 'tests/coop/browser-reconnect.test.js':
        raise ValueError('readiness:command')
    if '--require=/root/diplomacy/ops/task225-readiness-preload.js' not in receipt['command']:
        raise ValueError('readiness:missing-instrumentation')
    cleanup = json.loads((root / 'readiness-02-owned.jsonl.cleanup.json').read_text())
    if cleanup['timedOut'] or not cleanup['cleanup'] or cleanup['remaining'] or cleanup['exit'] != 0:
        raise ValueError('readiness:cleanup')
    log = (root / 'readiness-02.log').read_text().splitlines()
    if 'ok 1 - actual browser reconnect preserves committed deaths and all peers show shared results' not in log:
        raise ValueError('readiness:regression')
    logged = [json.loads(line.split('TASK225_READINESS ', 1)[1]) for line in log if line.startswith('# TASK225_READINESS ')]
    if logged != rows:
        raise ValueError('readiness:raw-log-mismatch')
    current = json.loads((root / 'browser-02/browser-checkpoints.json').read_text())
    previous = json.loads(next((archive / 'focused/children').glob('*browser-reconnect/evidence/browser-checkpoints.json')).read_text())
    projection = lambda data: [{k: row[k] for k in ['checkpoint', 'expected', 'observed', 'assertions']} for row in data['checkpoints']]
    if current['consoleErrors'] or projection(current) != projection(previous):
        raise ValueError('readiness:changed-gameplay-assertions')
    return [dict(id=f'original-readiness-bound/{r["context"]}/{r["page"]}', expected=True,
                 observed=r['passed'] and r['elapsedMs'] <= 15000, **{'pass': True}) for r in rows]


def prepare(baseline, probe, output):
    baseline, probe, output = map(lambda p: Path(p).resolve(), (baseline, probe, output))
    if digest(baseline) != '642be2429cc24f63455d3deeea04ae96e2388e76aa2715bea82f5b06b522136b':
        raise ValueError('wrong-immutable-baseline')
    crosswalk = json.loads(baseline.read_text())
    selected = Path(crosswalk['runReferences']['TASK-231']['directory'])
    validate_selection(selected)
    archive = Path(json.loads((selected / 'selection-provenance.json').read_text())['originalArchive'])
    history = baseline.parents[3] / 'TASK-231'
    linkage = build(history, archive, selected, baseline.parents[2] / 'review-29/repair.patch')
    provenance = map_review(history, probe / 'retained-edit-records.json', '/root/diplomacy_server/tests/coop/browser-online.test.js')
    checks = linkage['checks'] + [dict(c, **{'pass': c['passed']}) for c in provenance['checks']]
    checks += readiness_review(probe, archive)
    output.mkdir(exist_ok=False)
    target = output / 'selected-231'
    shutil.copytree(selected, target)
    later = target / 'later-regression-review'
    later.mkdir()
    proofs, origins = [], []
    paths = {p['file'] for p in linkage['proofs'] + provenance['proofs']}
    paths.update(str(p) for p in probe.glob('readiness-02*') if p.is_file())
    paths.update(str(p) for p in (probe / 'browser-02').rglob('*') if p.is_file())
    paths.add('/root/diplomacy/ops/task225-readiness-preload.js')
    for i, name in enumerate(sorted(paths)):
        source = Path(name)
        dest = later / (str(i).zfill(3) + '-' + source.name)
        shutil.copyfile(source, dest)
        ref = dict(file=str(dest.relative_to(target)), sha256=digest(dest))
        proofs.append(ref)
        origins.append(dict(original=str(source), selected=ref,
            scope='later focused probe' if source.is_relative_to(probe) else 'retained proof; original source identity and historical/current role in linkage report'))
    report = dict(checks=checks, linkage=linkage, mapRepair=provenance, proofOrigins=origins,
                  criterion='TASK-231/AC2', note='Later review and separate readiness experiment, not an original parent receipt. No AC4/natural-browser/MongoDB promotion.')
    save(later / 'review.json', report)
    review_ref = dict(file=str((later / 'review.json').relative_to(target)), sha256=digest(later / 'review.json'))
    proofs.append(review_ref)
    manifest = files(target)
    manifest.pop('evidence-hashes.json')
    save(target / 'evidence-hashes.json', manifest)
    validate_selection(target)
    row = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-231/AC2')
    old = row['clauses'][0]
    text, remote = old['text'].split('TASK-230', 1)
    ac1 = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-231/AC1')['clauses'][0]
    row['reviewer'] = 'TASK-225 original failure linkage and original-bound focused regression review'
    row['clauses'] = [dict(text=text, disposition='reviewed', runTask='TASK-231', tier='local-fixture',
        sourceIdentity=copy.deepcopy(ac1['sourceIdentity']), caseIds=copy.deepcopy(ac1['caseIds']),
        proofs=proofs, assertions=[dict(id=c['id'], expected=c['expected'], proof=review_ref) for c in checks],
        reason='All 29 original failures retain original and current selected-case positives. Two exact reconstructed historical source hashes prove the transient map repair. A separate unchanged reconnect suite passes all eight original 15000ms readiness waits and eleven state checkpoints. Controlled fixtures remain explicitly limited.',
        derivation='Recompute 158 original linkage and independent arithmetic/state observations, reconstruct both original map sources against archived SHA-256, and compare eight instrumented raw wait records plus unchanged gameplay assertions. Bind every original failure, historical source, repair and current positive as separate contained proof. No source or evidence transplant into the original archive.',
        followUp=old['followUp'])]
    remote_clause = copy.deepcopy(next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-230/AC2')['clauses'][0])
    remote_clause['text'] = 'TASK-230' + remote
    remote_clause['reason'] = 'Retain independently reviewed TASK-230 remote fixture evidence and independent expected-state derivation.'
    row['clauses'].append(remote_clause)
    crosswalk['runReferences']['TASK-231'] = dict(directory=str(target), manifestSha256=digest(target / 'evidence-hashes.json'),
        reason='Same immutable parent and receipt selection, plus explicitly later regression review/probe; original evidence retained unchanged.')
    save(output / 'reviewed-crosswalk.json', crosswalk)
    print(f'PASS prepared AC2 checks={len(checks)} bound_proofs={len(proofs)}; actual consumer required; AC4 unchanged')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['baseline', 'probe', 'output']:
        p.add_argument(name)
    a = p.parse_args()
    prepare(a.baseline, a.probe, a.output)
