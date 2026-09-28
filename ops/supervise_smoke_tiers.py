#!/usr/bin/env python3
"""Own the smoke tier review runner and retain its actual OS exit."""
import json, os, pathlib, signal, subprocess, sys, time
out=pathlib.Path(sys.argv[1]).absolute()
assert not out.exists(), 'fresh invocation required'
argv=['python3','ops/run_smoke_tiers_review.py',str(out)]
started=time.time()
with pathlib.Path(str(out)+'-supervisor.log').open('x') as log:
    child=subprocess.Popen(argv,cwd='/root/diplomacy',stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    timed=False
    try: code=child.wait(timeout=3540)
    except subprocess.TimeoutExpired:
        timed=True
        # Runner owns separate command groups; its deadline normally reaps
        # them. Record timeout as failure; never credit an absent receipt.
        os.killpg(child.pid,signal.SIGTERM)
        try: code=child.wait(timeout=15)
        except subprocess.TimeoutExpired: os.killpg(child.pid,signal.SIGKILL);code=child.wait()
    result={'argv':argv,'cwd':'/root/diplomacy','actualRunnerExit':code,'timedOut':timed,
            'startedMs':round(started*1000),'finishedMs':round(time.time()*1000),
            'elapsedMs':round((time.time()-started)*1000),'fullInvocation':False}
    (out/'process-exit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
sys.exit(0 if code==0 and not timed else 1)
