#!/usr/bin/env python3
"""Persist the complete retained TASK-211/AC1 review, never current coverage."""
import argparse
import json
import re
import shutil
from pathlib import Path
from review_asset_archive import review as assets, sha, CASES, DEP

ARCHIVE = Path('/root/diplomacy/artifacts/TASK-211/green-07')
MANIFEST = '5580af417e65f71de3811ecb46e569a528431e1f241017a326a1af7bcc349f98'


def review(archive=ARCHIVE, manifest_sha256=MANIFEST):
    archive = Path(archive).resolve(strict=True)
    result = assets(archive, manifest_sha256)
    manifest = json.loads((archive/'coverage-results.json').read_text())['evidenceHashes']
    checks, proofs = result['checks'], result['proofs']

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('asset-clause: '+name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    def read(name, lines=False):
        p = archive/name
        check('binding/'+name, manifest[name], sha(p))
        proofs[name] = sha(p)
        return [json.loads(l) for l in p.read_text().splitlines()] if lines else json.loads(p.read_text())

    identities = read('source-identities.json')['after']
    source = {}
    for role, name in [('client', 'index.html'), ('server', 'tests/reliability/helpers/assets-browser.js')]:
        p = Path(identities[role]['repo'])/name
        check('instrumentation/'+name, identities[role]['files'][name], sha(p))
        source[str(p)] = sha(p)
    html = Path(identities['client']['repo'], 'index.html').read_text()
    dependencies = re.findall(r'<script[^>]+src="(https[^\"]+)"', html)
    check('shipped-dependency-count', 3, len(dependencies))
    events = read('asset-events.jsonl', True)
    requests = read('asset-requests.jsonl', True)
    checkpoints = read('checkpoints.json')['checkpoints']
    for case in CASES:
        rows = [r for r in requests if r['id'] == case and r['player'] == case+'-p1']
        for phase in (['cold', 'warm'] if case == CASES[0] else ['cold', 'recovered']):
            for url in dependencies:
                if case == CASES[1] and phase == 'cold' and url == DEP:
                    continue
                found = [r for r in rows if r['url'] == url and r.get('observedPhase') == phase and r.get('status') == 200]
                check(case+'/'+phase+'/dependency/'+url, True, bool(found) and all(r['bytes'] > 0 for r in found))
        case_events = [e for e in events if e['id'] == case]
        admission = [e for e in case_events if e['stage'] == 'admission']
        check(case+'/admitted-identities', [[{'identity': 0, 'slot': 1}, {'identity': 1, 'slot': 2}]], [e['assigned'] for e in admission])
        for player in [case+'-p1', case+'-p2']:
            packet = [e for e in case_events if e['stage'] == 'wire' and e['player'] == player and e.get('event') == 'playYourTurn' and e['direction'] == 'received']
            check(player+'/connected-packets', True, bool(packet))
            read(case+'/'+player+'-assets.json')
        cp = next(c for c in checkpoints if c['id'] == case+'/participants')
        check(case+'/connected-contexts', 2, cp['observed']['contexts'])
        check(case+'/persisted-identities', 2, cp['observed']['persisted'])
    for name, expected in [('failed-recovery/dependency-failure', {'failed': True, 'io': 'undefined'}),
                           ('failed-recovery/dependency-recovered', 'function')]:
        cp = next(c for c in checkpoints if c['id'] == name)
        check(name+'/observed', expected, cp['observed'])
    return dict(checks=checks, proofs=proofs, sourceReaders=source,
                semanticScope='Complete TASK-211/AC1 only; retained shipped-browser asset startup observations.',
                fullAuditReady=False, currentSourceValid=result['currentSourceValid'],
                sourceMismatches=result['sourceMismatches'])


def prepare(output, tasks, archive=ARCHIVE, manifest_sha256=MANIFEST):
    archive = Path(archive).resolve(strict=True)
    output = Path(output)
    output.mkdir(exist_ok=False)
    report = review(archive, manifest_sha256)
    selected = output/'selected-211'
    shutil.copytree(archive, selected)
    original = json.loads((archive/'coverage-results.json').read_text())
    shutil.copyfile(archive/'coverage-results.json', selected/'original-coverage.json')
    projected = json.loads(json.dumps(original))
    for case in projected['cases']:
        assert 'proof' not in case and 'proofs' not in case
        case['proofs'] = case['proofPaths']
    save = lambda p, x: p.write_text(json.dumps(x, indent=2)+'\n')
    save(selected/'coverage-results.json', projected)
    save(selected/'ac1-independent-review.json', report)
    manifest = {str(p.relative_to(selected)): sha(p) for p in selected.rglob('*') if p.is_file()}
    save(selected/'evidence-hashes.json', manifest)
    task = next(t for t in json.loads(Path(tasks).read_text()) if t['id'] == 'TASK-211')
    text = task['acceptance_criteria'][0]
    import hashlib
    ref = lambda n: dict(file=n, sha256=manifest[n])
    milestones = [c['id'] for c in report['checks'] if c['id'].endswith(('/connected-contexts', '/observed', '/delay-at-least-1000ms', '/online-logic-cached'))]
    row = dict(id='TASK-211/AC1', targetSha256=hashlib.sha256(text.encode()).hexdigest(),
        reviewer='Independent asset oracle with validated proofPaths archive adapter', clauses=[dict(
        text=text, disposition='reviewed', runTask='TASK-211', tier='natural-browser', caseIds=list(CASES),
        sourceIdentity=ref('source-identities.json'), proofs=[ref(n) for n in report['proofs']]+[ref('ac1-independent-review.json')],
        assertions=[dict(id=c['id'], expected=c['expected'], proof=ref('ac1-independent-review.json')) for c in report['checks']],
        traces=[ref('asset-requests.jsonl'), ref('asset-events.jsonl')], milestoneIds=milestones,
        contextIds=[c+'/connected-contexts' for c in CASES],
        reason='All AC1 startup clauses reviewed against retained raw asset, cache, failure and browser context observations. Stale source hashes require refresh.',
        derivation='Expected URLs derive from hash-matching shipped HTML. Browser instrumentation was inspected: CDP continues delayed requests and aborts the failed URL, never fulfills replacement bytes. Raw requests bind HTML and local scripts to tested hashes; dependency phases, cache receipts, undefined io at failure, recovery, two labeled inbound packet streams and recorded context counts are checked independently of pass flags.',
        followUp=dict(scope='After affected sources freeze, refresh only the bounded assets provider and repeat this exact AC1 review and consumer transition.',
            acceptance='Same two asset cases, full traces/context/milestone checks, exact shipped sources, zero exits and owned cleanup; consume as covered-current only when source hashes match.',
            targetMs=900000, stopWorkMs=3300000, budgetMs=3600000))])
    save(output/'review.json', row)
    save(output/'provenance.json', dict(original=str(archive), coverageSha256=manifest_sha256,
        originalFiles={str(p.relative_to(archive)): sha(p) for p in archive.rglob('*') if p.is_file()},
        transformation='Only coverage.cases[*].proofs aliases original proofPaths; original-coverage.json retained byte-identically.'))
    print('PASS prepared TASK-211/AC1 checks='+str(len(report['checks'])))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('output'); p.add_argument('tasks', nargs='?')
    p.add_argument('--archive', default=str(ARCHIVE)); p.add_argument('--manifest-sha256', default=MANIFEST)
    a = p.parse_args()
    if a.tasks:
        prepare(a.output, a.tasks, a.archive, a.manifest_sha256)
    else:
        print(json.dumps(review(a.archive, a.manifest_sha256)))
