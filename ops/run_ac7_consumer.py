#!/usr/bin/env python3
"""Bounded whole-AC7 cumulative consumption; no provider replay and no full audit claim."""
import sys, os, json, time, subprocess, pathlib, hashlib, signal, re
ROOT=pathlib.Path('/root/diplomacy'); NODE='/usr/local/bin/node20'
run,work,evidence=(pathlib.Path(a).absolute() for a in sys.argv[1:4])
work.mkdir(parents=True,exist_ok=False);evidence.mkdir(parents=True,exist_ok=True)
start=time.time();stop=start+3300;commands=[];active=None
def save(n,x): (evidence/n).write_text(json.dumps(x,indent=2)+'\n')
def digest(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def interrupt(n,f):
    if active is not None and active.poll() is None:
        os.killpg(active.pid,signal.SIGTERM)
        try: active.wait(timeout=15)
        except subprocess.TimeoutExpired: os.killpg(active.pid,signal.SIGKILL);active.wait()
    raise KeyboardInterrupt(n)
signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
def command(label,argv,expected=0,cwd=ROOT,log='consumer.log'):
    global active
    assert time.time()<stop,'deadline'
    begun=time.time();stream=work/(label+'.out')
    with stream.open('w') as out:
        active=subprocess.Popen(argv,cwd=cwd,env={**os.environ,'NODE_PATH':'/opt/diplomacy/node_modules'},stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
        timed=False
        try: code=active.wait(timeout=max(1,stop-time.time()))
        except subprocess.TimeoutExpired:
            timed=True;os.killpg(active.pid,signal.SIGTERM)
            try: code=active.wait(timeout=15)
            except subprocess.TimeoutExpired: os.killpg(active.pid,signal.SIGKILL);code=active.wait()
    text=stream.read_text()
    receipt={'label':label,'argv':argv,'cwd':str(cwd),'actualExit':code,'expectedExit':expected,'timedOut':timed,'startedMs':round(begun*1000),'elapsedMs':round((time.time()-begun)*1000)}
    commands.append(receipt)
    with (evidence/log).open('a') as f: f.write('COMMAND '+json.dumps(argv)+'\nCWD '+str(cwd)+'\n'+text+('' if text.endswith('\n') else '\n')+'ACTUAL_EXIT '+str(code)+' EXPECTED_EXIT '+str(expected)+' TIMED_OUT '+str(timed)+' ELAPSED_MS '+str(receipt['elapsedMs'])+'\n\n')
    assert code==expected and not timed,label+' exit '+str(code)
    return text
tools=['ac7_terminal_reader.js','test_ac7_terminal_reader.js','ac7_consumer_selection.js','run_ac7_consumer.js','run_ac7_consumer.py','reconcile_evidence_catalog.js','consume_historical_catalog.js','review_terminal_outcomes_v2.js']
before={t:digest(ROOT/'ops'/t) for t in tools}
save('tool-hashes.json',{'before':before})
for log in ['consumer.log','rejection.log']: (evidence/log).write_text('# run_ac7_consumer.py run='+str(run)+' work='+str(work)+' started='+time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(start))+'\n\n')
passed=False
try:
    command('runtime',[NODE,'--version'])
    command('reader-tests',[NODE,'--test','ops/test_ac7_terminal_reader.js'])
    command('reader',[NODE,'ops/ac7_terminal_reader.js',str(run)])
    command('consumer',[NODE,'ops/run_ac7_consumer.js','positive',str(run),str(work),str(evidence)])
    reasons={'deleted-proof':r'REJECT consumer-preflight reason=deleted-proof:terminal-to-coop/network-traces\.jsonl\n','tampered-proof':r'REJECT consumer-preflight reason=tampered-proof:terminal-to-competitive/network-traces\.jsonl'}
    for cid,pattern in reasons.items():
        text=command('control-'+cid,[NODE,'ops/run_ac7_consumer.js','control',cid,str(work)],expected=1,log='rejection.log')
        assert re.search(pattern,text),cid+' reason'
        assert 'REJECT root-consumer status=invalid-review covered=false' in text,cid+' root consumer'
    for name,repo in [('client',ROOT),('server',pathlib.Path('/root/diplomacy_server'))]:
        command(name+'-diff-check',['git','diff','--check'],cwd=repo)
    after={t:digest(ROOT/'ops'/t) for t in tools}
    save('tool-hashes.json',{'before':before,'after':after,'unchanged':before==after})
    assert before==after,'tools changed during run'
    passed=True
finally:
    elapsed=round((time.time()-start)*1000)
    save('verification-budget.json',{'fullInvocation':False,'scopePass':passed and elapsed<3300000,'overallPass':False,'elapsedMs':elapsed,'commands':commands,'cleanup':active is None or active.poll() is not None})
    with (evidence/'consumer.log').open('a') as f: f.write('SCOPED_PASS='+str(passed)+' FULL_TASK_PASS=False elapsedMs='+str(elapsed)+'\n')
    print('SCOPED_PASS='+str(passed)+' FULL_TASK_PASS=False elapsedMs='+str(elapsed),flush=True)
sys.exit(0 if passed else 1)
