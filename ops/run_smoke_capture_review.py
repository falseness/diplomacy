#!/usr/bin/env python3
"""Single cumulative smoke capture/consumption verification budget, actual OS child receipts."""
import sys, os, json, time, subprocess, pathlib, hashlib, signal
ROOT=pathlib.Path('/root/diplomacy')
NODE='/usr/local/bin/node20'
out=pathlib.Path(sys.argv[1]).absolute();out.mkdir(parents=True,exist_ok=False)
start=time.time();stop=start+3300
commands=[]
active=None
def interrupted(number, frame):
    if active is not None and active.poll() is None:
        try: os.killpg(active.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: active.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(active.pid,signal.SIGKILL);active.wait()
    raise KeyboardInterrupt('supervisor signal '+str(number))
signal.signal(signal.SIGTERM,interrupted)
signal.signal(signal.SIGINT,interrupted)
def save(n,v): (out/n).write_text(json.dumps(v,indent=2)+'\n')
def command(label,argv,cwd=ROOT,expected=0,env=None):
    global active
    assert time.time()<stop,'cumulative deadline'
    started=time.time()
    with (out/(label+'.log')).open('w') as log:
        p=subprocess.Popen(argv,cwd=cwd,env={**os.environ,'NODE_PATH':'/opt/diplomacy/node_modules','EVIDENCE_AUDIT_DEADLINE_MS':str(int(stop*1000)),**(env or {})},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        active=p
        timed=False
        try: code=p.wait(timeout=max(1,stop-time.time()))
        except subprocess.TimeoutExpired:
            timed=True;os.killpg(p.pid,signal.SIGTERM)
            try: code=p.wait(timeout=15)
            except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);code=p.wait()
    active=None
    receipt={'label':label,'argv':argv,'cwd':str(cwd),'pid':p.pid,'actualExit':code,'signal':-code if code<0 else None,'startedMs':int(started*1000),'finishedMs':int(time.time()*1000),'timedOut':timed,'environment':env or {}}
    save(label+'-exit.json',receipt);commands.append(receipt)
    with (out/'verification.log').open('a') as f:
        f.write('COMMAND '+json.dumps(argv)+' CWD='+str(cwd)+' NODE_PATH=/opt/diplomacy/node_modules\n')
        f.write((out/(label+'.log')).read_text());f.write('\nACTUAL_EXIT='+str(code)+'\n')
    assert not timed and code==expected,(label,code)
    return (out/(label+'.log')).read_text()
cases=['capture-preserves-original-assertions','real-smoke-provider','whole-smoke-AC1-AC2-AC3-review','corruption-controls','same-source-cumulative-consumption','evidence-audit']
provider_env={'SMOKE_CAPTURE':'1','NODE_OPTIONS':'--require /root/diplomacy/ops/smoke_capture_provider.js'}
provider_command=[NODE,'tests/reliability/run.js','--suite','smoke-isolation','--output-dir',str(out/'provider')]
save('verification-plan.json',{'fullInvocation':False,'estimateMs':1800000,'stopWorkMs':3300000,'budgetMs':3600000,'cases':cases,'tiers':['production-source capture wiring','real HTTPS/Socket.IO/MongoDB','independent cumulative archive review'],'exclusions':['no UI claims','no TASK-223/AC4 literal location credit','no full audit while prior obligations remain'],'commands':[[NODE,'--test','ops/test_smoke_capture.js'],provider_command,[NODE,'ops/run_smoke_capture_review.js',str(out)],['git','diff','--check']],'environment':provider_env,'fixtures':['orphan run-a user before admission','unrelated turns sentinel before admission']})
tools=list(ROOT.glob('ops/*smoke*'))
hashes={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in tools if f.is_file()};save('review-tool-identities.json',hashes)
freeze=json.loads((ROOT/'artifacts/TASK-225/work-order-151/source-freeze.json').read_text())['files']
bindings={f['path']:f['originalSha256'] for f in freeze}
bindings.update(json.loads((ROOT/'artifacts/TASK-225/ac6-154/run-03/review-tool-identities.json').read_text()))
for f,h in bindings.items(): assert hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()==h,f
save('source-freeze.json',{'bindings':bindings,'tools':hashes,'pass':True})
passed=False
try:
    command('runtime',[NODE,'--version'])
    command('source-tests',[NODE,'--test','ops/test_smoke_capture.js'])
    command('provider',provider_command,cwd=pathlib.Path('/root/diplomacy_server'),env=provider_env)
    command('consumer',[NODE,'ops/run_smoke_capture_review.js',str(out)])
    for name,repo in [('client',ROOT),('server',pathlib.Path('/root/diplomacy_server'))]:
        command(name+'-diff-check',['git','diff','--check'],cwd=repo)
        assert command(name+'-staged-artifacts',['git','diff','--cached','--name-only','--','artifacts'],cwd=repo)==''
    for f,h in {**bindings,**hashes}.items(): assert hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()==h,f
    cps=json.loads((out/'checkpoints.json').read_text())['checks']
    assert all(c['expected']==c['observed'] and c['pass'] for c in cps)
    save('source-identities.json',{'fullInvocation':False,'provider':json.loads((out/'provider/source-identities.json').read_text()),'tools':hashes})
    passed=True
finally:
    elapsed=int((time.time()-start)*1000)
    save('verification-budget.json',{'fullInvocation':False,'overallPass':False,'scopePass':passed and elapsed<3300000,'startedMs':int(start*1000),'finishedMs':int(time.time()*1000),'elapsedMs':elapsed,'commands':commands,'cleanup':(active is None or active.poll() is not None) and (out/'provider/cleanup.json').exists() and all(not p['aliveAfter'] for p in json.loads((out/'provider/cleanup.json').read_text()).get('processes',[])),'cleanupReason':'Provider cleanup.json required; all outer command processes reaped.'})
    save('coverage-results.json',{'fullInvocation':False,'overallPass':False,'scopePass':passed,'cases':[{'id':c,'pass':passed,'proofs':['checkpoints.json','negative-control-results.json','consumer-exit.json','source-tests.log','smoke-transitions.json']} for c in cases],'fullTaskPrerequisitesOpen':True,'evidenceHashes':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in out.iterdir() if f.is_file() and f.name!='coverage-results.json'}})
    required=['coverage-audit.json','negative-control-results.json','verification.log','checkpoints.json','source-identities.json','verification-plan.json','verification-budget.json','coverage-results.json']
    save('required-artifact-audit.json',{'fullInvocation':False,'overallPass':False,'artifacts':[{'path':str(out/n),'exists':(out/n).is_file(),'fullCriterionPass':False,'reason':'scoped smoke comparison only' if (out/n).is_file() else 'missing; full invocation prerequisite-gated'} for n in required]})
    print('SCOPED_PASS='+str(passed)+' FULL_TASK_PASS=False elapsedMs='+str(elapsed),flush=True)
