#!/usr/bin/env bash
# Measure a prospective native stream format in memory; never compress originals.
set -euo pipefail
python3 - "$@" <<'PY'
import sys,pathlib,json,hashlib,gzip,zlib,time,os,stat,resource
start=time.monotonic()
root=pathlib.Path('/root/diplomacy/artifacts').resolve();task=root/'TASK-998'
out=pathlib.Path(sys.argv[1]).resolve();assert out.is_relative_to(task) and out!=task
out.mkdir(parents=True,exist_ok=True)
h=lambda b:hashlib.sha256(b).hexdigest()
indexbytes=(task/'receipt-index.json').read_bytes();index=json.loads(indexbytes)
rows=json.load(open(task/'recovery-7/storage-plan.json'))['rows']+json.load(open(task/'recovery-7/encoded/storage-plan.json'))['rows']
assert len(rows)==len({r['matrixID'] for r in rows})
sidecars=json.load(open(task/'recovery-7/sidecar-inventory.json'))['files']
results=[];files={};negative=set();max_raw=0
# The framing retains the exact original byte hash, size and relative logical name.
# This models NEW evidence only; candidate encoded bytes never reach the filesystem.
def measure(filename,expected=None):
 global max_raw
 # Historical external originals are readable; only output must be inward.
 p=pathlib.Path(filename).resolve()
 if str(p) in files:return files[str(p)]
 assert time.monotonic()-start<570,'offline measurement deadline'
 stored=p.read_bytes();before=h(stored)
 raw=gzip.decompress(stored) if p.suffix=='.gz' else stored
 if expected:assert h(raw)==expected,'source proof hash mismatch'
 encoded=zlib.compress(raw,6);digest=h(raw)
 def decode(data,size,digest):
  b=zlib.decompress(data);assert len(b)==size and h(b)==digest,'stream identity mismatch';return b
 assert decode(encoded,len(raw),digest)==raw
 for name,data,want_hash in [('truncated',encoded[:-1],digest),('corrupt',encoded[:len(encoded)//2]+bytes([encoded[len(encoded)//2]^1])+encoded[len(encoded)//2+1:],digest),('wrong-hash',encoded,'0'*64)]:
  try:decode(data,len(raw),want_hash)
  except (AssertionError,zlib.error):negative.add(name)
  else:raise AssertionError('negative accepted '+name)
 assert h(p.read_bytes())==before,'original changed'
 manifest=dict(sourcePath=str(p),sha256=digest,bytes=len(raw),encoding='prospective-zlib-v1')
 n=len(json.dumps(manifest,separators=(',',':')).encode())+1
 result=dict(path=str(p),storedSHA256=before,rawSHA256=digest,rawBytes=len(raw),encodedBytes=len(encoded),manifestBytes=n,totalBytes=len(encoded)+n)
 files[str(p)]=result;max_raw=max(max_raw,len(raw));return result
for row in rows:
 names=set()
 for part in row['parts']:
  e=json.load(open(part['executionPath']));assert h(pathlib.Path(part['executionPath']).read_bytes())==part['executionSHA256']
  for filename,expected in [(part['proofPath'],part['proofSHA256']),(part['executionPath'],part['executionSHA256']),(e['logPath'],None)]:
   m=measure(filename,expected);names.add(m['path'])
  base=pathlib.Path(part['executionPath']).resolve().parent
  for s in sidecars:
   if pathlib.Path(s['path']).resolve().is_relative_to(base):names.add(measure(s['path'])['path'])
 receipt=json.dumps(next(r for r in index if r['matrixID']==row['matrixID']),separators=(',',':')).encode()
 # Leave collection overlay entries plain/readable and charge them for every case.
 total=sum(files[n]['totalBytes'] for n in names)+len(receipt)
 results.append(dict(matrixID=row['matrixID'],moduleID=row['moduleID'],dimensions=row['dimensions'],files=sorted(names),receiptBytes=len(receipt),nativeBytes=total))
 print('PASS exact-byte reconstruction and unchanged originals '+row['matrixID']+' nativeBytes='+str(total),flush=True)
 (out/'checkpoint.json').write_text(json.dumps(results,indent=2)+'\n')
seen=set();stored_bytes=0
for d,ds,fs in os.walk(root,followlinks=False):
 ds[:]=[x for x in ds if not os.path.ismount(os.path.join(d,x))]
 for f in fs:
  s=os.lstat(os.path.join(d,f));key=(s.st_dev,s.st_ino)
  if stat.S_ISREG(s.st_mode) and key not in seen:seen.add(key);stored_bytes+=s.st_size
headroom=40*1024**3-stored_bytes
native=sum(r['nativeBytes'] for r in results);linear=native*3900/len(results);worst=max(r['nativeBytes'] for r in results)*3900
assert (task/'receipt-index.json').read_bytes()==indexbytes
assert negative=={'truncated','corrupt','wrong-hash'}
report=dict(format='prospective-zlib-v1 exact original byte streams plus manifests; not installed or accepted by runtime',sampleCount=len(results),sampleIDs=[r['matrixID'] for r in results],modules=sorted({r['moduleID'] for r in results}),dimensions=sorted({d for r in results for d in r['dimensions']}),uniqueFiles=len(files),rawBytes=sum(f['rawBytes'] for f in files.values()),encodedBytes=sum(f['encodedBytes'] for f in files.values()),manifestBytes=sum(f['manifestBytes'] for f in files.values()),sampleNativeBytes=native,linearProjectionBytes=linear,sampledMaximumProjectionBytes=worst,storedBytes=stored_bytes,headroomBytes=headroom,largestOriginalStreamBytes=max_raw,measurementMaxRSSBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,retainedCandidateBytes=0,originalsModified=False,indexSHA256=h(indexbytes),negativeControls=sorted(negative),reservationAdmitted=False,elapsedMs=(time.monotonic()-start)*1000,uncertainty='Same purposive 66-case sample as recovery-7 to isolate format effect; not a random confidence interval or upper bound. Historical content is not fresh execution. Unsampled dynamic content, future sidecar growth, filesystem staging and runtime peaks are unknown. Byte checks do not replace semantic receipt validation.',decision='NOT ADMITTED: no measured runtime peak or justified full-volume upper bound; compare projections against headroom before implementing runtime codec.')
(out/'stream-plan.json').write_text(json.dumps(report,indent=2)+'\n');(out/'file-measurements.json').write_text(json.dumps(list(files.values()),indent=2)+'\n')
print('PASS native-stream measurement sampleCount='+str(len(results)))
print('PASS negative controls: '+','.join(sorted(negative)))
print('PASS original hashes and receipt index unchanged; retainedCandidateBytes=0')
print('HEADROOM',headroom,'LINEAR',round(linear),'SAMPLED_MAXIMUM',worst)
print(report['decision'])
PY
