#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
#!/usr/bin/env python3
"""Metadata census and explicit new-input checkpoint; never certifies receipts.

Resume only against identical index, codec and prior measurement inventories.
No proof is decoded here. New checkpoint inventories hash only selected files.
"""
import collections, hashlib, json, pathlib, sys, time
B=pathlib.Path('/root/diplomacy/artifacts').resolve()/'TASK-998'
O=pathlib.Path(sys.argv[1]).resolve()
assert O.is_relative_to(B) and O!=B
O.mkdir(parents=True,exist_ok=True)
start=time.monotonic()
h=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:json.loads(p.read_bytes())
index=read(B/'receipt-index.json')
groups=[read(B/f'recovery-11/group-{i}.json') for i in range(12)]
measured={r['matrixID']:(i,r) for i,g in enumerate(groups) for r in g['rows']}
assert len(measured)==67
bindings={str(p):h(p.read_bytes()) for p in [B/'receipt-index.json',pathlib.Path('/root/diplomacy_server/tests/helpers/proofCodec.js')]+[B/f'recovery-11/group-{i}.json' for i in range(12)]}
for g in groups:
 assert g['indexSHA256']==bindings[str(B/'receipt-index.json')]
 assert g['codecSHA256']==bindings['/root/diplomacy_server/tests/helpers/proofCodec.js']
refs={r['executionSHA256']:r for r in read(B/'recovery-5/proof-references.json')['references']}
rows=[]
for r in index:
 assert time.monotonic()-start<560
 parts=[];files={}
 for f in r['fragments']:
  p=pathlib.Path(f['executionPath']);raw=p.read_bytes();assert h(raw)==f['executionSHA256'];e=json.loads(raw)
  proof=pathlib.Path(e['proofPath'])
  if not proof.exists():proof=pathlib.Path(refs[f['executionSHA256']]['referencePath'])
  proof=proof.resolve();assert proof.is_file()
  parts.append(dict(executionSHA256=f['executionSHA256'],proofSHA256=e['proofSHA256'],proofPath=str(proof)))
  for q in list(p.resolve().parent.rglob('*'))+[proof,pathlib.Path(e['logPath']).resolve()]:
   if q.is_file():files[str(q.resolve())]=q.stat().st_size
 proofpaths={p['proofPath'] for p in parts}
 row=dict(matrixID=r['matrixID'],moduleID=r['moduleID'],originalHashes=parts,proofBytes=sum(files[p] for p in proofpaths),sidecarBytes=sum(n for p,n in files.items() if p not in proofpaths),files=files,receiptBytes=len(json.dumps(r,separators=(',',':')).encode()),measured=r['matrixID'] in measured)
 if row['measured']:
  i,m=measured[r['matrixID']];row['measurement']={'path':str(B/f'recovery-11/group-{i}.json'),'candidateBytes':m['candidateBytes']}
 rows.append(row)
assert len(rows)==3900 and len({r['matrixID'] for r in rows})==3900
# Exact matrix IDs are census units; broad module groups are not cost equivalence.
remaining=[r for r in rows if not r['measured']]
selected=[]
for key in ['proofBytes','sidecarBytes']:
 selected.append(sorted((r for r in remaining if r not in selected),key=lambda r:(-r[key],r['matrixID']))[0])
selection=dict(bindings=bindings,policy='largest unmeasured stored proof, then largest distinct unmeasured sidecars; lexical ID ties',selected=[{'matrixID':r['matrixID'],'originalHashes':r['originalHashes'],'proofBytes':r['proofBytes'],'sidecarBytes':r['sidecarBytes']} for r in selected])
p=O/'selection.json'
if p.exists():assert read(p)==selection,'selection inputs changed; use a new checkpoint'
else:p.write_text(json.dumps(selection,indent=2)+'\n')
# Selection is persisted before any selected proof bytes are read/hashed.
for j,r in enumerate(selected):
 inventory=[];proofs={p['proofPath']:p['proofSHA256'] for p in r['originalHashes']}
 for name,size in sorted(r['files'].items()):
  p=pathlib.Path(name);raw=p.read_bytes();assert len(raw)==size
  inventory.append(dict(path=name,storedSHA256=h(raw),kind='cas-v1-proof' if name in proofs else 'exact-byte-sidecar',originalSHA256=proofs.get(name)))
 checkpoint=dict(matrixID=r['matrixID'],moduleID=r['moduleID'],files=inventory,indexSHA256=bindings[str(B/'receipt-index.json')],codecSHA256=bindings['/root/diplomacy_server/tests/helpers/proofCodec.js'],oldModuleMaximumBytes=max(m['candidateBytes'] for _,m in measured.values() if m['moduleID']==r['moduleID']))
 p=O/f'checkpoint-{j}.json'
 if p.exists():assert read(p)==checkpoint
 else:p.write_text(json.dumps(checkpoint,indent=2)+'\n')
for r in rows:del r['files']
report=dict(bindings=bindings,rows=rows,population=len(rows),modules=dict(collections.Counter(r['moduleID'] for r in rows)),reusedMeasurements=len(measured),unmeasuredSingletonCases=len(remaining),replicatedCostStrataEstablished=0,reservationAdmitted=False,futureOutputBound=None,nativeServiceOverlapBound=None,nextHypothesis='Measure two declared new historical cases against their module maxima; this closes exact case costs only, never a future dynamic output bound.')
(O/'ledger.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
print('PASS ledger population=3900 modules=18 reusedMeasurements=67 unmeasuredSingletonCases=3833 replicatedCostStrataEstablished=0')
for r in selected:print('SELECTED',r['matrixID'],'proofBytes='+str(r['proofBytes']),'sidecarBytes='+str(r['sidecarBytes']))
print('PASS checkpoint selection persisted before proof read; original hashes pinned; NOT ADMITTED')

PY
