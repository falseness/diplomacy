"""Run a single frozen A/B/B/A calibration; audit every prefix before advancing."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def verify_hashes(root):
    hashes = json.loads((root / 'frozen-hashes.json').read_text())
    for name, expected in hashes.items():
        assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name


def audit(root, count):
    plan = json.loads((root / 'plan.json').read_text())
    verify_hashes(root)
    rows = []
    baseline_hash = None
    for index, arm in enumerate(plan['order'][:count], 1):
        directory = root / f'sample-{index}-{arm}'
        report = json.loads((directory / 'report.json').read_text())
        provenance = json.loads((directory / 'provenance.json').read_text())
        timing = json.loads((root / f'sample-{index}.json').read_text())
        log = (root / f'sample-{index}.log').read_text()
        assert timing['exit'] == 0
        assert 'OBSERVER CLEANUP: PASS ownedTensors=0' in log
        assert f'OBSERVER CALIBRATION: PASS arm={arm} games=4 calls=1936 positions=57547 nonResults=4' in log
        assert report['arm'] == arm and report['passed'] and report['finalTensors'] == 0
        assert report['calls'] == 1936 and report['positions'] == 57547
        assert len(report['details']) == (1936 if arm == 'B' else 0)
        assert report['games'] == [g for b in plan['boundaries'] for g in b['results']]
        assert report['attempted'] == [dict(boundary=b['hash'], game=i, seed=g['seed'])
                                       for b in plan['boundaries'] for i, g in enumerate(b['results'], 1)]
        assert report['snapshots'] == [b['hash'] for b in plan['boundaries']]
        assert len(set(report['snapshots'])) == 2
        assert provenance['inputs'] == plan['inputHashes']
        assert provenance['planHash'] == hashlib.sha256((root / 'plan.json').read_bytes()).hexdigest()
        assert provenance['sourceHash'] == hashlib.sha256((root / 'source/ai/diagnostics/task106-observer-calibration.cjs').read_bytes()).hexdigest()
        assert provenance['node'] == 'v20.20.2' and provenance['tf'] == '4.22.0'
        assert 'Cpus_allowed_list:\t0-1\n' in provenance['status']
        assert provenance['environment'] == {'NODE_OPTIONS': '--max-old-space-size=6144', 'DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT': '1'}
        if baseline_hash is None:
            baseline_hash = report['baselineHash']
        assert baseline_hash == report['baselineHash']
        assert len(report['gameMs']) == 4 and all(v > 0 for v in report['gameMs'])
        if arm == 'A':
            assert all(v == 0 for v in report['diagnosticMs'].values())
        else:
            assert all(v > 0 for v in report['diagnosticMs'].values())
            assert all(c['stableTensors'] and c['mismatch'] == -1 for c in report['details'])
            old = json.loads((root / 'historical-calls.json').read_text())
            assert report['details'] == old, 'instrumented call/input order drift'
        rows.append(dict(sample=index, arm=arm, processSeconds=timing['seconds'],
                         gameSeconds=sum(report['gameMs']) / 1000,
                         diagnosticSeconds={k: v / 1000 for k, v in report['diagnosticMs'].items()},
                         games=4, calls=1936, positions=57547, nonResults=4, finalTensors=0))
    return rows


def main():
    root = Path(sys.argv[1]).resolve()
    plan = json.loads((root / 'plan.json').read_text())
    assert plan['order'] == ['A', 'B', 'B', 'A']
    env = os.environ.copy()
    env.update(NODE_OPTIONS='--max-old-space-size=6144', DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT='1')
    verify_hashes(root)
    with (root / 'prefix-audit.log').open('x') as audit_log:
        for index, arm in enumerate(plan['order'], 1):
            command = ['taskset', '-c', '0,1', plan['environment']['node'],
                       'ai/diagnostics/task106-observer-calibration.cjs', str(root / 'plan.json'),
                       str(root / f'sample-{index}-{arm}'), arm]
            with (root / f'sample-{index}.log').open('x') as log:
                log.write('COMMAND: ' + json.dumps(command) + '\nCWD: ' + str(root / 'source') + '\n')
                log.write('ENVIRONMENT: ' + json.dumps({k: v for k, v in env.items() if k.startswith(('TF_', 'OMP_', 'MKL_', 'NODE', 'DIPLOMACY'))}) + '\n')
                log.write('UTC_START: ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + '\n')
                log.flush()
                start = time.monotonic()
                result = subprocess.run(command, cwd=root / 'source', env=env, stdout=log, stderr=subprocess.STDOUT)
                seconds = time.monotonic() - start
                log.write(f'EXIT_CODE: {result.returncode}\nELAPSED_SECONDS: {seconds}\n')
            (root / f'sample-{index}.json').write_text(json.dumps(dict(command=command, exit=result.returncode, seconds=seconds), indent=2) + '\n')
            rows = audit(root, index)
            marker = f'OBSERVER PREFIX: PASS samples={index} callsPerSample=1936 positionsPerSample=57547 nonResultsPerSample=4 ownedTensors=0'
            audit_log.write(marker + '\n')
            audit_log.flush()
            print(marker, flush=True)
    a = [r for r in rows if r['arm'] == 'A']
    b = [r for r in rows if r['arm'] == 'B']
    mean = lambda rs, key: sum(r[key] for r in rs) / len(rs)
    summary = dict(rows=rows, meanProcessA=mean(a, 'processSeconds'), meanProcessB=mean(b, 'processSeconds'),
                   meanGameA=mean(a, 'gameSeconds'), meanGameB=mean(b, 'gameSeconds'),
                   meanDiagnosticB=sum(sum(r['diagnosticSeconds'].values()) for r in b) / 2,
                   historicalSavedSeconds=11.609866206, historicalContaminatedSeconds=426.730796335,
                   historicalEstimatePercent=2.720653467177091,
                   historicalExcessRequiredSeconds=310.632134275, performanceAcceptance=False)
    summary['processExcessB'] = summary['meanProcessB'] - summary['meanProcessA']
    summary['gameExcessB'] = summary['meanGameB'] - summary['meanGameA']
    (root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print('OBSERVER ANALYSIS: PASS samples=4 order=A/B/B/A performanceAcceptance=false', flush=True)


if __name__ == '__main__':
    main()
