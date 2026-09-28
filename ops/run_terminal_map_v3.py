#!/usr/bin/env python3
"""One changed reconnect diagnostic acquisition; retain the map v2 contract and original waits."""
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
files=['terminal_reconnect_probe_v1.js','test_terminal_reconnect_probe_v1.js','supervise_terminal_reconnect_v1.py','supervise_terminal_map_v3.py','task225-terminal-reconnect-v1.md','terminal_map_provider_v2.js','test_terminal_map_provider_v2.js','test_terminal_map_shutdown_v2.py','run_terminal_map_v3.py','supervise_terminal_map_v2.py','task225-terminal-map-v2.md','terminal_ac3_provider.js','terminal_ac2_provider.js','terminal_passive_capture.js','terminal_page_capture.js']
hashes=lambda:{str(root/'ops'/n):hashlib.sha256((root/'ops'/n).read_bytes()).hexdigest() for n in files}
before=hashes()
plan={'fullInvocation':False,'estimateMs':1800000,'stopWorkMs':3300000,'budgetMs':3600000,
 'cases':['joined-reader-contract','source-provider-wiring','terminal-victory','terminal-draw','terminal-to-coop','terminal-to-competitive','hash-exit-cleanup-audit'],
 'tiers':{'contract':'synthetic source only','provider':'four shipped browser/HTTPS/Socket.IO/MongoDB journeys'},
 'newCases':['menu-to-coop','menu-to-competitive','both-recipient-first-move','named-old-listener-invocations','both-participant-smallest-map-selection'],
 'exclusions':['full TASK-225 audit: required local prerequisites remain','later tasks'],
 'commands':[[node,'--test','ops/test_terminal_reconnect_probe_v1.js','ops/test_terminal_map_provider_v2.js','ops/test_terminal_command_boundary.js','ops/test_terminal_ac3.js','ops/test_terminal_ac2_join.js','ops/test_terminal_ac2_provider.js','ops/test_terminal_page_capture.js'],
 ['python3','ops/test_terminal_map_shutdown_v2.py'],
 [node,'/root/diplomacy_server/tests/reliability/run.js','--suite','terminal-flow','--output-dir',str(out/'provider')],
['git','diff','--check'],['git','-C','/root/diplomacy_server','diff','--check']]}
plan['clauseMap']='ops/task225-terminal-map-v2.md'
plan['sourceCases']=['victory','defeat','draw','competitive-draw','competitive-survivor']
plan['humans']=2;plan['seed']=1;plan['competitiveMap']={'name':'tiny deathmatch','x':20,'y':10}
save('verification-plan.json',plan)
save('predeclared-tools.json',before)
(out/'page-source').mkdir()
active=None

def stop_owned(child):
 # The reliability runner creates a detached node:test child. Signal the actual
 # suite worker first so its finally blocks finish and the runner keeps receipts.
 descendants={child.pid}; workers=[]
 processes=[]
 for entry in pathlib.Path('/proc').iterdir():
  if not entry.name.isdigit(): continue
  try:
   fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
   argv=(entry/'cmdline').read_bytes().split(b'\0')
   processes.append((int(entry.name),int(fields[1]),argv))
  except (FileNotFoundError,ProcessLookupError,PermissionError): pass
 for _ in processes:
  added={pid for pid,parent,_argv in processes if parent in descendants}-descendants
  if not added: break
  descendants.update(added)
 for pid,parent,argv in processes:
  if pid in descendants and any(a.endswith(b'/terminal-flow.test.js') for a in argv) and b'--test' not in argv:
   workers.append(pid)
 for pid in workers:
  try: os.kill(pid,signal.SIGTERM)
  except ProcessLookupError: pass
 if not workers:
  try: os.killpg(child.pid,signal.SIGTERM)
  except ProcessLookupError: pass
 return {'descendants':sorted(descendants),'workersSignaled':workers}

def interrupted(number, frame):
 if active is not None:
  save('stop-forwarding.json',stop_owned(active))
signal.signal(signal.SIGTERM,interrupted)
signal.signal(signal.SIGINT,interrupted)

def command(argv,cwd,extra=None,name='command'):
 global active
 assert time.time()<deadline,'cumulative deadline'
 started=time.time()
 with (out/(name+'.log')).open('x') as stream:
  active=subprocess.Popen(argv,cwd=cwd,env=dict(env,**(extra or {})),stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
  try: code=active.wait(timeout=max(1,deadline-time.time()))
  except subprocess.TimeoutExpired:
   save('timeout-forwarding.json',stop_owned(active))
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
 command(plan['commands'][1],root,name='shutdown-source')
 command(plan['commands'][2],'/root/diplomacy_server',{'TERMINAL_MAP_CAPTURE':'1','NODE_OPTIONS':'--require /root/diplomacy/ops/terminal_reconnect_probe_v1.js','OPENING_COMPETITIVE_STOP_AT':str(round(deadline*1000))},'provider')
 success=True
except BaseException as e:
 save('acquisition-stop.json',{'error':str(e),'fullInvocation':False,'overallPass':False,'providerRetained':True})
finally:
 for i,argv in enumerate(plan['commands'][3:]):
  try: command(argv,root,name='diff-check-'+str(i))
  except Exception: success=False
 after=hashes();save('source-identities.json',{'before':before,'after':after});success=success and before==after
 cleanup=[]
 evidence=out/'provider'
 if not (evidence/'checkpoints.json').exists(): evidence=evidence/'children/001-reliability_terminal-flow/evidence'
 for file in evidence.glob('terminal-*/cleanup.json'):
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
