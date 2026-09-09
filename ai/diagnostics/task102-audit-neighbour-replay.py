#!/usr/bin/env python3
"""Audit every bounded passability replay; no full speed acceptance claim."""
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys


def audit(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    for name, expected in manifest['hashes'].items():
        assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name
    passes = []
    reference = None
    examples = None
    for index, variant in enumerate(manifest['order'], 1):
        prefix = directory / f'{index}-{variant}'
        log = Path(str(prefix) + '.log').read_text()
        assert log.count('REPLAY_GAME: ') == 12, prefix
        assert 'NEIGHBOUR_REPLAY: PASS 12 complete results' in log, prefix
        assert 'EXIT_CODE: 0\n' in log, prefix
        assert 'ELAPSED_WALL_SECONDS: ' in log, prefix
        value = json.loads(Path(str(prefix) + '.json').read_text())
        results = json.loads(gzip.decompress(Path(str(prefix) + '.results.json.gz').read_bytes()))
        assert value['variant'] == variant and len(results) == len(value['records']) == 12
        # Compare the exact serialized JSON bytes too (not Python's loose 1 == True).
        raw = gzip.decompress(Path(str(prefix) + '.results.json.gz').read_bytes())
        if reference is None:
            reference = raw
            examples = sum(len(result['examples']) for result in results[:6])
        assert raw == reference, f'{prefix}: complete outcomes/examples differ'
        for i, record in enumerate(value['records']):
            assert record['group'] == ('teacher' if i < 6 else 'component')
            assert record['index'] == i % 6
            assert record['elapsedMs'] > 0
        if variant == 'audit':
            assert sum(value['counts'].values()) > 0
        passes.append(value)
    summary = {}
    promote = True
    for group in ['teacher', 'component']:
        totals = [sum(record['elapsedMs'] for record in value['records']
                      if record['group'] == group) / 1000 for value in passes[:4]]
        before = statistics.mean([totals[0], totals[3]])
        after = statistics.mean([totals[1], totals[2]])
        reduction = 100 * (before - after) / before
        pairs = [100 * (totals[b] - totals[a]) / totals[b] for b, a in [(0, 1), (3, 2)]]
        promote &= reduction >= 10 and all(value > 0 for value in pairs)
        summary[group] = {'seconds_in_order': totals, 'control_mean': before,
                          'candidate_mean': after, 'reduction_percent': reduction,
                          'paired_reductions_percent': pairs}
    print('FROZEN_SOURCES: PASS', len(manifest['hashes']))
    print('COMPLETE_EQUIVALENCE: PASS 60 results; 12 unique scenarios;', examples,
          'teacher examples per pass')
    print('ORDER_AND_BORDER: PASS', json.dumps(passes[-1]['counts'], sort_keys=True))
    print('BOUNDED_TIMINGS:', json.dumps(summary, sort_keys=True))
    print('PROMOTION_SCREEN:', 'PASS' if promote else 'REJECT')
    print('FULL_SPEED_ACCEPTANCE: NOT RUN; diagnostic only')
    return summary


if __name__ == '__main__':
    audit(Path(sys.argv[1]))
