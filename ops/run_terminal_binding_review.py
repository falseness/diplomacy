#!/usr/bin/env python3
"""Single cumulative offline verification budget, actual OS child receipts."""
import sys, os, json, time, subprocess, pathlib, hashlib, signal
ROOT=pathlib.Path('/root/diplomacy')
NODE='/usr/local/bin/node20'
out=pathlib.Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
start=time.time();stop=start+3300
commands=[]
def save(n,v): (out/n).write_text(json.dumps(v,indent=2)+'\n')
def command(label,argv,cwd=ROOT,expected=0,env=None):
    assert time.time()<stop,'cumulative deadline'
    started=time.time()
    with (out/(label+'.log')).open('w') as log:
        p=subprocess.Popen(argv,cwd=cwd,env={**os.environ,'NODE_PATH':'/opt/diplomacy/node_modules','EVIDENCE_AUDIT_DEADLINE_MS':str(int(stop*1000)),**(env or {})},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        timed=False
        try: code=p.wait(timeout=max(1,stop-time.time()))
        except subprocess.TimeoutExpired:
            timed=True;os.killpg(p.pid,signal.SIGTERM)
            try: code=p.wait(timeout=15)
            except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);code=p.wait()
    receipt={'label':label,'argv':argv,'cwd':str(cwd),'pid':p.pid,'actualExit':code,'signal':-code if code<0 else None,'startedMs':int(started*1000),'finishedMs':int(time.time()*1000),'timedOut':timed}
    save(label+'-exit.json',receipt);commands.append(receipt)
    with (out/'verification.log').open('a') as f:
        f.write('COMMAND '+json.dumps(argv)+' CWD='+str(cwd)+' NODE_PATH=/opt/diplomacy/node_modules\n')
        f.write((out/(label+'.log')).read_text());f.write('\nACTUAL_EXIT='+str(code)+'\n')
    assert not timed and code==expected,(label,code)
    return (out/(label+'.log')).read_text()
cases=['production-command-regressions','old-path-rejection','historical-ancestry-binding','current-whole-AC2-AC3-readers','nine-corruption-controls','actual-cumulative-target-only-transition','final-evidence-audit']
save('verification-plan.json',{'fullInvocation':False,'estimateMs':1800000,'stopWorkMs':3300000,'budgetMs':3600000,'cases':cases,'tiers':['production-source fixture','independent offline review of original shipped-browser and network proof'],'exclusions':['no new provider or browser acquisition','no full audit while prior obligations remain'],'commands':[[NODE,'--test','ops/test_terminal_command_boundary.js'],[NODE,'ops/run_terminal_binding_review.js',str(out),'old'],[NODE,'ops/run_terminal_binding_review.js',str(out)],['git','diff','--check']],'provider':'artifacts/TASK-225/join-143/run-01/provider','providerReceipt':'artifacts/TASK-225/join-143/run-01/provider-exit.json'})
tools=[*ROOT.glob('ops/*terminal*_v2.js'),ROOT/'ops/run_terminal_binding_review.js',pathlib.Path(__file__).resolve()]
hashes={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in tools};save('review-tool-identities.json',hashes)
passed=False
try:
    command('runtime',[NODE,'--version'])
    command('source-tests',[NODE,'--test','ops/test_terminal_command_boundary.js'],env={'COMMAND_BOUNDARY_OUTPUT':str(out/'command-checkpoints.json')})
    old=command('old-reader',[NODE,'ops/run_terminal_binding_review.js',str(out),'old'],expected=1)
    assert 'terminal/implementation/client/player.js' in old,'intended old rejection'
    command('consumer',[NODE,'ops/run_terminal_binding_review.js',str(out)])
    for name,repo in [('client',ROOT),('server',pathlib.Path('/root/diplomacy_server'))]:
        command(name+'-diff-check',['git','diff','--check'],cwd=repo)
        assert command(name+'-staged-artifacts',['git','diff','--cached','--name-only','--','artifacts'],cwd=repo)==''
    for f,h in hashes.items(): assert hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()==h,f
    cps=json.loads((out/'checkpoints.json').read_text())['checkpoints']
    assert all(c['expected']==c['observed'] and c['pass'] for c in cps)
    passed=True
finally:
    elapsed=int((time.time()-start)*1000)
    save('verification-budget.json',{'fullInvocation':False,'overallPass':False,'scopePass':passed and elapsed<3300000,'startedMs':int(start*1000),'finishedMs':int(time.time()*1000),'elapsedMs':elapsed,'commands':commands,'cleanup':not (out/'negative-copy').exists(),'cleanupReason':'No new services; all owned synchronous child processes reaped; disposable corruption copy removed.'})
    save('coverage-results.json',{'fullInvocation':False,'overallPass':False,'scopePass':passed,'cases':[{'id':c,'pass':passed} for c in cases],'fullTaskPrerequisitesOpen':True,'evidenceHashes':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in out.iterdir() if f.is_file() and f.name!='coverage-results.json'}})
    required=['coverage-audit.json','negative-control-results.json','verification.log','checkpoints.json','source-identities.json','verification-plan.json','verification-budget.json','coverage-results.json']
    save('required-artifact-audit.json',{'fullInvocation':False,'overallPass':False,'artifacts':[{'path':str(out/n),'exists':(out/n).is_file(),'fullCriterionPass':False,'reason':'scoped offline comparison only' if (out/n).is_file() else 'missing; full invocation prerequisite-gated'} for n in required]})
    print('SCOPED_PASS='+str(passed)+' FULL_TASK_PASS=False elapsedMs='+str(elapsed),flush=True)
