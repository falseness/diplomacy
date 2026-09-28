#!/usr/bin/env python3
"""Bounded AC7 consumption; no provider replay and no full audit claim."""
import sys, os, json, time, subprocess, pathlib, hashlib, signal
ROOT=pathlib.Path('/root/diplomacy'); BASE=ROOT/'artifacts/TASK-225/smoke-158/run-03'
out=pathlib.Path(sys.argv[1]).absolute();out.mkdir(parents=True,exist_ok=False)
start=time.time();stop=start+3300;commands=[];active=None
NODE='/usr/local/bin/node20'
def save(n,x): (out/n).write_text(json.dumps(x,indent=2)+'\n')
def digest(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def interrupt(n,f):
    if active is not None and active.poll() is None:
        os.killpg(active.pid,signal.SIGTERM)
        try: active.wait(timeout=15)
        except subprocess.TimeoutExpired: os.killpg(active.pid,signal.SIGKILL);active.wait()
    raise KeyboardInterrupt(n)
signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
def command(label,argv,cwd=ROOT):
    global active
    assert time.time()<stop,'deadline'
    begun=time.time()
    with (out/(label+'.log')).open('w') as log:
        active=subprocess.Popen(argv,cwd=cwd,env={**os.environ,'NODE_PATH':'/opt/diplomacy/node_modules','EVIDENCE_AUDIT_DEADLINE_MS':str(int(stop*1000))},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        timed=False
        try: code=active.wait(timeout=max(1,stop-time.time()))
        except subprocess.TimeoutExpired:
            timed=True;os.killpg(active.pid,signal.SIGTERM)
            try: code=active.wait(timeout=15)
            except subprocess.TimeoutExpired: os.killpg(active.pid,signal.SIGKILL);code=active.wait()
    receipt={'argv':argv,'cwd':str(cwd),'actualExit':code,'timedOut':timed,'startedMs':round(begun*1000),'elapsedMs':round((time.time()-begun)*1000)}
    commands.append(receipt);save(label+'-exit.json',receipt)
    with (out/'verification.log').open('a') as log: log.write(json.dumps(receipt)+'\n'+(out/(label+'.log')).read_text()+'\n')
    assert code==0 and not timed,label+' failed'
    return (out/(label+'.log')).read_text()
cases=['retained-bindings','bounded-selection','independent-protocol-oracles','actual-fixture-admission','corrupt-proof-rejection','cumulative-whole-row-consumption','handoff-audit']
save('verification-plan.json',{'fullInvocation':False,'cases':cases,'estimateMs':1800000,'stopWorkMs':3300000,'budgetMs':3600000,'commands':[[NODE,'--test','ops/test_smoke_bounds.js'],[NODE,'ops/run_smoke_bounds_review.js',str(out)],['git','diff','--check']],'tiers':['source-only lookup and tier controls','retained real HTTPS/Socket.IO/Mongo proof','current cumulative consumer'],'exclusions':['no new provider','no UI claim','no AC4 location credit','full invocation remains prerequisite-gated']})
checks=[]
def ck(id,e,o):
    checks.append({'id':id,'expected':e,'observed':o,'pass':e==o});assert e==o,id
bindings=json.loads((ROOT/'artifacts/TASK-225/smoke-tiers-159/run-02/source-identities.json').read_text())['bindings']
bindings.update({f['path']:f['originalSha256'] for f in json.loads((ROOT/'artifacts/TASK-225/work-order-151/source-freeze.json').read_text())['files']})
provider=json.loads((BASE/'provider/source-identities.json').read_text())
for phase in ['before','after']:
    for repo in provider[phase].values():
        for file,h in repo['files'].items(): bindings[str(pathlib.Path(repo['repo'])/file)]=h
for file,h in json.loads((BASE/'provider/evidence-hashes.json').read_text()).items():bindings[str(BASE/'provider'/file)]=h
# Freeze new reviewer closure and inherited reviewer entry point without editing them.
for file in list(ROOT.glob('ops/*smoke_bounds*'))+[ROOT/'ops/task225-smoke-bounds.md']: bindings[str(file)]=digest(file)
save('source-identities.json',{'fullInvocation':False,'bindings':bindings,'provider':str(BASE/'provider/source-identities.json')})
passed=False
try:
    for f,h in bindings.items():ck('before/'+f,h,digest(f))
    save('retained-binding-audit.json',{'pass':True,'bindings':len(bindings)})
    command('runtime',[NODE,'--version']);command('source-tests',[NODE,'--test','ops/test_smoke_bounds.js'])
    command('consumer',[NODE,'ops/run_smoke_bounds_review.js',str(out)])
    for name,repo in [('client',ROOT),('server',pathlib.Path('/root/diplomacy_server'))]:
        command(name+'-diff-check',['git','diff','--check'],repo)
        ck(name+'/unstaged-artifacts','',command(name+'-staged-artifacts',['git','diff','--cached','--name-only','--','artifacts'],repo))
    for f,h in bindings.items():ck('after/'+f,h,digest(f))
    cps=json.loads((out/'checkpoints.json').read_text())['checks']
    for c in cps:ck(c['id'],c['expected'],c['observed']);ck(c['id']+'/pass',True,c['pass'])
    result=json.loads((out/'scoped-result.json').read_text());ck('scope-result',True,result['scopePass']);ck('self-owners',8,result['selfOwners'])
    passed=True
finally:
    elapsed=round((time.time()-start)*1000)
    save('handoff-audit.json',{'scopePass':passed,'fullTaskPass':False,'assertions':len(checks),'checks':checks})
    save('verification-budget.json',{'fullInvocation':False,'scopePass':passed and elapsed<3300000,'overallPass':False,'elapsedMs':elapsed,'startedMs':round(start*1000),'finishedMs':round(time.time()*1000),'commands':commands,'cleanup':active is None or active.poll() is not None,'cleanupReason':'No services launched; all owned command children reaped.'})
    save('coverage-results.json',{'fullInvocation':False,'scopePass':passed,'overallPass':False,'cases':[{'id':c,'pass':passed,'proofs':['handoff-audit.json','consumer-exit.json','checkpoints.json']} for c in cases],'evidenceHashes':{f.name:digest(f) for f in out.iterdir() if f.is_file() and f.name!='coverage-results.json'}})
    required=['coverage-audit.json','negative-control-results.json','verification.log','checkpoints.json','source-identities.json','verification-plan.json','verification-budget.json','coverage-results.json']
    save('required-artifact-audit.json',{'overallPass':False,'artifacts':[{'path':str(out/n),'exists':(out/n).is_file(),'fullCriterionPass':False,'reason':'scoped only; full invocation prerequisite-gated' if (out/n).is_file() else 'missing; full invocation prerequisite-gated'} for n in required]})
    print('SCOPED_PASS='+str(passed)+' FULL_TASK_PASS=False elapsedMs='+str(elapsed),flush=True)
