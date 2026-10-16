#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
import collections,hashlib,json,os,pathlib,stat,sys
root=pathlib.Path('/root/diplomacy/artifacts').resolve();task=root/'TASK-998';out=pathlib.Path(sys.argv[1]).resolve();assert out.is_relative_to(task) and out!=task
read=lambda p:json.loads(p.read_bytes())
groups=[read(out/f'group-{i}.json') for i in range(12)];rows=[r for g in groups for r in g['rows']]
index=read(task/'receipt-index.json');lookup={r['matrixID']:r for r in index};assert len(lookup)==3900
assert len(rows)==len({r['matrixID'] for r in rows})==67
for i,g in enumerate(groups):
 assert hashlib.sha256(pathlib.Path(g['baselineReference']).read_bytes()).hexdigest()==g['baselineSHA256']
 assert hashlib.sha256((task/'receipt-index.json').read_bytes()).hexdigest()==g['indexSHA256']
 e=read(out/f'group-{i}-execution.json');assert e['exitStatus']==0 and e['elapsedMs']<590000
 assert g['temporaryFilesRemaining']==0
 assert abs(sum(r['packBytes'] for r in g['rows'])-sum(p['bytes']+p['indexBytes'] for p in g['packs']))<0.01, 'pack allocation must reconcile exact stored bytes'
pop=collections.Counter(r['moduleID'] for r in index);assert len(pop)==18
strata=[]
for m,n in pop.items():
 s=[r for r in rows if r['moduleID']==m];assert s
 for r in s:assert lookup[r['matrixID']]['moduleID']==m
 strata.append(dict(moduleID=m,population=n,sample=len(s),candidateBytes=n*sum(r['candidateBytes'] for r in s)/len(s),baselineBytes=n*sum(r['baselineBytes'] for r in s)/len(s)))
old=read(task/'recovery-10/compressed-shared-plan.json');seen=set();stored=0
for d,ds,files in os.walk(root,followlinks=False):
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in files:
  s=os.lstat(os.path.join(d,f));key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen:seen.add(key);stored+=s.st_size
weighted=sum(s['candidateBytes'] for s in strata);baseline=sum(s['baselineBytes'] for s in strata);headroom=40*1024**3-stored
report=dict(sampleCount=67,moduleCount=18,population=3900,strata=strata,unsampledFineStrata=old['unsampledFineStrata'],populationWeightedCandidateBytes=weighted,populationWeightedBaselineBytes=baseline,previousSharedCandidateBytes=old['populationWeightedCandidateBytes'],weightedSavingsBytes=baseline-weighted,headroomBytes=headroom,retainedOriginalsAndReportsBytes=stored,weightedDeficitBeforeStagingBytes=weighted-headroom,pairedCandidateBytes=sum(r['candidateBytes'] for r in rows),pairedBaselineBytes=sum(r['baselineBytes'] for r in rows),compressedPackBytes=sum(p['bytes'] for g in groups for p in g['packs']),compressedOffsetHashIndexBytes=sum(p['indexBytes'] for g in groups for p in g['packs']),perCaseRootAndReferencesBytes=sum(r['rootBytes'] for r in rows),exactSidecarsAndFramingBytes=sum(r['sidecarBytes']+r['framingBytes'] for r in rows),receiptBytes=sum(r['receiptBytes'] for r in rows),sampleMeanProjectionBytes=sum(r['candidateBytes'] for r in rows)*3900/67,sampleMaximumProjectionBytes=max(r['candidateBytes'] for r in rows)*3900,measuredOfflinePackWriteCleanupPeakBytes=max(g['writePeakBytes'] for g in groups),runtimeWriterStagingBytes=None,additionalCollectionReportsBytes=None,reservationAdmitted=False,originalsModified=False,temporaryFilesRemaining=0,uncertainty='Purposive historical sample, not a population bound. Shared packs span only six-case checkpoints; proportional raw-byte allocation is an accounting convention, not predicted population reuse. Fine unsampled strata remain unknown. Offline pack staging excludes native service writer, sidecars and collection reporting. No runtime support installed; receipts not refreshed.',decision='NOT ADMITTED: unsampled population bound, collection reports and native writer staging unresolved')
(out/'packed-plan.json').write_text(json.dumps(report,indent=2)+'\n')
print('PASS sampleCount=67 moduleCount=18 population=3900; exact IDs and saved baseline hashes reconciled')
print('PASS 12 checkpoints EXIT_STATUS=0 elapsedMs<590000; originals/index unchanged; temporaryFilesRemaining=0')
print(f'WEIGHTED candidate={weighted:.0f} baseline={baseline:.0f} savings={baseline-weighted:.0f} headroom={headroom}')
print(f'PACK_WRITE_CLEANUP_PEAK_BYTES={report["measuredOfflinePackWriteCleanupPeakBytes"]}')
print(report['decision'])
PY
