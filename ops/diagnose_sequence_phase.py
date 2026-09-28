#!/usr/bin/env python3
"""Two predeclared native phases, one cumulative 15-minute diagnostic budget."""
import hashlib
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
from audit_sequence_phase import audit

ROOT = pathlib.Path('/root/diplomacy')

def write(out, name, data):
    (out/name).write_text(json.dumps(data, indent=2)+'\n')

def main():
    out = pathlib.Path(sys.argv[1]).absolute()
    out.mkdir(exist_ok=False)
    start = time.monotonic()
    started = time.time()
    deadline = start + 840
    case = dict(id='coop-actions-1', mode='coop', actionSeed=1, mapSeed=1,
                fog=True, join='simultaneous', humans=2, actions=12,
                tier='shipped browser UI + real HTTPS/Socket.IO/MongoDB')
    command = ['/usr/local/bin/node20', '--require', str(ROOT/'ops/sequence_phase_observer.js'),
               '--test', 'tests/reliability/helpers/natural-coop-browser.js']
    phases = ['after-frame', 'after-frame-plus-50ms']
    tools = ['ops/diagnose_sequence_phase.py', 'ops/audit_sequence_phase.py',
             'ops/sequence_phase_observer.js', 'ops/sequence_native_frame_probe.js', 'ops/sequence_pan_observer.js']
    identities = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in tools}
    plan = dict(case=case, phases=phases, command=command, cwd='/root/diplomacy_server',
                estimateMs=480000, deadlineMs=900000, stopWorkMs=840000,
                maximumJourneys=2, maximumPanSamples=4, requestedHoldMs=51,
                cpuThrottleRate=1, retries=0, fullInvocation=False,
                scheduling='Resolve after next actual production gameLoop exit, then native timer delay 0 or 50 ms before original pan; no callback rescheduling.',
                comparison='Compare host post-reconnect pans across phases only when one has zero production updates during the trusted hold and the other has at least one. Peer observations are supplementary.',
                missingCondition='INCONCLUSIVE and stop; no further replay or inferred repair',
                exclusions=['other three sequence trajectories', 'full evidence-audit', 'runtime repair', 'current criterion credit'])
    write(out, 'verification-plan.json', plan)
    write(out, 'diagnostic-tool-identities.json', identities)
    baseline = {}
    for repo in [ROOT, pathlib.Path('/root/diplomacy_server')]:
        for kind,args in [('unstaged',['diff','--binary']),('staged',['diff','--cached','--binary'])]:
            data=subprocess.check_output(['git',*args],cwd=repo)
            baseline[f'{repo}:{kind}']=hashlib.sha256(data).hexdigest()
    write(out,'starting-diffs.json',baseline)
    prior = ['review-114/reviewed-crosswalk.json', 'review-121/historical-transitions.json',
             'review-121/criterion-clause-matrix.json', 'review-121/fresh-failure-inspection.json',
             'review-121/prefix-inspection.json', 'review-121/handoff-audit.json',
             'diagnosis-123/next-experiment.json','diagnosis-123/handoff-audit.json',
             'diagnosis-123/production-frame-observations.jsonl', 'diagnosis.md']
    write(out,'retained-prerequisites.json',{name:hashlib.sha256((out.parent/name).read_bytes()).hexdigest() for name in prior})
    results=[]
    with (out/'verification.log').open('x') as log:
        log.write(json.dumps(plan)+'\n'); log.flush()
        for phase in phases:
            childout=out/phase
            childout.mkdir()
            write(childout,'verification-plan.json',dict(plan,phase=phase,maximumPanSamples=2))
            write(childout,'diagnostic-tool-identities.json',identities)
            env=dict(os.environ,NODE_PATH='/opt/diplomacy/node_modules',ONLINE_EVIDENCE_DIR=str(childout),
                     SEQUENCE_CASE=json.dumps(case),SEQUENCE_NATIVE_PHASE=phase,
                     OPENING_COMPETITIVE_STOP_AT=str(round((started+840)*1000)))
            for key in ['NODE_TEST_CONTEXT','NODE_OPTIONS','SEQUENCE_PREFIX']:
                env.pop(key,None)
            childstart=time.monotonic()
            if childstart >= deadline:
                raise TimeoutError('cumulative diagnostic deadline before next phase')
            with (childout/'verification.log').open('x') as childlog:
                childlog.write(json.dumps(dict(command=command,cwd=plan['cwd'],phase=phase))+'\n'); childlog.flush()
                child=subprocess.Popen(command,cwd=plan['cwd'],env=env,stdout=childlog,stderr=subprocess.STDOUT,start_new_session=True)
                timeout=False
                try:
                    code=child.wait(timeout=max(1,deadline-time.monotonic()))
                except subprocess.TimeoutExpired:
                    timeout=True
                    os.killpg(child.pid,signal.SIGTERM)
                    try:
                        code=child.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid,signal.SIGKILL)
                        code=child.wait()
                receipt=dict(actualExit=code,timedOut=timeout,elapsedMs=round((time.monotonic()-childstart)*1000),observedBy='Python Popen.wait',fullInvocation=False)
                childlog.write('ACTUAL_EXIT '+json.dumps(receipt)+'\n')
            write(childout,'process-exit.json',receipt)
            log.write((childout/'verification.log').read_text()); log.flush()
            result=audit(childout)
            write(childout,'handoff-audit.json',result)
            results.append(dict(phase=phase,proof=str(childout),**result))
            print(json.dumps(dict(phase=phase,receipt=receipt,pans=result['pans'])),flush=True)
            if code != 0:
                break  # A real failure is retained; no blind replay.
        hosts=[p for r in results for p in r['pans'] if p['player']=='host']
        achieved=len(hosts)==2 and {p['betweenFrames'] for p in hosts}=={True,False}
        missing=[] if achieved else ['host comparison containing both zero-update and at-least-one-update holds on identical source/configuration']
        summary=dict(diagnosticEvidencePass=True,result='COMPARISON_OBSERVED' if achieved else 'INCONCLUSIVE',
                     missingConditions=missing,fullInvocation=False,overallPass=False,causeProven=False,
                     failureReproduced=any(r['failureReproduced'] for r in results),
                     newCurrentCriteria=0,requiredPrior=63,retainedCurrentCriteria=74,selfOwners=8,phases=results)
        # Every measured source must match both final disk and the other phase.
        if len(results)==2:
            a=json.loads((out/phases[0]/'source-identities.json').read_text())['before']
            b=json.loads((out/phases[1]/'source-identities.json').read_text())['before']
            assert {k:v['files'] for k,v in a.items()} == {k:v['files'] for k,v in b.items()}
        for repo in [ROOT,pathlib.Path('/root/diplomacy_server')]:
            cmd=['git','diff','--check']
            check=subprocess.run(cmd,cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
            log.write(json.dumps(dict(command=cmd,cwd=str(repo)))+'\n'+check.stdout+f'ACTUAL_EXIT={check.returncode}\n')
            assert check.returncode==0
            data=subprocess.check_output(['git','diff','--cached','--name-only','--','artifacts'],cwd=repo)
            (out/('client-staged-artifacts.txt' if repo==ROOT else 'server-staged-artifacts.txt')).write_bytes(data)
            assert not data
            for kind,args in [('unstaged',['diff','--binary']),('staged',['diff','--cached','--binary'])]:
                assert hashlib.sha256(subprocess.check_output(['git',*args],cwd=repo)).hexdigest()==baseline[f'{repo}:{kind}']
        elapsed=round((time.monotonic()-start)*1000)
        assert elapsed<900000
        write(out,'coverage-results.json',summary)
        write(out,'handoff-audit.json',summary)
        write(out,'verification-budget.json',dict(startUnix=started,endUnix=time.time(),elapsedMs=elapsed,
              fullInvocation=False,overallPass=False,cleanup=all(r['cleanup'] for r in results),
              exits=[r['receipt'] for r in results],deadlineMs=900000))
        log.write(f"RESULT {summary['result']}; newCurrentCriteria=0; fullInvocation=false\n")
    print(json.dumps(dict(result=summary['result'],elapsedMs=elapsed,fullInvocation=False)),flush=True)

if __name__=='__main__':
    main()
