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
ledger=read('recovery-13/ledger-completed.json'); measurements=read(sys.argv[2] if len(sys.argv)>2 else 'recovery-27/measurements.json'); controls=read('recovery-25/after-results.json')
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
 module_rows.append({'moduleID':module,'population':n,'sampleMatrixID':sample['matrixID'],'historicalRootBytes':sample['storedBytes'],'weightedHistoricalRootBytes':n*sample['storedBytes'],'encoding':sample['encoding'],'samplePeakBytes':sample['peakBytes'],'measuredHistoricalIDs':sum(r['measured'] for r in ledger['rows'] if r['moduleID']==module)})
# Native singleton measurements include their actual seed and metadata charges.
proof=sum(r['weightedHistoricalRootBytes'] for r in module_rows)
metadata=0 # Native measured roots already include their 4096-byte metadata.
receipt=sum(r['receiptBytes'] for r in ledger['rows'])
# Inventory real retained launch sidecars without inventing service log sizes.
# Paths may overlap between historical receipts; charge unique files once here.
sidecars={}; observed=collections.Counter(); missing=[]
for row in ledger['rows']:
 if not row['measured']: continue
 for original in row['originalHashes']:
  root=pathlib.Path(original['proofPath']).parent
  for p in root.rglob('*'):
   if not p.is_file() or p.is_symlink() or p.name=='scenario.json': continue
   resolved=p.resolve()
   if not resolved.is_relative_to(base):
    missing.append({'matrixID':row['matrixID'],'external':str(p)}); continue
   name=str(resolved)
   if name in sidecars: continue
   b=p.read_bytes()
   kind=('workerProviderLogs' if any(k in p.name.lower() for k in ['worker','mongo','provider']) else 'serviceActivityLogs' if p.suffix=='.log' else 'executionCleanupReports' if any(k in p.name.lower() for k in ['execution','cleanup']) else 'indexesReceipts' if any(k in p.name.lower() for k in ['index','receipt']) else 'otherSidecars')
   sidecars[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'category':kind}; observed[kind]+=len(b)
reconciliation={'historicalMeasuredIDs':sum(r['measured'] for r in ledger['rows']),'unmeasuredIDs':sum(not r['measured'] for r in ledger['rows']),'ledgerSidecarBytes':sum(r['sidecarBytes'] for r in ledger['rows']),'measuredLedgerSidecarBytes':sum(r['sidecarBytes'] for r in ledger['rows'] if r['measured']),'derivedUnmeasuredLedgerSidecarBytes':sum(r['sidecarBytes'] for r in ledger['rows'] if not r['measured']),'missingStrataByModule':{m:sum(not r['measured'] for r in ledger['rows'] if r['moduleID']==m) for m in population},'uniqueObservedSidecars':dict(observed),'missingObservedCategories':[k for k in ['workerProviderLogs','serviceActivityLogs','executionCleanupReports','indexesReceipts'] if not observed[k]],'files':sidecars,'unresolvedPaths':missing,'populationProjection':None,'reason':'Historical sidecars are observations only; native codec/log changes invalidate size transfer. Service logs outside proof roots, future output strata, final aggregate indexes, extra fragment launches and active writer/report staging have no full-volume bound.'}
seen=set(); stored=0
for d,ds,files in os.walk(base,followlinks=False):
 ds[:]=[n for n in ds if not os.path.ismount(os.path.join(d,n))]
 for n in files:
  s=os.lstat(os.path.join(d,n)); key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen: seen.add(key); stored+=s.st_size
assert stored<40*1024**3
plan={'admitted':False,'scope':'offline singleton-launch native root cost plan; no gameplay proof','population':len(ids),'moduleCount':len(population),'launchCount':len(launches),'launches':launches,'modules':module_rows,'controls':control_costs,'costReconciliation':reconciliation,'canonicalStoredBytes':stored,'headroomBytes':40*1024**3-stored,'weightedHistoricalRootBytes':proof,'additionalBudgetMetadataBytes':metadata,'metadataAlreadyInRootsBytes':len(launches)*4096,'historicalReceiptBytes':receipt,'knownIllustrativeSubtotalBytes':proof+metadata+receipt,'illustrativeDeficitBytes':proof+metadata+receipt-(40*1024**3-stored),'dictionaryPolicy':'No cross-launch seed reuse. Native measured independent roots include actual dictionary and metadata costs; sample hashes and encoding are bound. Historical samples are not future bounds.','unresolved':['Future successful proof upper bounds for all strata (69 historical IDs, 3831 unmeasured)','Native service/activity logs; control logs are synthetic','Final reports/index/receipts and replacement overlap at population scale','Additional fragment launches after deterministic sequence/variant splitting','Startup-through-cleanup timing of each proposed launch'],'sequentialStaging':'Only one launch active. Measured overlap is historical, not an admitted bound. Retained totals accumulate; overlap must not be multiplied as permanent padding.','measurementSourceHashes':measurements['sourceHashes'],'inputs':inputs,'sourceHashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [server/'tests/helpers/runUndoCoverage.js',server/'tests/helpers/evidenceBudget.js',server/'tests/helpers/proofCodec.js',server/'tests/helpers/sharedProofStorage.js']}}
(out/'launch-plan.json').write_text(json.dumps(plan,separators=(',',':'))+'\n')
print('PASS exact inventory: 3900 IDs / 18 modules / 3900 independent launch roots; deadline 590000ms')
print('PASS sealed control totals and source file sizes/hash references reconciled')
print('PASS canonical storedBytes='+str(stored)+' <42949672960')
print('NOT ADMITTED: illustrative native-root subtotal='+str(plan['knownIllustrativeSubtotalBytes'])+' headroom='+str(plan['headroomBytes'])+' deficit='+str(plan['illustrativeDeficitBytes']))
print('UNRESOLVED service/activity, reports/index, future proof bounds, fragment count and staging; no gameplay executed')
PY
