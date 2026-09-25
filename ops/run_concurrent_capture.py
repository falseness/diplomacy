#!/usr/bin/env python3
"""One bounded, capture-justified provider refresh. Not the TASK-225 full gate."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from run_three_match_review import sources, digest, BASELINE, BASELINE_HASH, ROOT, NODE


def main(out):
    out = Path(out)
    if not out.is_absolute():
        out = ROOT/out
    out.mkdir(parents=True, exist_ok=False)
    start = time.time()
    deadline = int((start+3300)*1000)
    write = lambda n, v: (out/n).write_text(json.dumps(v, indent=2)+'\n')
    files = ['task225-recipient-capture.js', 'review_concurrent_recipients.py', 'run_concurrent_capture.py']
    frozen = {name: digest(ROOT/'ops'/name) for name in files}
    write('capture-plan.json', dict(estimateMs=600000, targetMs=2700000, stopWorkMs=3300000,
          budgetMs=3600000, cases=['browser-pair', 'ten-socket-isolation', 'ten-independent-recipients'],
          tiers=['four shipped browser contexts', 'ten real Socket.IO recipients', 'real MongoDB'],
          reason='Missing full ten-player inbound packets and credential-to-roster bindings require new capture.',
          exclusions=['G09 long phase', 'whole AC2 consumption', 'full TASK-225 gate'], frozen=frozen))
    assert digest(BASELINE) == BASELINE_HASH
    before = sources()
    write('capture-sources.json', dict(before=before, frozen=frozen))
    env = dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules',
               NODE_OPTIONS='--require '+str(ROOT/'ops/task225-recipient-capture.js'),
               TASK231_STOP_AT=str(deadline))
    argv = [NODE, str(ROOT/'ai/task245-supervisor.js'), str(out/'owned.jsonl'), str(deadline),
            NODE, 'tests/reliability/run.js', '--suite', 'concurrent-games', '--output-dir', str(out/'provider')]
    passed = False
    exits = []
    with (out/'verification.log').open('w', buffering=1) as log:
        try:
            log.write('COMMAND '+json.dumps(argv)+'\nCWD=/root/diplomacy_server\nNODE_OPTIONS='+env['NODE_OPTIONS']+'\n')
            result = subprocess.run(argv, cwd='/root/diplomacy_server', env=env, stdout=log, stderr=log,
                                    timeout=max(1, start+3540-time.time()))
            exits.append(result.returncode)
            log.write('ACTUAL_EXIT='+str(result.returncode)+'\n')
            assert result.returncode == 0, 'provider failed'
            assert frozen == {name: digest(ROOT/'ops'/name) for name in files}, 'capture code changed'
            after = sources()
            assert before == after, 'source changed'
            write('capture-sources.json', dict(before=before, after=after, frozen=frozen, unchanged=True))
            from review_concurrent_recipients import review
            report = review(out/'provider')
            write('recipient-review.json', report)
            log.write(f"PASS ten-recipient packets={report['packetCount']} checks={report['checkCount']} fullAuditReady=false\n")
            passed = True
        finally:
            cleanup = json.loads((out/'owned.jsonl.cleanup.json').read_text()) if (out/'owned.jsonl.cleanup.json').exists() else None
            write('capture-budget.json', dict(startedEpoch=start, endedEpoch=time.time(), elapsedMs=round((time.time()-start)*1000),
                  exits=exits, providerAndRecipientPass=passed, cleanup=cleanup, fullAuditReady=False))


if __name__ == '__main__':
    main(sys.argv[1])
