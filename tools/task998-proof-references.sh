#!/usr/bin/env bash
# Metadata-only recovery: no services, rewrites, decompression on disk, or certification.
set -euo pipefail
python3 - "$@" <<'PY'
import collections, gzip, hashlib, json, pathlib, sys, time
root = pathlib.Path('/root/diplomacy/artifacts').resolve()
out = pathlib.Path(sys.argv[1]).resolve()
assert out.is_relative_to(root / 'TASK-998'), 'output must remain under TASK-998'
out.mkdir(parents=True, exist_ok=True)
start = time.monotonic()
task = root / 'TASK-998'
index_bytes = (task / 'receipt-index.json').read_bytes()
index = {r['matrixID']: r for r in json.loads(index_bytes)}
report = json.loads((task / 'recovery-4/classification-final.json').read_bytes())
references = []
for row in report['records']:
    if row['category'] != 'path-unresolved':
        continue
    for fragment in index[row['matrixID']]['fragments']:
        execution_path = pathlib.Path(fragment['executionPath'])
        execution_bytes = execution_path.read_bytes()
        assert hashlib.sha256(execution_bytes).hexdigest() == fragment['executionSHA256']
        execution = json.loads(execution_bytes)
        requested = execution['proofPath']
        candidates = [pathlib.Path(requested)]
        if requested.startswith('/root/task-evidence/'):
            candidates.append(root / requested.removeprefix('/root/task-evidence/'))
        candidates += [pathlib.Path(str(p) + '.gz') for p in candidates]
        match = None
        for candidate in candidates:
            # References must remain inside canonical retained evidence.
            if not candidate.is_file() or not candidate.resolve().is_relative_to(root):
                continue
            opener = gzip.open if candidate.suffix == '.gz' else open
            digest = hashlib.sha256(); size = 0
            with opener(candidate, 'rb') as stream:
                while block := stream.read(1024 * 1024):
                    digest.update(block); size += len(block)
            if digest.hexdigest() != execution['proofSHA256']:
                continue
            match = dict(matrixID=row['matrixID'], fragment=fragment['id'],
                         executionPath=str(execution_path), executionSHA256=fragment['executionSHA256'],
                         requestedPath=requested, referencePath=str(candidate),
                         encoding='gzip' if candidate.suffix == '.gz' else 'plain',
                         proofSHA256=digest.hexdigest(), originalBytes=size,
                         storedBytes=candidate.stat().st_size)
            # Parse just this proof to classify its actual identity; never certify it.
            with opener(candidate, 'rb') as stream:
                proof = json.load(stream)
            identity = proof['identity']
            if '$cas' in identity:
                identity = proof['casBlobs'][identity['$cas']]
            match['recordedDigest'] = identity['digest']
            break
        if match is None:
            raise AssertionError('No hash-matching inward reference: ' + requested)
        references.append(match)
        current = json.loads((task / 'recovery-4/identity-before.json').read_bytes())['digest']
        assert match['recordedDigest'] != current, 'matching identity needs full validation'
        row.update(category='identity-stale', reason='original proof bytes resolved by hash-checked reference; recorded identity differs; not certification', recordedDigests=[match['recordedDigest']])
    assert time.monotonic() - start < 580, 'metadata deadline exceeded'
assert (task / 'receipt-index.json').read_bytes() == index_bytes, 'active index changed'
report['counts'] = dict(collections.Counter(r['category'] for r in report['records']))
report['referenceIndex'] = str(out / 'proof-references.json')
report['certification'] = False
(out / 'classification.json').write_text(json.dumps(report, indent=2) + '\n')
(out / 'proof-references.json').write_text(json.dumps(dict(references=references, indexSHA256=hashlib.sha256(index_bytes).hexdigest(), elapsedMs=(time.monotonic()-start)*1000, originalsModified=False, activeIndexModified=False, filesystemAliasesRestored=False), indent=2)+'\n')
print('PASS original proof references hash-matched=' + str(len(references)))
print('PASS originals and active receipt index unchanged')
print('CLASSIFICATION ' + json.dumps(report['counts'], sort_keys=True))
print('NOT CERTIFICATION; compressed references require original-path restoration before validator reuse')
PY
