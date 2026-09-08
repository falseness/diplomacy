#!/usr/bin/env python3
"""Audit complete bounded replay evidence; does not award either speed gate."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    dest = Path(sys.argv[1]).resolve()
    declared = json.loads((dest/'predeclared.json').read_text())
    runs = json.loads((dest/'runs.json').read_text())
    assert len(runs) == len(declared['matrix']) == 12
    repo = Path(__file__).resolve().parents[2]
    for revision, files in declared['source_hashes'].items():
        for name, expected in files.items():
            assert digest(dest/(revision+'-source')/name) == expected, name
            actual = subprocess.check_output(['git', 'show', declared['revisions'][revision]+':'+name], cwd=repo)
            assert hashlib.sha256(actual).hexdigest() == expected, name
        print('ACTUAL_SOURCE: PASS', revision, declared['revisions'][revision], len(files))
    for name, expected in declared['checkpoint_hashes'].items():
        assert digest(Path(name)) == expected, name
    assert digest(dest/'profile.cjs') == declared['driver_hash']
    assert digest(Path(__file__).with_name('task102-profile.cjs')) == declared['driver_hash']
    print('CHECKPOINT_AND_DRIVER_HASHES: PASS')
    reference = {}
    reports = {}
    for run, spec in zip(runs, declared['matrix']):
        fixture, revision, mode, hooks = spec
        label = '-'.join(spec)
        assert run['label'] == label and run['exit'] == 0
        log = (dest/(label+'.log')).read_text()
        assert log.count('START: ') == log.count('RESULT: ') == 6
        assert 'REPLAY_COMPLETE: 6' in log and 'EXIT_CODE: 0' in log
        report = json.loads((dest/(label+'.json')).read_text())
        assert report['source'] == str(dest/(revision+'-source'))
        assert report['mode'] == mode and report['instrumentation'] == hooks
        assert report['retainedCount'] == (6 if mode == 'retain' else 0)
        assert len(report['outcomes']) == 6 and len(report['memory']) == 12
        expected = json.loads((dest/(fixture+'.json')).read_text())
        assert digest(dest/(fixture+'.json')) == declared['fixture_hashes'][fixture]
        assert [o['scenario'] for o in report['outcomes']] == expected
        assert abs(sum(o['elapsedMs'] for o in report['outcomes']) - report['gameMs']) < 1e-6
        hashes = [o['hash'] for o in report['outcomes']]
        if fixture in reference:
            assert hashes == reference[fixture], label
        else:
            reference[fixture] = hashes
        for outcome in report['outcomes']:
            encoded = json.dumps(outcome['game'], separators=(',', ':'), ensure_ascii=False)
            assert hashlib.sha256(encoded.encode()).hexdigest() == outcome['hash']
            # The prescribed one-round component reports roundCount=0 at its
            # limit, despite real inference/actions. Preserve those non-results.
            assert outcome['game']['roundCount'] >= 0
            if fixture == 'canonical':
                assert outcome['game']['roundCount'] > 0
            assert outcome['game']['inference']['calls'] > 0
        if hooks == 'on':
            assert all(v > 0 for v in report['phases'].values())
            assert report['residualMs'] > 0
            assert abs(sum(report['phases'].values()) + report['residualMs'] - report['gameMs']) < 1e-6
        else:
            assert all(v == 0 for v in report['phases'].values()) and report['residualMs'] is None
        reports[label] = report
        wins = {}
        for outcome in report['outcomes']:
            side = str(outcome['game']['winnerSide'])
            wins[side] = wins.get(side, 0) + 1
        nonresults = sum(o['game']['nonResult'] for o in report['outcomes'])
        print('REPLAY_AUDIT: PASS', label, '6/6 returned;', json.dumps(wins), 'nonResults', nonresults)
        print('PHASES:', label, json.dumps(dict(gameMs=report['gameMs'], **report['phases'], residualMs=report['residualMs'])))
        print('MEMORY_GC:', label, json.dumps(dict(maxSampleRss=max(m['rss'] for m in report['memory']),
            maxSampleHeapUsed=max(m['heapUsed'] for m in report['memory']), gcEvents=len(report['gc']),
            gcMs=sum(e['durationMs'] for e in report['gc']))))
    for fixture in ('canonical', 'component'):
        for mode in ('retain', 'discard'):
            on = reports[f'{fixture}-after-{mode}-on']['gameMs']
            off = reports[f'{fixture}-after-{mode}-off']['gameMs']
            print('CALIBRATION:', fixture, mode, 'onMs', on, 'offMs', off, 'deltaPercent', (on/off-1)*100)
    print('OUTCOME_EQUIVALENCE: PASS 72/72 results across revisions/modes/hooks; 12 unique scenarios')
    print('ATTRIBUTION_LIMIT: single batches; calibration includes host/JIT/GC noise; no causal host attribution; no fitting measured')
    print('BOUNDED_PROFILE_AUDIT: PASS; diagnostic only, no speed-gate claim')

if __name__ == '__main__':
    main()
