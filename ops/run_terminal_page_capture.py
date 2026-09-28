#!/usr/bin/env python3
"""Bounded source-tier experiment; never invokes the prerequisite-gated audit."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path('/root/diplomacy')
SERVER = Path('/root/diplomacy_server')
NODE = '/usr/local/bin/node20'

def main():
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    stamp = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    start = stamp()
    save = lambda name, value: (out / name).write_text(json.dumps(value, indent=2) + '\n')
    commands = [[NODE, '--test', 'ops/test_terminal_passive_capture.js'],
                [NODE, '--test', 'ops/test_terminal_page_capture.js'],
                ['git', 'diff', '--check'], ['git', '-C', str(SERVER), 'diff', '--check']]
    save('verification-plan.json', dict(scope='source-tier adapter experiment; not full TASK-225',
         estimateMs=120000, stopWorkMs=3300000, deadlineMs=3600000,
         cases=['seven-existing-primitive-controls', 'integrated-native-storage-page-adapter',
                'legacy-observer-mutation-comparison', 'two-page-named-callback-receipts',
                'rebound-semantic-rejections', 'private-branded-production-and-reference-baselines', 'private-pinned-getter-rejection',
                'mandatory-town-field-rejections'],
         commands=[dict(argv=c,cwd=str(ROOT)) for c in commands],
         exclusions=['shipped gameplay', 'authenticated network/persistence', 'whole criterion consumption', 'full audit']))
    files = [ROOT / p for p in ['ops/terminal_passive_capture.js','ops/test_terminal_passive_capture.js',
        'ops/terminal_page_capture.js','ops/review_terminal_boundary.js','ops/test_terminal_page_capture.js',
        'ops/run_terminal_page_capture.py','ops/task225-terminal-page-capture.md',
        'player.js','sprites/sprite.js','sprites/entities/entity.js','sprites/entities/units/unit/unit.js',
        'sprites/empty.js','options/timer.js','options/save.js',
        'sprites/entities/buildings/manufactures/preparingManufacture/preparingManufacture.js',
        'sprites/entities/buildings/manufactures/preparingManufacture/production.js']]
    files += [SERVER / 'tests/reliability/helpers/observation-game.js']
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    before = {str(p):sha(p) for p in files}
    frozen = json.loads((ROOT/'artifacts/TASK-225/review-127/frozen-tools.json').read_text())
    selection = {str(ROOT/'artifacts/TASK-225'/p):sha(ROOT/'artifacts/TASK-225'/p)
        for p in ['review-114/reviewed-crosswalk.json','review-127/historical-selection.json']}
    env = dict(os.environ,NODE_PATH='/opt/diplomacy/node_modules',PLAYWRIGHT_BROWSERS_PATH='0',TERMINAL_ADAPTER_OUTPUT=str(out))
    exits=[]
    with (out/'verification.log').open('w') as log:
        log.write('scope=source-tier adapter experiment; no full-audit PASS\n')
        log.write('runtime='+subprocess.check_output([NODE,'--version'],text=True).strip()+'\n')
        for cmd in commands:
            remaining = 3300-(time.monotonic()-started)
            if remaining <= 0: raise RuntimeError('cumulative deadline')
            log.write('cwd='+str(ROOT)+'\ncommand='+json.dumps(cmd)+'\n');log.flush()
            p = subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try: code=p.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                import signal
                os.killpg(p.pid,signal.SIGTERM)
                try: p.wait(timeout=10)
                except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);p.wait()
                code=p.returncode
                log.write('TIMEOUT: failed\n')
            exits.append(dict(argv=cmd,pid=p.pid,actualExit=code))
            log.write('actualExit='+str(code)+'\n');log.flush()
            if code: break
    after={str(p):sha(p) for p in files}
    save('source-identities.json',dict(before=before,after=after,unchanged=before==after))
    frozen_ok=all(sha(ROOT/'ops'/n)==h for n,h in frozen.items())
    selection_ok=all(sha(Path(n))==h for n,h in selection.items())
    checkpoints=json.loads((out/'checkpoints.json').read_text()) if (out/'checkpoints.json').exists() else []
    cleanup=json.loads((out/'cleanup.json').read_text()) if (out/'cleanup.json').exists() else {}
    passed=(len(exits)==len(commands) and all(x['actualExit']==0 for x in exits) and before==after and
        frozen_ok and selection_ok and bool(checkpoints) and all(x['expected']==x['observed'] for x in checkpoints) and cleanup.get('browserClosed') is True)
    save('negative-control-results.json',dict(scope='source controls only',
         checks=[x for x in checkpoints if 'reject' in x['id'] or 'stop' in x['id'] or 'counterexample' in x['id']]))
    save('coverage-results.json',dict(scope='source-tier only',scopePass=passed,wholeCriterionCredit=False,
         fullInvocation=False,selectedAssertions=[x['id'] for x in checkpoints],commands=exits,
         evidenceHashes={p.name:sha(p) for p in out.iterdir() if p.is_file()}))
    save('acquisition-stop.json',dict(result='STOP_WHOLE_CRITERION_READER_INCOMPLETE',overallPass=False,
         fullInvocation=False,newCriterionCredit=0,missing=['whole AC2/AC3 independent semantic/lifecycle reader','fresh four-journey provider and cumulative consumer receipts'],
         plan='ops/task225-terminal-page-capture.md',frozenToolsPreserved=frozen_ok,currentSelectionPreserved=selection_ok))
    elapsed=round((time.monotonic()-started)*1000)
    save('verification-budget.json',dict(start=start,end=stamp(),elapsedMs=elapsed,commands=exits,
        scopePass=passed,fullInvocation=False,overallPass=False,cleanup=cleanup,timeout=elapsed>=3300000))
    required=['coverage-audit.json','negative-control-results.json','verification.log','checkpoints.json',
        'source-identities.json','verification-budget.json','verification-plan.json','coverage-results.json']
    save('required-artifact-audit.json',[dict(path=str(out/n),exists=(out/n).exists(),
        fullTaskCondition='FAILED: scoped experiment, not complete invocation' if (out/n).exists() else 'FAILED: missing; full audit gated') for n in required])
    print('PASS scoped adapter experiment' if passed else 'FAIL scoped adapter experiment')
    print('STOP_WHOLE_CRITERION_READER_INCOMPLETE; TASK-225 remains pending; fullInvocation=false')
    return 0 if passed else 1

if __name__=='__main__':
    sys.exit(main())
