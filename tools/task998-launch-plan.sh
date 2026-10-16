#!/usr/bin/env bash
# Offline launch accounting only; never executes gameplay or grants admission.
set -euo pipefail
python3 - "$@" <<'PY'
import collections,hashlib,json,os,pathlib,stat,subprocess,sys
base=pathlib.Path('/root/diplomacy/artifacts').resolve(); task=base/'TASK-998'
out=pathlib.Path(sys.argv[1]).resolve(); assert out.is_relative_to(task)
out.mkdir(parents=True,exist_ok=True)
inputs={}
def read(relative):
 p=task/relative; b=p.read_bytes(); inputs[str(p)]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}; return json.loads(b)
ledger=read('recovery-13/ledger-completed.json'); measurements=read('recovery-24/measurements.json'); controls=read('recovery-25/after-results.json')
server=pathlib.Path('/root/diplomacy_server')
selection=json.loads(subprocess.check_output(['/usr/local/bin/node20','-e',"console.log(JSON.stringify(require('./tests/helpers/runUndoCoverage').selection()))"],cwd=server))
rows=selection['included']; ids={r['id'] for r in rows}; assert len(ids)==len(rows)==3900
historical={r['matrixID']:r for r in ledger['rows']}; assert set(historical)==ids
population=collections.Counter(r['moduleID'] for r in ledger['rows']); assert len(population)==18
by_module={r['module']:r for r in measurements['rows']}; assert set(by_module)==set(population)
# Singleton main invocations are real supported grouping, each with its own sealed root.
# Additional fragments/splits must revise this plan before admission.
launches=[{'matrixID':r['id'],'moduleID':historical[r['id']]['moduleID'],'outerDeadlineMs':590000,'caseCount':1} for r in rows]
control_costs={}
for c in controls:
 if c['mode']=='shared':
  assert c['runs'][1]['rejectedSealed']; continue
 assert all(r['exitStatus']==0 and r['state']['sealed'] and not r['state']['failure'] for r in c['runs'])
 parts=collections.Counter()
 for f in c['files']:
  p=pathlib.Path(f['path']); assert p.resolve().is_relative_to(task)
  assert p.stat().st_size==f['bytes'],'changed control: '+str(p)
  inputs[str(p)]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':f['bytes']}
  kind=('proof' if p.name=='scenario.json' else 'dictionary' if p.name=='.proof-dictionary.json' else 'budgetMetadata' if p.name=='.evidence-budget.json' else 'logs' if p.suffix=='.log' else 'reports')
  parts[kind]+=f['bytes']
 assert sum(parts.values())==c['storedBytes']
 control_costs[c['mode']]={'launches':len(c['runs']),'storedBytes':c['storedBytes'],'components':dict(parts),'maxObservedActiveOverlapBytes':max(r['state']['peakBytes']-r['state']['usedBytes'] for r in c['runs']),'scope':'saved-input producer; service/activity costs absent; not a population bound'}
module_rows=[]
for module,n in sorted(population.items()):
 sample=by_module[module]; assert historical[sample['matrixID']]['moduleID']==module
 module_rows.append({'moduleID':module,'population':n,'sampleMatrixID':sample['matrixID'],'standaloneHistoricalProofBytes':sample['baselineBytes'],'weightedStandaloneProofBytes':n*sample['baselineBytes'],'measuredHistoricalIDs':sum(r['measured'] for r in ledger['rows'] if r['moduleID']==module)})
# Never transfer dictionary savings measured with one shared seed to independent roots.
proof=sum(r['weightedStandaloneProofBytes'] for r in module_rows)
metadata=len(launches)*4096
receipt=sum(r['receiptBytes'] for r in ledger['rows'])
seen=set(); stored=0
for d,ds,files in os.walk(base,followlinks=False):
 ds[:]=[n for n in ds if not os.path.ismount(os.path.join(d,n))]
 for n in files:
  s=os.lstat(os.path.join(d,n)); key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen: seen.add(key); stored+=s.st_size
assert stored<40*1024**3
plan={'admitted':False,'scope':'offline singleton-launch cost plan; no gameplay proof','population':len(ids),'moduleCount':len(population),'launchCount':len(launches),'launches':launches,'modules':module_rows,'controls':control_costs,'canonicalStoredBytes':stored,'headroomBytes':40*1024**3-stored,'weightedHistoricalStandaloneProofBytes':proof,'budgetMetadataBytes':metadata,'historicalReceiptBytes':receipt,'knownIllustrativeSubtotalBytes':proof+metadata+receipt,'illustrativeDeficitBytes':proof+metadata+receipt-(40*1024**3-stored),'dictionaryPolicy':'No cross-launch seed reuse. Standalone projection uses baselineBytes; current dictionary mode costs require independent-root measurement per stratum. Two measured seeds cannot bound 3900 seeds.','unresolved':['Future successful proof upper bounds for all strata (69 historical IDs, 3831 unmeasured)','Independent dictionary seed and proof costs for every launch stratum','Native service/activity logs; control logs are synthetic','Final reports/index/receipts and replacement overlap at population scale','Additional fragment launches after deterministic sequence/variant splitting','Startup-through-cleanup timing of each proposed launch'],'sequentialStaging':'Only one launch active. Measured overlap is historical, not an admitted bound. Retained totals accumulate; overlap must not be multiplied as permanent padding.','inputs':inputs,'sourceHashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [server/'tests/helpers/runUndoCoverage.js',server/'tests/helpers/evidenceBudget.js',server/'tests/helpers/proofCodec.js']}}
(out/'launch-plan.json').write_text(json.dumps(plan,separators=(',',':'))+'\n')
print('PASS exact inventory: 3900 IDs / 18 modules / 3900 independent launch roots; deadline 590000ms')
print('PASS sealed control totals and source file sizes/hash references reconciled')
print('PASS canonical storedBytes='+str(stored)+' <42949672960')
print('NOT ADMITTED: illustrative standalone subtotal='+str(plan['knownIllustrativeSubtotalBytes'])+' headroom='+str(plan['headroomBytes'])+' deficit='+str(plan['illustrativeDeficitBytes']))
print('UNRESOLVED service/activity, reports/index, future proof bounds, dictionary roots, fragment count and staging; no gameplay executed')
PY
