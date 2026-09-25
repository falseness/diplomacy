#!/usr/bin/env python3
"""Review TASK-231 execution evidence without promoting it to gameplay coverage.

The literal selection comes from the accepted bounded specification. Historical
source differences remain explicit; only a fresh source match can be current.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

SELECTION = [('fast', 'tests/reliability/fast-opening.test.js', ['fast opening: coop', 'fast opening: competitive']), ('fast', 'tests/game_round_number.test.js', ['round zero advances exactly once after every component finishes', 'nonzero starting rounds retain their offset', 'old games with zeroed snapshots recover the current round for playable and waiting players', 'advancing an old zeroed game uses saved history rather than submitted counters', 'competitive round preserves its board without demon state and waits for every component']), ('fast', 'tests/get_players_parallel_order_components.test.js', ['influence overlap forms ordered connected player components']), ('fast', 'tests/legacy_round.test.js', ['old pending rounds gain a playable human head and a waiting human slot', 'completed legacy waves retain their resulting board and are not replayed', 'partially submitted parallel waves merge saved moves before pending players continue', 'fully completed legacy rounds remain completed for normal round advancement', 'current-format rounds are left unchanged']), ('fast', 'tests/matchmaking_stale_assignment.test.js', ['a returning password with an unassigned game reference joins the active host instead of player -1', 'a password whose game was deleted can join a host in another game', 'a valid reconnect preserves its original game and slot', 'new game identifiers do not reuse a numeric identifier after game deletion', 'failed game initialization does not create an orphan user record', 'fresh three-player fog request does not join a two-player no-fog game', 'compatible older game remains joinable behind a newer incompatible game', 'a full compatible game does not hide an older compatible open slot', 'matching considers fog, player count, map geometry, terrain and timer mode', 'saved password reconnects to its existing room even when menu settings differ']), ('fast', 'tests/online/simple_2p_1round.test.js', ['2-player game, 1 round completes without crash']), ('focused', 'tests/coop/browser-online.test.js', ['browser preset requests, peer maps and reconnect retain committed metadata']), ('focused', 'tests/coop/browser-reconnect.test.js', ['actual browser reconnect preserves committed deaths and all peers show shared results']), ('focused', 'tests/coop/disconnect-timer.test.js', ['sequential 2 humans: disconnect before/after submission and timer expiry preserve completion', 'parallel 2 humans: disconnect before/after submission and timer expiry preserve completion', 'sequential 4 humans: disconnect before/after submission and timer expiry preserve completion', 'parallel 4 humans: disconnect before/after submission and timer expiry preserve completion'])]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def review(directory, require_current=True):
    root = Path(directory).resolve(strict=True)
    read = lambda name: json.loads((root / name).read_text())
    manifest = read('evidence-hashes.json')
    checks = []

    def check(name, expected, observed):
        if json.dumps(expected, sort_keys=True) != json.dumps(observed, sort_keys=True):
            raise ValueError('fast-review:' + name)
        checks.append(dict(id=name, expected=expected, observed=observed, pass_=True))

    def local(name):
        # Historical absolute filenames are accepted only inside this archive.
        file = (root / name).resolve(strict=True)
        if not file.is_file() or not file.is_relative_to(root):
            raise ValueError('fast-review:escaped-or-missing-proof:' + name)
        return file

    for name, sha in manifest.items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('fast-review:invalid-manifest-path')
        check('hash/' + name, sha, digest(local(name)))
    for name in ['verification-plan.json', 'coverage-results.json', 'child-results.json',
                 'discovery-manifest.json', 'source-identities.json',
                 'fast-owned.jsonl.cleanup.json', 'focused-owned.jsonl.cleanup.json']:
        check('required-binding/' + name, digest(local(name)), manifest.get(name))
    plan, coverage, children, budget, sources = map(read, [
        'verification-plan.json', 'coverage-results.json', 'child-results.json',
        'verification-budget.json', 'source-identities.json'])
    check('exact-selection', SELECTION,
          [(c['selection'], c['file'], c['cases']) for c in plan['cases']])
    ids = [selection + '/' + file + '/' + case for selection, file, cases in SELECTION for case in cases]
    check('exact-coverage', ids, [c['id'] for c in coverage['cases']])
    check('case-count', 30, coverage['expectedCases'])
    check('coverage-pass', True, coverage['pass'])
    check('case-pass', [True] * 30, [c['pass'] for c in coverage['cases']])
    for c in coverage['cases']:
        file = local(c['proof'])
        name = str(file.relative_to(root))
        check('case-proof/' + c['id'], digest(file), manifest.get(name))
    check('gate', 'passed', children['gate']['status'])
    check('exact-children', [(s, f) for s, f, _ in SELECTION],
          [(c['selection'], c['file']) for c in children['children']])
    for child, (_, _, cases) in zip(children['children'], SELECTION):
        name = child['selection'] + '/' + child['file']
        check('required/' + name, cases, child['requiredCases'])
        for key, value in dict(exitCode=0, signal=None, timedOut=False, status='passed', reasons=[]).items():
            check(name + '/' + key, value, child[key])
        check('tap/' + name, [dict(name=c, ok=True, directive=None) for c in cases], child['tap']['cases'])
        check('tap-summary/' + name, dict(tests=len(cases), suites=0, **{'pass':len(cases)},
              fail=0, cancelled=0, skipped=0, todo=0), child['tap']['summary'])
        stdout = local(child['stdoutPath']).read_text()
        local(child['stderrPath'])
        for case in cases:
            check('raw-tap/' + case, True, any(line.startswith('ok ') and line.endswith(' - ' + case) for line in stdout.splitlines()))
        for marker in ['# fail 0', '# skipped 0', '# cancelled 0']:
            check('raw-summary/' + name + '/' + marker, True, marker in stdout)
    commands = children['commands']
    check('command-labels', ['fast', 'focused', 'server-diff-check', 'client-diff-check'], [c['label'] for c in commands])
    check('exits', [0] * 4, [c['exit'] for c in commands])
    check('signals', [None] * 4, [c['signal'] for c in commands])
    stamp = lambda s: round(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
    start, end = stamp(budget['startedAt']), stamp(budget['finishedAt'])
    check('shared-start', plan['startedAt'], budget['startedAt'])
    check('elapsed', end - start, budget['elapsedMs'])
    check('bounded-elapsed', True, 0 <= end - start <= 3600000)
    check('bounded-estimate', True, 0 < plan['estimateMs'] <= 2700000)
    check('stop-at', start + 3300000, plan['stopAt'])
    for name, value in dict(stopWorkMs=3300000, budgetMs=3600000, exits=[0]*4, cleanup=True, **{'pass':True}).items():
        check('budget/' + name, value, budget[name])
    for index, selection in enumerate(['fast', 'focused']):
        command = commands[index]
        args = command['args']
        check('shared-deadline/' + selection, str(plan['stopAt']), args[2])
        selector = 'fast' if index == 0 else ','.join(f for s, f, _ in SELECTION if s == 'focused')
        check('selector/' + selection, selector, args[args.index('--suite') + 1])
        check('runner/' + selection, 'tests/reliability/run.js', args[4])
        receipt = read(selection + '-owned.jsonl.cleanup.json')
        for key, value in dict(exit=0, signal=None, timedOut=False, cleanup=True, remaining=[]).items():
            check('cleanup/' + selection + '/' + key, value, receipt[key])
        check('cleanup/identities/' + selection, True, bool(receipt['processes']) and all(
            type(p['pid']) is int and p['pid'] > 0 and p['start'].isdigit() for p in receipt['processes']))
        check('cleanup/directories/' + selection, True, all(d['existsAfter'] is False for d in receipt['directories']))
        discovery = read(selection + '/discovery-manifest.json')
        for key in ['unregistered', 'absent', 'caseProblems', 'selectedWithoutCases']:
            check('discovery/' + selection + '/' + key, [], discovery[key])
        check('exhaustive-registered/' + selection, True, 'exhaustive-local' in discovery['profiles'])
        result = read(selection + '/child-results.json')
        check('history/' + selection, [], result['historicalEvidence']['modified'])
        check('inner-gate/' + selection, dict(status='passed', reasons=[]), result['gate'])
    for selection, command in zip(['server', 'client'], commands[2:]):
        check('diff-command/' + selection, ['diff', '--check'], command['args'])
        check('empty-diff/' + selection, '', local(selection + '-diff-check.log').read_text())
    check('stable-sources', sources['before'], sources['after'])
    check('no-run-drift', [], sources['stale'])
    differences = []
    for role in ['client', 'server']:
        record = sources['after'][role]
        repo = Path(record['repo']).resolve(strict=True)
        check('sources-nonempty/' + role, True, bool(record['files']))
        for name, sha in record['files'].items():
            file = (repo / name).resolve()
            if not file.is_relative_to(repo):
                raise ValueError('fast-review:source-escape')
            if not file.is_file() or digest(file) != sha:
                differences.append(role + '/' + name)
    if require_current:
        check('current-source-differences', [], differences)
    log = local('verification.log').read_text()
    for marker in ['TASK-231 node=v20.', 'PASS TASK-231 complete-invocation cases=30 cleanup=true',
                   'PASS required-artifact-marker-audit', 'ACTUAL_EXIT fast {"exit":0,"signal":null}',
                   'ACTUAL_EXIT focused {"exit":0,"signal":null}']:
        check('log/' + marker, True, marker in log)
    return dict(kind='later-task231-execution-review', archive=str(root),
                sourceDifferences=differences, currentSourceValid=not differences,
                historicalExecutionValid=True, checks=checks, cases=ids,
                finalReceiptHashes={n:digest(local(n)) for n in ['verification-budget.json', 'verification.log']},
                scope='Execution, exact selection, raw TAP, discovery, source identity and cleanup only. '
                      'Does not independently establish browser actions or gameplay state, AC2/AC4, or full TASK-225 completion.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive')
    p.add_argument('--historical', action='store_true')
    p.add_argument('--output', required=True)
    a = p.parse_args()
    result = review(a.archive, not a.historical)
    Path(a.output).write_text(json.dumps(result, indent=2) + '\n')
    print('PASS TASK-231 execution review cases=30 checks=' + str(len(result['checks'])) +
          ' currentSourceValid=' + str(result['currentSourceValid']))
