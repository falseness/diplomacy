#!/usr/bin/env python3
"""One measured AC3 acquisition, with actual child exits and no hidden retries."""
import datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time
root=pathlib.Path('/root/diplomacy')
out=pathlib.Path(sys.argv[1]).absolute()
assert not out.exists(), 'fresh invocation required'
out.mkdir(parents=True)
start=time.time(); deadline=start+3300
node='/usr/local/lib/nodejs/node-v20.20.2-linux-x64/bin/node'
env=dict(os.environ,NODE_PATH='/opt/diplomacy/node_modules',PLAYWRIGHT_BROWSERS_PATH='0')
commands=[]; success=False
save=lambda n,x:(out/n).write_text(json.dumps(x,indent=2)+'\n')
files=['test_terminal_command_boundary.js','terminal_ac3_provider.js','review_terminal_ac3.js','test_terminal_ac3.js','evidence_terminal_ac3_selection.js','evidence_terminal_ac3_gate.js','run_terminal_ac3_consumer.js','run_terminal_ac3_integration.py','terminal_ac2_provider.js','test_terminal_ac2_provider.js','review_terminal_ac2_join.js','review_terminal_ac2.js',
       'test_terminal_ac2_join.js','terminal_passive_capture.js','terminal_page_capture.js','test_terminal_page_capture.js','evidence_terminal_ac2_selection.js','evidence_terminal_ac2_gate.js','run_terminal_ac2_consumer.js','run_terminal_ac2_integration.py']
hashes=lambda:{str(root/'ops'/n):hashlib.sha256((root/'ops'/n).read_bytes()).hexdigest() for n in files}
before=hashes()
plan={'fullInvocation':False,'estimateMs':1800000,'stopWorkMs':3300000,'budgetMs':3600000,
 'cases':['joined-reader-contract','source-provider-wiring','terminal-victory','terminal-draw','terminal-to-coop','terminal-to-competitive','whole-ac3-consumer','hash-exit-cleanup-audit'],
 'tiers':{'contract':'synthetic source only','provider':'four shipped browser/HTTPS/Socket.IO/MongoDB journeys'},
 'newCases':['menu-to-coop','menu-to-competitive','both-recipient-first-move','named-old-listener-invocations','whole-ac3-consumer'],
 'exclusions':['full TASK-225 audit: required local prerequisites remain','later tasks'],
 'commands':[[node,'--test','ops/test_terminal_command_boundary.js','ops/test_terminal_ac3.js','ops/test_terminal_ac2_join.js','ops/test_terminal_ac2_provider.js','ops/test_terminal_page_capture.js'],
 [node,'/root/diplomacy_server/tests/reliability/run.js','--suite','terminal-flow','--output-dir',str(out/'provider')],
 [node,'ops/run_terminal_ac3_consumer.js',str(out)],['git','diff','--check'],['git','-C','/root/diplomacy_server','diff','--check']]}
save('verification-plan.json',plan)
(out/'page-source').mkdir()
active=None

def command(argv,cwd,extra=None,name='command'):
 global active
 assert time.time()<deadline,'cumulative deadline'
 started=time.time()
 with (out/(name+'.log')).open('x') as stream:
  active=subprocess.Popen(argv,cwd=cwd,env=dict(env,**(extra or {})),stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
  try: code=active.wait(timeout=max(1,deadline-time.time()))
  except subprocess.TimeoutExpired:
   os.killpg(active.pid,signal.SIGTERM)
   try: code=active.wait(timeout=45)
   except subprocess.TimeoutExpired: os.killpg(active.pid,signal.SIGKILL);code=active.wait()
  record={'argv':argv,'cwd':str(cwd),'pid':active.pid,'actualExit':code,'signal':None if code>=0 else -code,
          'startedMs':round(started*1000),'finishedMs':round(time.time()*1000),'environment':extra or {}}
  active=None
 commands.append(record);save(name+'-exit.json',record)
 with (out/'verification.log').open('a') as log:
  log.write('COMMAND '+json.dumps(argv)+' CWD='+str(cwd)+' ENV='+json.dumps(extra or {})+'\n')
  log.write((out/(name+'.log')).read_text());log.write('\nACTUAL_EXIT='+str(code)+'\n')
 assert code==0,name+' failed: '+str(code)

try:
 command(plan['commands'][0],root,{'COMMAND_BOUNDARY_OUTPUT':str(out/'command-boundary-checkpoints.json'),'AC3_OUTPUT':str(out/'ac3-contract-checkpoints.json'),'AC2_JOIN_OUTPUT':str(out/'contract-checkpoints.json'),'TERMINAL_ADAPTER_OUTPUT':str(out/'page-source')},'source')
 save('negative-control-results.json',{'fullInvocation':False,'checkpoints':[c for c in (json.loads((out/'contract-checkpoints.json').read_text())['checkpoints']+json.loads((out/'ac3-contract-checkpoints.json').read_text())['checkpoints']) if c['id'].startswith('reject/')]})
 command(plan['commands'][1],'/root/diplomacy_server',{'TERMINAL_AC3_CAPTURE':'1','NODE_OPTIONS':'--require /root/diplomacy/ops/terminal_ac3_provider.js','OPENING_COMPETITIVE_STOP_AT':str(round(deadline*1000))},'provider')
 command(plan['commands'][2],root,{'EVIDENCE_AUDIT_DEADLINE_MS':str(round(deadline*1000))},'consumer')
 success=True
except BaseException as e:
 save('acquisition-stop.json',{'error':str(e),'fullInvocation':False,'overallPass':False,'providerRetained':True})
finally:
 for i,argv in enumerate(plan['commands'][3:]):
  try: command(argv,root,name='diff-check-'+str(i))
  except Exception: success=False
 after=hashes();save('source-identities.json',{'before':before,'after':after});success=success and before==after
 cleanup=[]
 for file in (out/'provider').glob('terminal-*/cleanup.json'):
  c=json.loads(file.read_text());cleanup.append({'path':str(file),'pass':all(not p['aliveAfter'] for p in c['processes']) and all(not d['existsAfter'] and not pathlib.Path(d['path']).exists() for d in c['directories'])})
 save('cleanup-audit.json',cleanup)
 clean=len(cleanup)==4 and all(c['pass'] for c in cleanup) and active is None
 elapsed=round((time.time()-start)*1000)
 save('verification-budget.json',{'fullInvocation':False,'overallPass':False,'scopePass':success and clean and elapsed<3600000,
  'startedMs':round(start*1000),'finishedMs':round(time.time()*1000),'elapsedMs':elapsed,'commands':commands,'cleanup':clean})
 save('coverage-results.json',{'fullInvocation':False,'overallPass':False,'scopePass':success,'commands':commands,'fullTaskPrerequisitesOpen':True})
 required=['coverage-audit.json','negative-control-results.json','verification.log','checkpoints.json','source-identities.json','verification-budget.json','verification-plan.json','coverage-results.json']
 save('required-artifact-audit.json',[{'path':str(out/n),'exists':(out/n).exists(),'fullTaskCondition':'FAILED: full invocation remains prerequisite-gated'} for n in required])
 print(json.dumps({'output':str(out),'scopePass':success,'elapsedMs':elapsed,'cleanup':clean}),flush=True)
sys.exit(0 if success and clean and elapsed<3600000 else 1)
