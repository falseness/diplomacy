#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
#!/usr/bin/env python3
"""Summarize paired checkpoint measurements; estimates never admit unknown staging."""
import collections, json, pathlib, os, stat, sys, hashlib
root=pathlib.Path('/root/diplomacy/artifacts').resolve();task=root/'TASK-998'
out=pathlib.Path(sys.argv[1]).resolve();assert out.is_relative_to(task) and out!=task
load=lambda p:json.loads(p.read_bytes())
groups=[load(out/f'group-{i}.json') for i in range(12)]
rows=[r for g in groups for r in g['rows']];assert len(rows)==len({r['matrixID'] for r in rows})==67
index=load(task/'receipt-index.json');by_id={r['matrixID']:r for r in index};assert len(by_id)==3900
assert len({g['indexSHA256'] for g in groups})==1
assert groups[0]['indexSHA256']==hashlib.sha256((task/'receipt-index.json').read_bytes()).hexdigest()
blobs={};uses=collections.Counter()
for g in groups:
 for k,v in g['blobs'].items():
  if k in blobs:assert blobs[k]==v
  blobs[k]=v
for r in rows:
 assert by_id[r['matrixID']]['moduleID']==r['moduleID'];uses.update(r['blobIDs'])
# Charge each digest once plus a 64-byte ID and 64-byte stored-content hash.
blob_cost=lambda k:blobs[k]['bytes']+128
for r in rows:r['allocatedBytes']=r['receiptBytes']+r['manifestBytes']+r['framingBytes']+r['sidecarBytes']+sum(blob_cost(k)/uses[k] for k in r['blobIDs'])
pop=collections.Counter(r['moduleID'] for r in index);assert len(pop)==18
strata=[]
for module,n in pop.items():
 sample=[r for r in rows if r['moduleID']==module]
 strata.append(dict(moduleID=module,population=n,sample=len(sample),weightedCandidateBytes=n*sum(r['allocatedBytes'] for r in sample)/len(sample) if sample else None,weightedBaselineBytes=n*sum(r['baselineBytes'] for r in sample)/len(sample) if sample else None))
assert all(s['sample'] for s in strata)
def dimension(r):
 import re
 m=re.search(r'-(competitive|coop)-(\d)-fog([01])-(.+)$',r['matrixID']);assert m
 return (r['moduleID'],m[2],m[3],m[4])
sampled=collections.Counter(dimension(r) for r in rows);population=collections.Counter(dimension(r) for r in index)
seen=set();stored=0
for d,ds,files in os.walk(root,followlinks=False):
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in files:
  s=os.lstat(os.path.join(d,f));key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen:seen.add(key);stored+=s.st_size
candidate=sum(r['allocatedBytes'] for r in rows);baseline=sum(r['baselineBytes'] for r in rows);weighted=sum(s['weightedCandidateBytes'] for s in strata);headroom=40*1024**3-stored
report=dict(sampleCount=len(rows),moduleCount=len(pop),population=3900,strata=strata,unsampledFineStrata=[dict(dimensions=k,population=n) for k,n in population.items() if k not in sampled],pairedCandidateBytes=candidate,pairedBaselineBytes=baseline,pairedSavingsBytes=baseline-candidate,compressedSharedBlobBytes=sum(v['bytes'] for k,v in blobs.items() if uses[k]>1),uniquePerCaseBlobBytes=sum(v['bytes'] for k,v in blobs.items() if uses[k]==1),blobIDAndHashBytes=128*len(blobs),compressedManifestBytes=sum(r['manifestBytes'] for r in rows),exactSidecarsAndFramingBytes=sum(r['sidecarBytes']+r['framingBytes'] for r in rows),receiptIndexBytes=sum(r['receiptBytes'] for r in rows),populationWeightedCandidateBytes=weighted,populationWeightedBaselineBytes=sum(s['weightedBaselineBytes'] for s in strata),sampleMeanProjectionBytes=candidate*3900/67,sampleMaximumProjectionBytes=max(r['allocatedBytes'] for r in rows)*3900,retainedOriginalsAndReportsBytes=stored,headroomBytes=headroom,weightedDeficitBeforeStagingBytes=weighted-headroom,additionalCollectionReportsBytes=None,runtimeWriteCleanupPeakBytes=None,reservationAdmitted=False,retainedCandidateBytes=0,originalsModified=False,uncertainty='Purposive sample. Equal allocation of shared bytes is a sample accounting convention, not predicted population reuse. Module weighting does not cover unsampled player/fog/sequence strata. No bound on new dynamic content, reports or writer staging. Historical decoded proof equality does not certify current receipts.',decision='NOT ADMITTED: full-volume bound and native writer staging unresolved',baselineReference=str(task/'recovery-9/file-measurements.json'))
(out/'compressed-shared-plan.json').write_text(json.dumps(report,indent=2)+'\n')
for i,g in enumerate(groups):
 e=load(out/f'group-{i}-execution.json');assert e['exitStatus']==0 and e['elapsedMs']<590000
print('PASS sampleCount=67 moduleCount=18 population=3900; exact matrix IDs reconciled')
print('PASS all checkpoint groups EXIT_STATUS=0 elapsedMs<590000; originals/index unchanged')
print(f'PAIRED candidate={candidate:.0f} baseline={baseline} savings={baseline-candidate:.0f}')
print(f'WEIGHTED candidate={weighted:.0f} headroom={headroom} deficitBeforeStaging={weighted-headroom:.0f}')
print(report['decision'])

PY
