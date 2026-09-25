#!/usr/bin/env python3
"""Link retained TASK-231 failures to raw regression observations for TASK-225.

This is a prerequisite review, not an evidence-tier supplement or full audit.
Historical sources are recorded as historical; TAP success never establishes
the old timeout bound or natural-clock/browser/persistence semantics.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

from review_fast_archive import digest, review
from prepare_fast_receipts import validate_selection


FAILURES = [
    ('missing-discovery-path', 'ENOENT:', 2, 'harness', 'fs.existsSync'),
    ('missing-browser', "browserType.launch: Executable doesn't exist", 2, 'harness', 'PLAYWRIGHT_BROWSERS_PATH'),
    ('generation-version', 'Co-op typed portals require version-4 generation metadata', 8, 'fixture', 'prepareMechanicsMap'),
    ('map-dimensions', 'tiny-dimensions-0', 1, 'fixture oracle', 'tiny:14'),
    ('portal-category', 'invalid portal category', 1, 'fixture', "new DemonPortal(4,4,'melee')"),
    ('missing-roster', "Cannot read properties of undefined (reading 'some')", 1, 'fixture', 'units:[],towns:[]'),
    ('vm-redeclaration', "Identifier 'map' has already been declared", 3, 'harness', 'var map=new GameMap'),
    ('missing-map-oracle', 'expectedMap is not a function', 1, 'harness', None),
    ('legacy-wave', 'Unsupported co-op wave metadata', 1, 'fixture', '-        gameSettings.coop.waveGeneration='),
    ('salary-oracle', 'human 1 balance', 5, 'economy oracle', 'const paid=player===count||mode'),
    ('salary-oracle-human2', 'human 2 balance', 2, 'economy oracle', 'const paid=player===count||mode'),
    ('terminal-state', 'victory-peer-1-state', 1, 'fixture and UI oracle', 'menu:!!result,banner:[]'),
    ('page-readiness-timeout', 'page.waitForFunction: Timeout 15000ms exceeded.', 1, 'browser readiness', 'page.setDefaultTimeout(60000)'),
]


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def checked_proof(ref):
    path = Path(ref['file'])
    if not path.is_file() or digest(path) != ref['sha256']:
        raise ValueError('changed-or-missing-proof:' + str(path))
    return path


def validate(report):
    """Recheck frozen bytes, exact failure blocks and exact regression markers."""
    if Counter(row['kind'] for row in report['failures']) != Counter({f[0]:f[2] for f in FAILURES}):
        raise ValueError('incomplete-original-failure-selection')
    if len({row['id'] for row in report['failures']}) != 29:
        raise ValueError('duplicate-original-failure')
    for ref in report['proofs']:
        checked_proof(ref)
    for row in report['failures']:
        if [r['kind'] for r in row['regressions']] != ['historical-positive','current-positive']:
            raise ValueError('incomplete-regression-selection')
        text = checked_proof(row['historicalLog']).read_text()
        if row['failureBlock'] not in text or row['marker'] not in row['failureBlock']:
            raise ValueError('missing-original-failure:' + row['id'])
        for ref in row['regressions']:
            # A substring search would accept "not ok 1" for marker "ok 1".
            if ref['marker'] not in checked_proof(ref).read_text().splitlines():
                raise ValueError('missing-regression:' + row['id'])
    for check in report['checks']:
        if not check['pass'] or check['expected'] != check['observed']:
            raise ValueError('failed-independent-check:' + check['id'])
    if report['criterionCovered'] or report['naturalBrowserCoverage']:
        raise ValueError('unsupported-coverage-promotion')
    return True


def build(history, archive, selected, patch):
    history, archive, selected, patch = [Path(p).resolve(strict=True) for p in (history, archive, selected, patch)]
    review(archive)
    validate_selection(selected)
    original = history / 'green-05'
    review(original, require_current=False)
    proofs, checks, rows = {}, [], []

    def ref(p, **extra):
        p = Path(p).resolve(strict=True)
        record = dict(file=str(p), sha256=digest(p))
        proofs[str(p)] = record
        return dict(record, **extra)

    def check(name, expected, observed):
        if expected != observed:
            raise ValueError('regression-review:' + name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    for root in [archive, selected, original]:
        ref(root / 'source-identities.json')
        ref(root / 'evidence-hashes.json')
    repair = patch.read_text()
    ref(patch)
    counts = Counter()
    for log in sorted(history.glob('repro-*/focused/children/*/stdout.log')):
        blocks = re.findall(r'^not ok .*?(?=^  \.\.\.)', log.read_text(), re.M | re.S)
        for block in blocks:
            kinds = [f for f in FAILURES if f[1] in block]
            if len(kinds) != 1:
                raise ValueError('unclassified-failure:' + str(log))
            kind, marker, _, tier, repair_marker = kinds[0]
            counts[kind] += 1
            case = block.splitlines()[0].split(' - ', 1)[1]
            suite = re.search(r"location: '[^']+/(tests/[^':]+):", block).group(1)
            parent = log.parents[2]
            sources = json.loads((parent / 'source-identities.json').read_text())['before']
            regressions = []
            for root in [original, archive]:
                children = json.loads((root / 'child-results.json').read_text())['children']
                child, = [c for c in children if c['file'] == suite]
                raw = Path(child['stdoutPath'])
                positive, = [line for line in raw.read_text().splitlines()
                             if re.match(r'^ok \d+ - ', line) and line.endswith(' - ' + case)]
                regressions.append(ref(raw, marker=positive, kind='historical-positive' if root == original else 'current-positive'))
                check(str(log.relative_to(history)) + '/' + case + '/' + root.name, 0, child['exitCode'])
            repair_present = repair_marker is not None and repair_marker in repair
            rows.append(dict(id=str(log.relative_to(history)) + '/' + case,
                kind=kind, marker=marker, classification=tier, failureBlock=block,
                historicalLog=ref(log), historicalSourceIdentity=ref(parent / 'source-identities.json'),
                historicalTestSha256=sources['server']['files'][suite],
                historicalHeads={k:v['head'] for k,v in sources.items()},
                repair=dict(proof=ref(patch), marker=repair_marker, present=repair_present),
                regressions=regressions,
                limitations=['TAP links execution only; independent observations are listed separately.']))
    check('exact-original-failure-counts', {f[0]:f[2] for f in FAILURES}, dict(counts))

    # Independent literal fixture arithmetic, not archived expected-value reuse.
    childroot = archive / 'focused/children'
    timer = next(childroot.glob('*disconnect-timer/stdout.log'))
    ref(timer)
    observations = [json.loads(line[2:]) for line in timer.read_text().splitlines() if line.startswith('# {')]
    def observed(name, expected):
        row, = [r for r in observations if r.get('scenario') == name]
        check(name + '/declared', expected, row['expected'])
        check(name + '/observed', expected, row['observed'])
    for count in [2, 4]:
        for mode in ['sequential', 'parallel']:
            label = f'{mode}-{count}'
            observed(label + '-components', [list(range(1,count+1))] if mode == 'sequential' else [[i] for i in range(1,count+1)])
            for player in range(1, count+1):
                for stage in ['expired', 'rejoined']:
                    # Each human starts at 100. One stationary noob costs 1.
                    # Sequential reconnect starts the next actor (wrap -> human 1).
                    # Parallel reconnect at final completion starts the next batch.
                    salaries = []
                    for owner in range(1, count+1):
                        paid = int(mode == 'parallel' or owner <= player + (stage == 'rejoined'))
                        if stage == 'rejoined' and player == count and (mode == 'parallel' or owner == 1):
                            paid += 1
                        salaries.append(100-paid)
                    observed(f'{label}-{stage}-client-{player}-economy', dict(balances=[0,*salaries,0],assets=[]))
    online = next(childroot.glob('*browser-online/evidence/browser-checkpoints.json'))
    ref(online)
    online_rows = json.loads(online.read_text())['checkpoints']
    check('online-exact-peer-count', 2, len(online_rows))
    generation = dict(version=4,playerCount=2,seed=1,size='tiny',options=dict(seed=1,size='tiny'))
    for i, row in enumerate(online_rows):
        check(f'online-peer-{i}', dict(index=i,size='tiny',expected=generation,observed=generation),
              {k:row[k] for k in ['index','size','expected','observed']})
    snapshots = online.parent / 'tiny-snapshots.json'
    ref(snapshots)
    boards = json.loads(snapshots.read_text())
    check('online-raw-peer-count', 2, len(boards['peers']))
    for i, board in enumerate(boards['peers']):
        check(f'online-raw-generation-{i}', generation, board['generation'])
        check(f'online-raw-dimensions-{i}', [14] * 15,
              [len(board['grid']), *[len(row) for row in board['grid']]])
    check('online-raw-peer-convergence', boards['peers'][0], boards['peers'][1])
    check('online-raw-reconnect', boards['peers'][0], boards['reconnected'])
    reconnect = next(childroot.glob('*browser-reconnect/evidence/browser-checkpoints.json'))
    ref(reconnect)
    reconnect_rows = json.loads(reconnect.read_text())['checkpoints']
    names = ['disconnected-stale','committed-deaths','offline-retains-stale','reconnected-peer-1','reconnected-peer-2'] + [f'{r}-peer-{i}' for r in ['victory','defeat','draw'] for i in [1,2]]
    check('exact-reconnect-observations', names, [r['checkpoint'] for r in reconnect_rows])
    for row in reconnect_rows:
        name = row['checkpoint']
        result = next((r for r in ['victory','defeat','draw'] if name.startswith(r)), None)
        dead = name in ['committed-deaths','reconnected-peer-1','reconnected-peer-2'] or result in ['victory','draw']
        expected = dict(revision=int(name in ['committed-deaths','reconnected-peer-1','reconnected-peer-2']),
                        result=result,demonAlive=not dead,portalAlive=not dead,menu=result is not None,banner=[])
        check(name + '/declared', expected, row['expected'])
        check(name + '/observed', expected, row['observed'])

    # These source restrictions survive any review of execution receipts.
    sources = json.loads((archive / 'source-identities.json').read_text())['before']
    restrictions = []
    for suite, markers in {
        'browser-online': ['timer.pauseAndSaveTime()', 'grid.arr[0][0].hexagon.playerColor='],
        'browser-reconnect': ['timer.pauseAndSaveTime()', 'size:{x:45,y:11}', 'page.setDefaultTimeout(60000)'],
        'disconnect-timer': ['x:45,y:11', 'Timer.check'],
    }.items():
        file = 'tests/coop/' + suite + '.test.js'
        source = Path(sources['server']['repo']) / file
        check('tested-source/' + file, sources['server']['files'][file], digest(source))
        ref(source)
        for marker in markers:
            check('scope-marker/' + suite + '/' + marker, True, marker in source.read_text())
        restrictions.append(dict(suite=suite, proof=ref(source), markers=markers,
                                 disposition='controlled fixture; not natural-time or real MongoDB'))
    report = dict(kind='TASK-231 AC2 reproduction-to-regression prerequisite review',
        criterionCovered=False,naturalBrowserCoverage=False,failures=rows,checks=checks,
        proofs=list(proofs.values()), historicalFailureCount=len(rows),
        coverageReview=dict(criterion='TASK-231/AC4',covered=False,
            declaredJourneys=json.loads((archive/'verification-plan.json').read_text())['browserJourneys'],
            restrictions=restrictions,
            missing='No unchanged-clock/unchanged-board focused browser observation. The 45x11 fixtures are not the tiny 14x14 generated map. Reuse of two contexts across four reconnect fixtures is not four natural gameplay outcomes.',
            experiment='Reuse existing TASK-224/TASK-230/TASK-245 real proof only for matching workflows; missing disconnect/expiry/reconnect boundaries need a declared valid initial fixture, real services and an unpaused client clock. Keep four journeys maximum and two humans unless separate components require four.'),
        limitations=['Focused browser timers are paused; reconnect uses runtime mutation; memory database is not MongoDB.',
                     'Passing TAP and corrected oracle checks do not establish the original 15000ms readiness threshold.'],
        missing=[dict(id='page-readiness-original-bound',
            proof=next(r['historicalLog'] for r in rows if r['kind']=='page-readiness-timeout'),
            condition='repro-07 failed at the menu/assets readiness wait with Timeout 15000ms; repair raises page default to 60000ms. Current evidence lacks per-wait elapsed time.',
            experiment='One focused two-context reconnect journey with the original 15000ms readiness bound explicitly enforced and timestamped; preserve original sources and all state assertions. No full-profile replay or timeout increase.'),
            dict(id='map-oracle-repair-provenance',
            condition='repro-05 expectedMap is not a function has current passing regression but no corresponding change in the TASK-231 repair commit diff.',
            experiment='Identify the exact helper/export repair from saved source bytes or prior commits and link its tested hash; do not invent historical source bytes.')])
    validate(report)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ['history','archive','selected','patch','output']:
        p.add_argument(key)
    a = p.parse_args()
    result = build(a.history,a.archive,a.selected,a.patch)
    save(a.output,result)
    print(f"PASS linkage review original_failures={len(result['failures'])} independent_checks={len(result['checks'])}")
    print('UNRESOLVED TASK-231/AC2: original-readiness-bound and map-oracle repair provenance; no criterion closure')
