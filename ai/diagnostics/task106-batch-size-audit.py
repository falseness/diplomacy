"""Audit the rejected batch-size prerequisite without replaying any game."""
import hashlib
import json
from pathlib import Path
import sys


def validate_report(report, plan):
    assert report['passed'] is False, 'not a rejected prerequisite'
    assert report['finalTensors'] == 0, 'incomplete model cleanup'
    assert report['calls'], 'missing predictions'
    assert report['failure']['call'] == len(report['calls']) - 1, 'continued after drift'
    assert report['failure']['reason'] == 'exact scalar prediction drift'
    planned = [(b['hash'], g['seed']) for b in plan['boundaries'] for g in b['results']]
    attempted = [(g['boundary'], g['seed']) for g in report['attempted']]
    assert attempted == planned[:len(attempted)] and attempted, 'selected or unplanned scenarios'
    assert len(report['games']) == len(attempted) - 1, 'unfinished game mislabeled'
    expected = [g for b in plan['boundaries'] for g in b['results']]
    assert report['games'] == expected[:len(report['games'])], 'completed work drift'
    for index, call in enumerate(report['calls']):
        assert call['shamExact'] is True and call['stableTensors'] is True
        assert (call['boundary'], call['seed']) in attempted
        assert call['role'] in ('current', 'baseline')
        assert call['positions'] > 0
        if index < len(report['calls']) - 1:
            assert call['mismatch'] == -1, 'continued after earlier drift'
        else:
            assert 0 <= call['mismatch'] < call['positions']
            assert call['before'] != call['after'], 'missing actual numerical difference'


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main(directory):
    root = Path(directory)
    read = lambda name: json.loads((root / name).read_text())
    plan, report = read('plan.json'), read('paired/report.json')
    provenance = read('paired/provenance.json')
    for file, digest in read('source-hashes.json').items():
        assert sha(file) == digest, f'source changed: {file}'
    for file, metadata in read('consumed-evidence.json').items():
        assert sha(file) == metadata['sha256'], f'previous evidence changed: {file}'
    for group in ['sources', 'inputs']:
        for file, digest in provenance[group].items():
            assert sha(file) == digest, f'run binding changed: {file}'
    assert provenance['node'] == 'v20.20.2'
    assert provenance['tf']['tfjs'] == '4.22.0'
    assert 'Cpus_allowed_list:\t0-1' in provenance['processStatus']
    assert provenance['environment']['NODE_OPTIONS'] == '--max-old-space-size=6144'
    assert not any(k.startswith(('TF_', 'OMP_', 'MKL_')) for k in provenance['environment'])
    print('SOURCE/INPUT BINDING: PASS frozen source, historical evidence and checkpoint hashes unchanged')
    print('RUNTIME CONFIG: PASS Node20.20.2 TF4.22.0 heap6144MiB CPUs0,1 native defaults')
    validate_report(report, plan)
    # JS JSON serialization writes one trailing newline outside the hashed input.
    raw = (root / 'paired/mismatch-input.json').read_bytes()
    assert raw.endswith(b'\n')
    assert hashlib.sha256(raw[:-1]).hexdigest() == report['calls'][-1]['inputHash']
    assert len(json.loads(raw)) == report['calls'][-1]['positions']
    log = (root / 'paired.log').read_text()
    for marker in ['BATCH SIZE PARITY: FAIL', 'BATCH SIZE CLEANUP: PASS ownedTensors=0', 'EXIT_CODE: 1']:
        assert marker in log, f'missing actual result: {marker}'
    assert 'BATCH SIZE PREREQUISITE: PASS' not in log
    print('FAILURE INTEGRITY: PASS first drift retained with exact input, explicit32 sham and zero final tensors')
    print(f"OUTCOME ACCOUNTING: attempted={len(report['attempted'])} completed={len(report['games'])} "
          'unfinished=1; no result or win assigned to interrupted game')
    print('NUMERIC PARITY: FAIL ' + json.dumps(report['calls'][-1], sort_keys=True))
    print('READINESS: FAIL batch64 rejected; conditional CLI/regression/canonical gates not reached')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
