"""Inspect archived AC3/lifecycle sufficiency; never emit coverage credit.

The movement oracle uses recorded input coordinates, not archived expectations.
This reads historical evidence only; it does not run a browser or a consumer.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path('/root/diplomacy')
SERVER = Path('/root/diplomacy_server')
ARCHIVE = ROOT / 'artifacts/TASK-221/green-12'
CASES = ['terminal-victory', 'terminal-draw', 'terminal-to-coop', 'terminal-to-competitive']


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def review_move(mode, inputs, trace, checkpoints):
    checks = []

    def check(name, expected, observed):
        assert expected == observed, name
        checks.append(dict(id=mode + '/' + name, expected=copy.deepcopy(expected),
                           observed=copy.deepcopy(observed), pass_=True))

    def one(rows, label):
        check(label + '/count', 1, len(rows))
        return rows[0]

    for player in ['p1', 'p2']:
        positions = []
        for label in ['return from finished game', 'next online game', 'new game start', 'new game slot']:
            pos, row = one([(i, r) for i, r in enumerate(inputs)
                            if r.get('player') == player and r.get('label') == label], player + '/' + label)
            check(player + '/' + label + '/input', ['tap', 'mouse.click'], [row['action'], row['via']])
            positions.append(pos)
        check(player + '/menu-order', sorted(positions), positions)
        check(player + '/menu-socket-closed', True, checkpoints[player + '/menu-socket-closed']['observed'])
    check('participants', 2, checkpoints['new-participants']['observed'])
    row = one([r for r in trace if r.get('stage') == 'next-game'], 'next-game')
    check('mode', mode, row['mode'])
    coords = []
    for label in ['select new game unit', 'first legal move in next game']:
        event = one([r for r in inputs if r.get('label', '').startswith(label + ' cell=')], label)
        check(label + '/real-input', ['p1', 'tap', 'mouse.click'], [event['player'], event['action'], event['via']])
        coords.append(tuple(map(int, re.fullmatch(re.escape(label) + r' cell=(\d+),(\d+)', event['label']).groups())))
    source, target = coords
    # Exact selected legal first moves are declared, not inferred from expected.
    check('selected-move', ((2, 11), (1, 10)) if mode == 'coop' else ((3, 10), (2, 10)), (source, target))
    expected = copy.deepcopy(row['before'])
    unit = one([u for u in expected['players'][1]['units'] if (u['x'], u['y']) == source], 'moving-unit')
    check('opening-unit', ['noob', 2, 2], [unit['name'], unit['hp'], unit['moves']])
    unit.update(x=target[0], y=target[1], moves=1)
    # localGameplay sorts entities by coordinate. There is exactly one own unit.
    check('own-unit-count', 1, len(expected['players'][1]['units']))
    for field in ['expected', 'observed']:
        check('first-move-' + field, expected, checkpoints['new-first-move'][field])
        check('callback-projection-' + field, expected, checkpoints['old-callbacks-new-board-unchanged'][field])
        check('trace-' + field, expected, row[field])
    check('old-timer-stopped', False, checkpoints['old-timer-stopped']['observed'])
    # This is only projected gameplay agreement. It does NOT prove raw registry,
    # recipient timers, socket identity, commit or callback execution coverage.
    return [{**{k: v for k, v in c.items() if k != 'pass_'}, 'pass': c['pass_']} for c in checks]


def inspect(out):
    out = Path(out)
    assert (out / 'verification-plan.json').is_file(), 'predeclared plan required'
    assert not (out / 'ac3-sufficiency.json').exists(), 'refuse overwrite'
    proofs, checks = {}, []

    def text(file):
        file = Path(file)
        proofs[str(file)] = sha(file)
        return file.read_text()

    def read(file):
        return json.loads(text(file))

    def check(name, expected, observed):
        assert expected == observed, name
        checks.append(dict(id=name, expected=copy.deepcopy(expected), observed=copy.deepcopy(observed), **{'pass': True}))

    def save(name, value):
        (out / name).write_text(json.dumps(value, indent=2) + '\n')

    coverage = read(ARCHIVE / 'coverage-results.json')
    for name, digest in coverage['evidenceHashes'].items():
        file = (ARCHIVE / name).resolve()
        assert file.is_relative_to(ARCHIVE.resolve()), 'archive path escape'
        proofs[str(file)] = sha(file)
        check('archive/' + name, digest, proofs[str(file)])
    ids = read(ARCHIVE / 'source-identities.json')
    sources = [('server', 'tests/reliability/helpers/terminal-flow-next-game.js'),
               ('server', 'tests/reliability/helpers/observations.js'),
               ('server', 'tests/reliability/helpers/observation-game.js')]
    pinned = {}
    for repo, name in sources:
        file = (ROOT if repo == 'client' else SERVER) / name
        pinned[name] = text(file)
        check('pinned/' + name, ids['after'][repo]['files'][name], proofs[str(file)])
    next_source = pinned[sources[0][1]]
    check('callback-observation-route', True, "check('old-callbacks-new-board-unchanged',expected,obs.localGameplay(await p.observe(OBSERVE)))" in next_source)
    check('callback-invocation-route', True, '__oldCallbacks.forEach(fn=>fn(body))' in next_source)
    check('filtered-killed-units', True, 'p.units.filter(u => !u.killed)' in pinned[sources[1][1]])
    check('mutating-getter-route', True, 'isLost: !!p.isLost' in pinned[sources[2][1]])
    checkpoint_rows = read(ARCHIVE / 'checkpoints.json')['checkpoints']
    for c in checkpoint_rows:
        check('serialized/' + c['id'], c['expected'], c['observed'])
    missing = []
    for mode in ['coop', 'competitive']:
        case = 'terminal-to-' + mode
        inputs = [json.loads(l) for l in text(ARCHIVE / case / 'input-trace.jsonl').splitlines()]
        trace = [json.loads(l) for l in text(ARCHIVE / case / 'network-traces.jsonl').splitlines()]
        prefix = case + '/next/'
        cks = {c['id'][len(prefix):]: c for c in checkpoint_rows if c['id'].startswith(prefix)}
        checks.extend(review_move(mode, inputs, trace, cks))
        missing.append(dict(case=case, file=str(ARCHIVE / 'checkpoints.json'),
                            field=prefix + 'old-callbacks-new-board-unchanged.{expected,observed}',
                            reason='Mutating OBSERVE followed by localGameplay strips killed entries, ownership/occupancy metadata, timers, recipient turn, commit and socket state; no passive raw pre/post capture.',
                            additionalProof='Retained callback event names/count and invocation receipts are absent; forEach alone cannot exclude an empty callback list.',
                            tier='retained callbacks are source-executed, not authenticated network replay'))
        print('PASS AC3 projected-first-move mode=' + mode)

    plan = read(ARCHIVE / 'verification-plan.json')
    budget = read(ARCHIVE / 'verification-budget.json')
    children = read(ARCHIVE / 'child-results.json')
    receipt = read(ARCHIVE / 'supervisor-result.json')
    check('lifecycle/cases', CASES, [c['id'] for c in plan['cases']])
    check('lifecycle/coverage-cases', CASES, [c['id'] for c in coverage['cases']])
    check('lifecycle/budget', [2700000, 3300000, 3600000], [budget['targetMs'], budget['stopWorkMs'], budget['budgetMs']])
    from datetime import datetime
    ms = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000
    check('lifecycle/elapsed', True, abs(ms(budget['finishedAt']) - ms(budget['startedAt']) - budget['elapsedMs']) < 2 and 0 < budget['elapsedMs'] < 3600000)
    check('lifecycle/receipt', [0, 0, True], [receipt['parentExit'], receipt['auditExit'], receipt['pass']])
    check('lifecycle/receipt-envelope', True, budget['elapsedMs'] <= receipt['elapsedMs'] < 3600000)
    check('lifecycle/children', 1, len(children['children']))
    child = children['children'][0]
    check('lifecycle/child-exit', [0, None, False], [child['exitCode'], child['signal'], child['timedOut']])
    check('lifecycle/tap', dict(tests=1, suites=0, pass_=1, fail=0, cancelled=0, skipped=0, todo=0),
          {('pass_' if k == 'pass' else k): v for k, v in child['tap']['summary'].items()})
    check('lifecycle/suite', 'tests/reliability/terminal-flow.test.js', child['file'])
    check('lifecycle/command', ['--suite', 'terminal-flow', '--output-dir', str(ARCHIVE)], children['invocation']['argv'][2:])
    check('lifecycle/cwd', str(SERVER), receipt['cwd'])
    log = text(ARCHIVE / 'verification.log')
    check('lifecycle/literal-command', True, log.startswith('COMMAND ' + ' '.join(children['invocation']['argv']) + '\nCWD=' + str(SERVER)))
    for case in CASES:
        cleanup = read(ARCHIVE / case / 'cleanup.json')
        check(case + '/cleanup-roles', ['mongod', 'server'], sorted(p['role'] for p in cleanup['processes']))
        check(case + '/cleanup-processes', [False, False], [p['aliveAfter'] for p in cleanup['processes']])
        check(case + '/cleanup-directories', [False, False], [p['existsAfter'] for p in cleanup['directories']])
        check(case + '/browser-errors', [], read(ARCHIVE / case / 'browser-errors.json'))
        check(case + '/server-errors', [], [l for l in text(ARCHIVE / case / 'services/server.log').splitlines()
                                          if re.search(r'Error handling|Unhandled|TypeError|AssertionError|ReferenceError|RangeError', l)])
        served = read(ARCHIVE / case / 'served-sources.json')
        for name, digest in served.items():
            check(case + '/served/' + name, ids['after']['client']['files'][name], digest)
    differences = []
    for repo, base in [('client', ROOT), ('server', SERVER)]:
        check('lifecycle/stable-tested/' + repo, ids['before'][repo]['files'], ids['after'][repo]['files'])
        for name, digest in ids['after'][repo]['files'].items():
            file = base / name
            current = sha(file) if file.exists() else None
            if current != digest:
                differences.append(dict(repo=repo, path=name, tested=digest, current=current))
    frozen = read(ROOT / 'artifacts/TASK-225/review-127/frozen-tools.json')
    for name, digest in frozen.items():
        check('ancestry/' + name, digest, sha(ROOT / 'ops' / name))
    for name in ['review-114/reviewed-crosswalk.json', 'review-127/historical-selection.json', 'review-128/ac2-sufficiency.json']:
        text(ROOT / 'artifacts/TASK-225' / name)
    save('checkpoints.json', dict(checkpoints=checks, scope='AC3 projected movement and historical lifecycle checks only'))
    save('source-identities.json', dict(historicalManifest=str(ARCHIVE / 'source-identities.json'), historicalManifestSha256=sha(ARCHIVE / 'source-identities.json'), sourceDifferences=differences, newBrowserExecution=False))
    save('ac3-sufficiency.json', dict(result='STOP_MISSING_RAW_CALLBACK_PROOF', missing=missing, wholeCriterionCredit=False,
         overallPass=False, fullInvocation=False, consumerRun=False, counts=dict(requiredPrior=63, currentCriteria=74, selfOwners=8),
         countSource='review-127/handoff-audit.json; consumer not rerun', frozenToolsPreserved=len(frozen)))
    save('lifecycle-inspection.json', dict(historicalRecordsConsistent=True, wholeCriterionCredit=False,
         sourceDifferences=len(differences), archiveHashes=len(coverage['evidenceHashes']), assertions=len(checks),
         tier='historical recorded execution checks, not fresh browser execution',
         limitations=['source drift retained', 'legacy parent receipt inspected, no missing richer receipt reconstructed',
                      'whole AC2/AC3 semantics insufficient; complete lifecycle/tier reader and refresh still required']))
    save('proof-hashes.json', proofs)
    print('PASS historical-record-inspection archiveHashes=' + str(len(coverage['evidenceHashes'])) + ' sourceDifferences=' + str(len(differences)))
    print('STOP_MISSING_RAW_CALLBACK_PROOF TASK-221/AC3 credit=false consumerRun=false')
    print('PASS ancestry-preserved frozenTools=' + str(len(frozen)) + ' selectionChanged=false')


if __name__ == '__main__':
    inspect(sys.argv[1])
