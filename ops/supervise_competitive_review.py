#!/usr/bin/env python3
"""Record the OS exit separately; terminate this invocation's group on timeout."""
import json, os, pathlib, signal, subprocess, sys, time
out = pathlib.Path(os.path.abspath(sys.argv[1]))
assert not out.exists(), 'fresh output required'
command = ['/usr/local/bin/node20', 'ops/run_competitive_review.js', str(out)] + sys.argv[2:]
env = dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules')
start = time.monotonic()
with open(str(out) + '-supervisor.log', 'x') as log:
    child = subprocess.Popen(command, cwd='/root/diplomacy', env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    supervisor_signals = []
    def interrupted(number, frame):
        supervisor_signals.append(dict(signal=number, atMs=round(time.time()*1000)))
        receipt_path = out/'supervisor-signal.json' if out.is_dir() else pathlib.Path(str(out)+'-supervisor-signal.json')
        receipt_path.write_text(json.dumps(supervisor_signals, indent=2)+'\n')
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    timed_out = False
    try:
        code = child.wait(timeout=3300)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            code = child.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            code = child.wait()
    record = dict(command=command, cwd='/root/diplomacy', actualRunnerExit=code, timedOut=timed_out,
                  elapsedMs=round((time.monotonic()-start)*1000), observedBy='Python Popen.wait OS child exit', fullInvocation=False, supervisorSignals=supervisor_signals)
    if out.is_dir():
        (out/'process-exit.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps(record))
sys.exit(0 if code == 0 and not timed_out and not supervisor_signals else 1)
