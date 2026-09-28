"""Bounded supervisor for the scoped AC3 inspection. No full audit credit."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from inspect_terminal_ac3 import ROOT, sha


def main(out):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    start = time.time()
    save = lambda name, value: (out / name).write_text(json.dumps(value, indent=2) + '\n')
    commands = [
        (str(ROOT), [sys.executable, 'ops/test_inspect_terminal_ac3.py']),
        (str(ROOT), [sys.executable, 'ops/inspect_terminal_ac3.py', str(out)]),
        (str(ROOT), ['git', 'diff', '--check']),
        ('/root/diplomacy_server', ['git', 'diff', '--check']),
    ]
    save('verification-plan.json', dict(scope='AC3 sufficiency and historical lifecycle only',
         commands=[dict(cwd=cwd, argv=cmd) for cwd, cmd in commands], estimateMs=120000,
         stopWorkMs=3300000, budgetMs=3600000,
         cases=['projected-first-move-coop', 'projected-first-move-competitive', 'reader-negative-controls', 'historical-lifecycle', 'ancestry'],
         exclusions=['provider refresh', 'AC1 repetition', 'AC2 repetition', 'consumer comparison on insufficient proof', 'full audit'],
         expectedDecision='No whole AC3 credit without raw registry/recipient state and callback execution receipts'))
    tools = ['inspect_terminal_ac3.py', 'test_inspect_terminal_ac3.py', 'run_terminal_ac3_inspection.py']
    save('tested-tools.json', {n: sha(ROOT / 'ops' / n) for n in tools})
    results = []
    with (out / 'verification.log').open('w') as log:
        log.write('RUNTIME ' + sys.version + '\nBROWSER none: archive inspection only\n')
        log.flush()
        for cwd, cmd in commands:
            log.write('COMMAND ' + json.dumps(cmd) + '\nCWD=' + cwd + '\n')
            log.flush()
            child = subprocess.Popen(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                     env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
            timed_out = False
            try:
                code = child.wait(timeout=max(1, 3300 - (time.time() - start)))
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(child.pid, 15)
                try:
                    code = child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, 9)
                    code = child.wait(timeout=10)
            results.append(dict(argv=cmd, cwd=cwd, actualExit=code, timedOut=timed_out,
                                observedBy='Python Popen.wait OS child exit', detachedSession=True))
            log.write('ACTUAL_EXIT=' + str(code) + '\n')
            log.flush()
            if code != 0 or timed_out:
                break
    save('process-exit.json', results)
    ok = len(results) == len(commands) and all(r['actualExit'] == 0 and not r['timedOut'] for r in results)
    save('verification-budget.json', dict(startedAtEpoch=start, finishedAtEpoch=time.time(),
         elapsedMs=round((time.time() - start) * 1000), exits=[r['actualExit'] for r in results],
         cleanup=True, ownedServices=[], passScoped=ok, fullInvocation=False, overallPass=False))
    save('coverage-results.json', dict(scope='inspection only', passScoped=ok, overallPass=False,
         proofPaths=['ac3-sufficiency.json', 'lifecycle-inspection.json', 'checkpoints.json', 'source-identities.json', 'process-exit.json'],
         wholeCriteriaAdded=0, consumerRun=False))
    if not ok:
        raise SystemExit(1)
    print('PASS scoped AC3 inspection; whole TASK-225 remains incomplete: ' + str(out))


if __name__ == '__main__':
    main(sys.argv[1])
