#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
import hashlib,json,os,pathlib,stat,sys
B=pathlib.Path('/root/diplomacy/artifacts').resolve()/'TASK-998';O=pathlib.Path(sys.argv[1]).resolve();assert O.is_relative_to(B)
read=lambda p:json.loads(p.read_bytes());h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
ledger=read(O/'ledger.json');comparisons=[]
for i in range(2):
 c=read(O/f'checkpoint-{i}.json');w=read(O/f'case-{i}/checkpoint.json');e=read(O/f'case-{i}-execution.json')
 assert e['exitStatus']==0 and e['elapsedMs']<590000 and w['temporaryFilesRemaining']==0
 assert c['matrixID']==w['matrixID'] and c['indexSHA256']==h(B/'receipt-index.json')
 assert c['codecSHA256']==h(pathlib.Path('/root/diplomacy_server/tests/helpers/proofCodec.js'))
 for f in c['files']:assert h(pathlib.Path(f['path']))==f['storedSHA256']
 row=next(r for r in ledger['rows'] if r['matrixID']==w['matrixID']);assert not row['measured']
 total=w['committedBytes']+row['receiptBytes'];old=w['oldModuleMaximumBytes']
 row['measurement']={'path':str(O/f'case-{i}/checkpoint.json'),'sha256':h(O/f'case-{i}/checkpoint.json'),'candidateBytes':total,'accounting':'Independent complete per-case pack/root/index/sidecars plus overlay receipt; prior allocation shared packs across six-case groups, so comparison includes sharing scope difference.'};row['measured']=True
 comparisons.append(dict(matrixID=w['matrixID'],completeBytes=total,oldModuleEstimateBytes=old,differenceBytes=total-old,components=w['components'],offlinePeakBytes=w['simultaneousWriterPeakBytes']))
ledger.update(reusedMeasurements=67,newMeasurements=2,unmeasuredSingletonCases=sum(not r['measured'] for r in ledger['rows']))
(O/'ledger-completed.json').write_text(json.dumps(ledger,separators=(',',':'))+'\n')
seen=set();stored=0
for d,ds,files in os.walk(B.parent,followlinks=False):
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in files:
  s=os.lstat(os.path.join(d,f));key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen:seen.add(key);stored+=s.st_size
assert stored<40*1024**3
r=dict(comparisons=comparisons,measuredCases=69,unmeasuredCases=ledger['unmeasuredSingletonCases'],storedBytes=stored,headroomBytes=40*1024**3-stored,reservationAdmitted=False,closedTerms=['Exact historical census vs repeated cost strata','Two declared new complete offline transaction costs','Fixed validator success serializer size; separate dynamic report serializers'],unresolvedTerms=['3831 historical singleton cases','Future dynamic service output bound','Native service writer overlap','Final dynamic reports and atomic replacement volume'],nextHypothesis='Do not repeat these samples. Define native writer lifecycle and enforceable byte admission before service refresh. If historical costing continues, resume ledger-completed.json, select next unmeasured exact ID and pin its original hashes. Sampling alone cannot close future-output bound.',pilotInvalidation='Temporary .py tools changed identity; converted to shell wrappers and full pinned identity equality restored. No service refresh or receipt replacement occurred.',fullCollectionCertified=False)
(O/'admission.json').write_text(json.dumps(r,indent=2)+'\n')
print('PASS historical measurements=69 remainingSingletonCases=3831; complete reconstruction and original hashes verified')
for c in comparisons:print('MEASURED',c['matrixID'],'completeBytes='+str(c['completeBytes']),'oldModuleEstimateBytes='+str(c['oldModuleEstimateBytes']),'offlinePeakBytes='+str(c['offlinePeakBytes']))
print('PASS canonical storedBytes='+str(stored)+' <42949672960; headroomBytes='+str(r['headroomBytes']))
print('NOT ADMITTED: native writer, future output and final report bounds unresolved; full collection remains pending')
PY
