#!/usr/bin/env python3
"""Bounded TASK-225 prerequisite comparison and receipt review, not the full gate."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path('/root/diplomacy')
FILES = ['reconcile_evidence_catalog.js', 'run_catalog_reconciliation.js', 'run_catalog_review.py',
         'review_concurrent_receipts.py', 'test_review_concurrent_receipts.py', 'task225-catalog-reconciliation.md']


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main(out):
    out = Path(out).absolute()
    out.mkdir(parents=True, exist_ok=False)
    start = time.time()
    exits, passed = [], False
    write = lambda n,v: (out/n).write_text(json.dumps(v, indent=2)+'\n')
    frozen = {f:digest(ROOT/'ops'/f) for f in FILES}
    tasks_hash = digest(ROOT/'artifacts/tasks.json')
    env = dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules', PYTHONDONTWRITEBYTECODE='1')
    commands = [(['/usr/local/bin/node20', 'ops/run_catalog_reconciliation.js', str(out/'consumer')], ROOT),
                (['python3', 'ops/review_concurrent_receipts.py', str(ROOT/'artifacts/TASK-225/review-43/prepared/selected-209'), str(out/'concurrent-receipts.json')], ROOT),
                (['python3', '-m', 'unittest', 'discover', '-s', 'ops', '-p', 'test_review_concurrent_receipts.py', '-v'], ROOT),
                (['git', 'diff', 'HEAD', '--check'], ROOT),
                (['git', 'diff', 'HEAD', '--check'], Path('/root/diplomacy_server'))]
    write('scoped-plan.json', dict(scope='Prerequisite steps 1/2/6 only; full steps 3/4/5/7 remain gated.',
          estimateMs=600000, stopWorkMs=3300000, budgetMs=3600000, commands=[dict(argv=a,cwd=str(c)) for a,c in commands], frozen=frozen))
    with (out/'verification.log').open('w', buffering=1) as log:
        try:
            for argv,cwd in commands:
                log.write('COMMAND '+json.dumps(argv)+'\nCWD='+str(cwd)+'\n')
                result = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        timeout=max(1,start+3300-time.time()))
                log.write(result.stdout.decode(errors='replace'))
                log.write('ACTUAL_EXIT='+str(result.returncode)+'\n')
                exits.append(dict(argv=argv,cwd=str(cwd),exit=result.returncode))
                if argv[:2] == ['git','diff']:
                    (out/(cwd.name+'-diff-check.txt')).write_bytes(result.stdout)
                assert result.returncode == 0, 'required scoped command failed'
            assert frozen == {f:digest(ROOT/'ops'/f) for f in FILES}, 'changed tested tooling'
            assert tasks_hash == digest(ROOT/'artifacts/tasks.json'), 'changed task input'
            for cwd in [ROOT,Path('/root/diplomacy_server')]:
                result = subprocess.run(['git','diff','--cached','--name-only','--','artifacts'], cwd=cwd, capture_output=True, check=True)
                assert not result.stdout, 'artifacts staged'
            passed = True
            log.write('PASS scoped reconciliation and receipt review; fullAuditReady=false\n')
        except subprocess.TimeoutExpired as error:
            if error.stdout:
                log.write(error.stdout.decode(errors='replace'))
            log.write('FAIL cumulative deadline; child killed and reaped\n')
            raise
        finally:
            write('scoped-budget.json',dict(passScoped=passed,startedEpoch=start,finishedEpoch=time.time(),
                  elapsedMs=round((time.time()-start)*1000),commands=exits,cleanup=True,
                  cleanupScope='synchronous read-only commands reaped; no services or browsers launched',fullInvocation=False))
            write('tool-identities.json',frozen)
            write('evidence-hashes.json',{str(p.relative_to(out)):digest(p) for p in out.rglob('*') if p.is_file() and p.name!='evidence-hashes.json'})
    assert time.time()-start < 3600, 'cumulative budget exceeded'
    print('PASS bounded catalog prerequisite review; fullAuditReady=false')


if __name__ == '__main__':
    main(sys.argv[1])
