#!/usr/bin/env python3
"""Read finalized TASK-209 receipts; never substitute them for whole-clause review."""
import hashlib
import json
from datetime import datetime
from pathlib import Path
import sys


def review(root):
    root = Path(root).resolve()
    manifest = json.loads((root/'evidence-hashes.json').read_text())
    checks, proofs = [], {}

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('receipt-proof: '+name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    def read(name, text=False):
        file = (root/name).resolve()
        if not file.is_relative_to(root):
            raise ValueError('receipt-proof: escaped-proof')
        data = file.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        check('hash/'+name, manifest[name], sha)
        proofs[name] = sha
        return data.decode() if text else json.loads(data)

    budget, child = read('verification-budget.json'), read('child-results.json')
    log, cleanup = read('verification.log', True), read('cleanup.json')
    start = datetime.fromisoformat(budget['startedAt'].replace('Z', '+00:00'))
    end = datetime.fromisoformat(budget['finishedAt'].replace('Z', '+00:00'))
    check('elapsed-from-timestamps', budget['elapsedMs'], round((end-start).total_seconds()*1000))
    for key, expected in [('targetMs',2700000), ('stopWorkMs',3300000), ('budgetMs',3600000), ('exits',[0]), ('cleanup',True), ('pass',True)]:
        check('budget/'+key, expected, budget[key])
    check('finished-before-stop', True, 0 < budget['elapsedMs'] < budget['stopWorkMs'])
    check('suite', ['tests/reliability/concurrent-games.test.js'], child['selection']['suites'])
    check('gate-status', 'passed', child['gate']['status'])
    check('one-child', 1, len(child['children']))
    check('owned-historical-files-unmodified', [], child['historicalEvidence']['modified'])
    invocation = child['invocation']
    for marker in ['COMMAND '+' '.join(invocation['argv']), 'CWD='+invocation['cwd'], 'NODE='+invocation['node'],
                   'CHILD_ACTUAL_EXIT_STATUS=0', 'PASS current-source-hashes:1002', 'PASS cumulative-budget-under-one-hour']:
        check('log/'+marker, True, marker in log.splitlines())
    for c in child['children']:
        for key, expected in [('exitCode',0),('signal',None),('timedOut',False),('status','passed'),('reasons',[])]:
            check('child/'+key, expected, c[key])
        check('child-suite-stable', c['suiteSha256']['before'], c['suiteSha256']['after'])
        check('child-command', True, ('CHILD_COMMAND '+' '.join(c['command']['argv'])+' CWD='+c['command']['cwd']) in log.splitlines())
        for stream in ['stdout','stderr']:
            # Later archive selections retain original absolute paths. Bind the
            # relative canonical proof in this selection, not an external file.
            relative = str(Path(c[stream+'Path']).relative_to(Path(child['outputDir'])))
            body = read(relative, True)
            check('full-child-'+stream, True, body in log)
        summary = c['tap']['summary']
        for key, expected in [('tests',1),('pass',1),('fail',0),('cancelled',0),('skipped',0),('todo',0)]:
            check('tap/'+key, expected, summary[key])
        check('named-test-pass', True, 'ok 1 - bounded concurrent real games' in log.splitlines())
    runtime_line = next(l for l in log.splitlines() if l.startswith('# runtime '))
    runtime = json.loads(runtime_line[len('# runtime '):])
    check('runtime-node', invocation['node'], runtime['node'])
    check('runtime-chromium', '125.0.6422.26', runtime['chromium'])
    for repo in ['diplomacy','diplomacy_server']:
        check(repo+'/diff-empty', '', read(repo+'-diff-check.txt', True))
        check(repo+'/diff-receipt', True, ('COMMAND git diff --check cwd=/root/'+repo+' EXIT_STATUS=0 OUTPUT_BYTES=0') in log.splitlines())
    check('owned-process-roles', ['mongod','server'], sorted(p['role'] for p in cleanup['processes']))
    check('owned-processes-stopped', [False,False], [p['aliveAfter'] for p in cleanup['processes']])
    return dict(checks=checks, proofs=proofs, checkCount=len(checks), **{'pass':True},
                scope='Independent selected finalized receipt, log completeness and cumulative timing review for AC4/AC8; not a new invocation or whole-criterion closure.',
                fullAuditReady=False,
                limitations=['Full AC4 secret handling/trace ownership and AC8 source-level deadline enforcement still require complete clause review.',
                             'Selection is a later hash-bound copy, not an original worker receipt; original archive remains unchanged.'])


if __name__ == '__main__':
    result = review(sys.argv[1])
    with Path(sys.argv[2]).open('x') as out:
        json.dump(result, out, indent=2)
        out.write('\n')
    print(f"PASS finalized concurrent receipts checks={result['checkCount']} wholeCriterionClosure=false fullAuditReady=false")
