#!/usr/bin/env python3
"""One bounded seed-1 diagnostic, with an independent OS receipt. No retries."""
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

out = pathlib.Path(sys.argv[1]).absolute()
out.mkdir(exist_ok=False)
case = dict(id='coop-actions-1', mode='coop', actionSeed=1, mapSeed=1,
            fog=True, join='simultaneous', humans=2, actions=12,
            tier='shipped browser UI + real HTTPS/Socket.IO/MongoDB')
command = ['/usr/local/bin/node20', '--require', '/root/diplomacy/ops/sequence_pan_observer.js',
           '--test', 'tests/reliability/helpers/natural-coop-browser.js']
cwd = '/root/diplomacy_server'
start = time.monotonic()
env = dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules', ONLINE_EVIDENCE_DIR=str(out),
           SEQUENCE_CASE=json.dumps(case), OPENING_COMPETITIVE_STOP_AT=str(round(time.time()*1000)+840000))
env.pop('NODE_TEST_CONTEXT', None)
env.pop('NODE_OPTIONS', None)
env.pop('SEQUENCE_PREFIX', None)
plan = dict(command=command, cwd=cwd, case=case, estimateMs=300000, deadlineMs=900000,
            scope='passive diagnostic only; no current criterion credit',
            exclusions=['other three trajectories', 'full evidence audit'])
(out/'verification-plan.json').write_text(json.dumps(plan, indent=2)+'\n')
with (out/'verification.log').open('x') as log:
    log.write(json.dumps(plan)+'\n'); log.flush()
    child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    timed_out = False
    try:
        code = child.wait(timeout=840)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            code = child.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            code = child.wait()
    receipt = dict(actualExit=code, timedOut=timed_out, elapsedMs=round((time.monotonic()-start)*1000),
                   observedBy='Python Popen.wait', fullInvocation=False)
    log.write('ACTUAL_EXIT '+json.dumps(receipt)+'\n')
(out/'process-exit.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps(receipt))
sys.exit(0 if code == 0 and not timed_out else 1)
