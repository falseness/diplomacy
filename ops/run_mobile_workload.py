#!/usr/bin/env python3
"""Calibrate finite mobile fixtures before changing the real G09 producer."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback

from run_three_match_review import BASELINE, BASELINE_HASH, ROOT, NODE, digest, sources


def main():
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=False)
    start = time.time()
    write = lambda name, value: (out/name).write_text(json.dumps(value, indent=2)+'\n')
    counts = [4, 12, 24, 48]
    write('calibration-plan.json', dict(cases=[f'mobile-{n}' for n in counts],
          tier='production source only; no service/browser claims', estimateMs=240000,
          stopWorkMs=300000, cleanupBudgetMs=30000, budgetMs=330000,
          exclusions=['network progress', 'G09 closure', 'independent state oracle', 'full TASK-225 audit'],
          selection='Record actual durations of four mobile tiny H2 seed-1 fixtures; no retries or artificial slowdown.'))
    assert digest(BASELINE) == BASELINE_HASH
    before = sources()
    before['calibrationTools'] = {name: digest(ROOT/'ops'/name) for name in
                                 ['task225-mobile-workload.js', 'run_mobile_workload.py']}
    write('source-identities.json', dict(before=before))
    exits, rows = [], []
    passed = False
    journals = []
    with (out/'verification.log').open('w', buffering=1) as log:
        try:
            log.write('RUNTIME '+subprocess.check_output([NODE, '--version']).decode())
            for count in counts:
                journal = out/f'mobile-{count}-owned.jsonl'
                journals.append(journal)
                command = [NODE, str(ROOT/'ai/task245-supervisor.js'), str(journal),
                           str(int(min(start+300, time.time()+60)*1000)),
                           NODE, str(ROOT/'ops/task225-mobile-workload.js'), str(count), str(out/f'mobile-{count}.json')]
                log.write('COMMAND '+json.dumps(command)+'\nCWD='+str(ROOT)+'\n')
                result = subprocess.run(command, cwd=ROOT, env=dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules'),
                                        stdout=log, stderr=log, timeout=max(1, start+330-time.time()))
                exits.append(result.returncode)
                log.write(f'ACTUAL_EXIT={result.returncode}\n')
                receipt = json.loads(Path(str(journal)+'.cleanup.json').read_text())
                assert result.returncode == 0 and receipt['cleanup'] and not receipt['timedOut']
                report = json.loads((out/f'mobile-{count}.json').read_text())
                assert report['count'] == count and report['moved'] > 0
                rows.append({key: report[key] for key in ['count', 'moved', 'elapsedMs']})
            after = sources()
            after['calibrationTools'] = {name: digest(ROOT/'ops'/name) for name in before['calibrationTools']}
            write('source-identities.json', dict(before=before, after=after, unchanged=before == after))
            assert before == after
            for repo in [ROOT, Path('/root/diplomacy_server')]:
                log.write(f'COMMAND git diff HEAD --check CWD={repo}\n')
                check = subprocess.run(['git', 'diff', 'HEAD', '--check'], cwd=repo, stdout=log, stderr=log)
                exits.append(check.returncode)
                log.write(f'ACTUAL_EXIT={check.returncode}\n')
                assert check.returncode == 0
            assert digest(BASELINE) == BASELINE_HASH
            passed = time.time()-start < 300
            assert passed
        except Exception:
            traceback.print_exc(file=log)
            raise
        finally:
            receipts = [Path(str(journal)+'.cleanup.json') for journal in journals]
            cleanup = bool(receipts) and all(p.exists() and json.loads(p.read_text()).get('cleanup') is True for p in receipts)
            write('calibration-results.json', dict(cases=rows, passCalibration=passed, criterionClosures=[], fullAuditReady=False))
            write('calibration-budget.json', dict(startedEpoch=start, finishedEpoch=time.time(),
                  elapsedMs=round((time.time()-start)*1000), exits=exits, cleanup=cleanup,
                  passCalibration=passed and cleanup, fullAuditReady=False))
    write('evidence-hashes.json', {str(p.relative_to(out)): digest(p) for p in out.rglob('*') if p.is_file()})
    print('PASS finite mobile workload calibration; no G09 or complete audit claim')


if __name__ == '__main__':
    main()
