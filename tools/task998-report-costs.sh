#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
#!/usr/bin/env python3
"""Inventory actual serializers; hypothetical success size is not a gate result."""
import hashlib,json,pathlib,re,subprocess,sys
B=pathlib.Path('/root/diplomacy/artifacts').resolve()/'TASK-998'
O=pathlib.Path(sys.argv[1]).resolve();assert O.is_relative_to(B)
h=lambda b:hashlib.sha256(b).hexdigest()
sources=[pathlib.Path('/root/diplomacy_server/tests/helpers/runUndoCoverage.js'),pathlib.Path('/root/diplomacy_server/tests/helpers/buildUndoCoverageIndex.js'),B/'recovery-4/finalize.py',B/'recovery-12/finalize.py']
inventory=[]
for p in sources:
 s=p.read_text();inventory.append(dict(path=str(p),sha256=h(p.read_bytes()),serializerLines=[{'line':i,'text':line} for i,line in enumerate(s.splitlines(),1) if any(w in line for w in ['writeFileSync','write_text','write(p/','write(p /','proofnames=','accepted.append','return {collection:'])]))
s=sources[0].read_text()
match=re.search(r"return (\{collection:'undo-no-restart',certified:receipts.length,unresolved:0,restartOutsideScope:528,structuralExclusions:1404\});",s);assert match
# Evaluate only the pinned literal expression, without invoking a validator.
program='const receipts={length:3900};process.stdout.write(JSON.stringify('+match[1]+",null,2)+'\\n');"
summary=subprocess.check_output(['/usr/local/bin/node20','-e',program]);assert json.loads(summary)['certified']==3900
reports=[]
for name in ['coverage.json','receipt-index.json','evidence-index.json','timing.json','integration.json','scope.json','cleanup.json','refresh-continuity.json','integrated-identity.json','handoff.json']:
 p=B/name;raw=p.read_bytes();reports.append(dict(path=str(p),existingBytes=len(raw),sha256=h(raw),newBytesBound=None,atomicReplacementAdditionalBytes=None))
result=dict(serializers=inventory,validatorSummary=dict(serializerSource=str(sources[0]),bytes=len(summary),fieldCount=len(json.loads(summary)),hypotheticalSizeOnly=True,notValidation=True),retainedReports=reports,indexCensusBytes=(B/'receipt-index.json').stat().st_size,atomicReplacementRule='Existing retained originals are already in canonical storage. Atomic replacement needs the entire new file in addition; rename does not require a second new copy. Retained previous-main copies are separately charged. No factor-two failure-report bound.',fullIndexRule='buildUndoCoverageIndex serializes receipts and 125 integration records with JSON.stringify(value,null,2)+newline. Current index exact size is known; fresh execution paths/fragment counts require a measured new index.',timingRule='recovery-4/finalize.py serializes acceptedShards including full commands/cleanup and command records. No fixed shard byte cap.',evidenceRule='recovery-4/finalize.py serializes acceptedProofs, command records, repositories and proof hashes; recovery-12 adds experiment references. Final report cardinality and dynamic strings must be separately charged.',nativeServiceLiveOverlap=dict(boundBytes=None,reason='Offline writer excludes native plain proof creation, simultaneous worker/dispatcher logs, browser/service storage cleanup receipts, original+replacement report overlap. Native writer is not installed.'),futureDynamicOutputBound=None,reservationAdmitted=False,nextInput='Specify and measure native service output lifecycle plus bounded output policy that fails oversized shards without truncation; historical samples cannot supply this bound.')
(O/'report-costs.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'PASS actual validator serializer fields={len(json.loads(summary))} hypotheticalSuccessBytes={len(summary)} NOT A VALIDATION RESULT')
print('PASS full index/integration/timing/evidence serializers inventoried; atomic new-file cost separate from existing retained bytes')
print('NOT ADMITTED: future service output, native overlap and final dynamic reports remain unbounded')

PY
