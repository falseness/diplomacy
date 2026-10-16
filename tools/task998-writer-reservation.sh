#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
import json,pathlib,sys,hashlib,os,stat
root=pathlib.Path('/root/diplomacy/artifacts').resolve();base=root/'TASK-998';out=pathlib.Path(sys.argv[1]).resolve();assert out.is_relative_to(base) and out!=base
read=lambda p:json.loads(p.read_bytes())
prior=read(base/'recovery-11/packed-plan.json');groups=[read(base/f'recovery-11/group-{i}.json') for i in range(12)];rows=[r for g in groups for r in g['rows']]
writers=[read(out/(mode+'.json')) for mode in ['largest-pack','largest-sidecars']]
for mode,w in zip(['largest-pack','largest-sidecars'],writers):
 e=read(out/(mode+'-execution.json'));assert e['exitStatus']==0 and e['elapsedMs']<590000;assert w['temporaryFilesRemaining']==0
 assert w['indexSHA256']==hashlib.sha256((base/'receipt-index.json').read_bytes()).hexdigest()
 for f in w['originalReferences']:assert hashlib.sha256(pathlib.Path(f['path']).read_bytes()).hexdigest()==f['storedSHA256']
# Inventory existing report sizes; proposed reserve allows simultaneous old/new copies.
# Historical rejected reports cannot bound successful collection report growth.
report_names=['coverage.json','receipt-index.json','evidence-index.json','timing.json','integration.json','scope.json','cleanup.json','refresh-continuity.json']
reports=[dict(path=str(base/n),bytes=(base/n).stat().st_size,sha256=hashlib.sha256((base/n).read_bytes()).hexdigest()) for n in report_names]
report_reserve=sum(r['bytes'] for r in reports)*2
seen=set();stored=0
for d,ds,files in os.walk(root,followlinks=False):
 # Mounted restored archive views are already charged through inward backing archives.
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in files:
  s=os.lstat(os.path.join(d,f));key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen:seen.add(key);stored+=s.st_size
strata=[]
for s in prior['strata']:
 sample=[r for r in rows if r['moduleID']==s['moduleID']];assert sample
 strata.append(dict(moduleID=s['moduleID'],population=s['population'],sample=len(sample),sampleMaximumBytes=max(r['candidateBytes'] for r in sample),projectionBytes=s['population']*max(r['candidateBytes'] for r in sample)))
headroom=40*1024**3-stored;peak=max(w['simultaneousWriterPeakBytes'] for w in writers);projection=sum(s['projectionBytes'] for s in strata)
result=dict(retainedOriginalsAndReportsBytes=stored,headroomBytes=headroom,writerPeakBytes=peak,reportInventory=reports,proposedReportReserveBytes=report_reserve,populationWeightedBytes=prior['populationWeightedCandidateBytes'],moduleMaximumProjectionBytes=projection,moduleMaximumWithStagingAndReportsBytes=projection+peak+report_reserve,moduleMaximumDeficitBytes=projection+peak+report_reserve-headroom,strata=strata,unsampledFineStrata=prior['unsampledFineStrata'],unsampledCases=sum(s['population'] for s in prior['unsampledFineStrata']),reservationAdmitted=False,serviceRefreshAuthorizedByMeasurement=False,uncertainty='Module maxima are historical sensitivity estimates, not upper bounds. Report reserve is twice observed rejected-collection report bytes, not a bound on successful report growth. Prototype measures selected staged pack/sidecar transactions, not actual service writer staging. No inputs or receipts changed.',nextCorrection='Identify saved proof for unsampled player/fog/sequence strata with largest raw sidecar/proof sizes, then measure only those exact new inputs in bounded checkpoints. Establish a report-size bound from validator output structure before installing native codec.')
(out/'reservation.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS two bounded writer checkpoints; originals/index unchanged; temporaryFilesRemaining=0')
print(f'WRITER_PEAK_BYTES={peak} PROPOSED_REPORT_RESERVE_BYTES={report_reserve}')
print(f'MODULE_MAXIMUM_PROJECTION_BYTES={projection:.0f} HEADROOM_BYTES={headroom} DEFICIT_WITH_RESERVES_BYTES={projection+peak+report_reserve-headroom:.0f}')
print('NOT ADMITTED: unsampledCases='+str(result['unsampledCases'])+'; report growth and service writer bound unresolved')
PY
