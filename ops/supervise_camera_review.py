#!/usr/bin/env python3
"""Record the OS exit separately; terminate this invocation's group on timeout."""
import json, os, pathlib, signal, subprocess, sys, time
out = pathlib.Path(os.path.abspath(sys.argv[1]))
assert not out.exists(), 'fresh output required'
command = ['/usr/local/bin/node20', 'ops/run_camera_review.js', str(out)] + sys.argv[2:]
env = dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules')
start = time.monotonic()
with open(str(out) + '-supervisor.log', 'x') as log:
    child = subprocess.Popen(command, cwd='/root/diplomacy', env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
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
                  elapsedMs=round((time.monotonic()-start)*1000), observedBy='Python Popen.wait OS child exit', fullInvocation=False)
    if out.is_dir():
        (out/'process-exit.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps(record))
sys.exit(0 if code == 0 and not timed_out else 1)
