"""Read-only audit of the finite TASK-102 sham calibration; never speed acceptance."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys


def read_run(directory, index, arm):
    prefix = directory / f'{index}-{arm}'
    log = prefix.with_suffix('.log').read_text()
    assert re.search(r'^EXIT_CODE: 0$', log, re.M), prefix
    assert 'SHAM_REPLAY: PASS 12 complete results' in log, prefix
    assert 'SHAM_EXECUTION: PASS' in log, prefix
    record = json.loads(prefix.with_suffix('.json').read_text())
    raw = gzip.decompress(Path(str(prefix) + '.results.json.gz').read_bytes())
    results = json.loads(raw)
    assert record['variant'] == arm
    assert len(results) == len(record['records']) == 12
    assert [(item['group'], item['index']) for item in record['records']] == [
        (group, index) for group in ['teacher', 'component'] for index in range(6)]
    for result, item in zip(results, record['records']):
        assert item['elapsedMs'] > 0
        assert re.search(r'"sha256":\s*"' + item['sha256'] + '"', log)
    assert all(script['executions'] > 0 for script in record['scripts'])
    assert record['counts']['replacements'] == (1 if arm == 'S' else 0)
    executions = sum(script['executions'] for script in record['scripts'])
    assert record['counts']['forwards'] == (executions if arm == 'S' else 0)
    record['wallMs'] = float(re.search(r'^ELAPSED_WALL_SECONDS: ([\d.]+)$', log, re.M)[1]) * 1000
    return record, raw


def compare(records, captures):
    assert len(records) == len(captures) == 8
    reference = records[0]
    for record, raw in zip(records, captures):
        assert raw == captures[0], 'complete output mismatch'
        assert record['scripts'] == reference['scripts'], 'executed script mismatch'
        assert record['node'] == reference['node'] == 'v20.20.2'
        assert record['execArgv'] == reference['execArgv']
        assert [(item['sha256'], item['stats']) for item in record['records']] == [
            (item['sha256'], item['stats']) for item in reference['records']]


def effects(values, order):
    pairs = []
    for index in range(0, 8, 2):
        control, sham = (values[index:index + 2] if order[index] == 'A'
                         else values[index:index + 2][::-1])
        pairs.append({'S_minus_A_ms': sham - control,
                      'S_minus_A_percent': (sham / control - 1) * 100})
    blocks = []
    for start in [0, 4]:
        means = {arm: statistics.mean(values[index] for index in range(start, start + 4)
                                     if order[index] == arm) for arm in ['A', 'S']}
        blocks.append({**means, 'S_minus_A_ms': means['S'] - means['A'],
                       'S_minus_A_percent': (means['S'] / means['A'] - 1) * 100})
    spread = {}
    for arm in ['A', 'S']:
        samples = [value for value, label in zip(values, order) if label == arm]
        spread[arm] = {'minMs': min(samples), 'maxMs': max(samples),
                       'meanMs': statistics.mean(samples),
                       'rangePercentOfMean': (max(samples) - min(samples)) / statistics.mean(samples) * 100}
    return {'valuesMs': values, 'pairs': pairs, 'blocks': blocks, 'spread': spread}


def main(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    assert manifest['order'] == list('ASSASAAS')
    pairs = [read_run(directory, index, arm)
             for index, arm in enumerate(manifest['order'], 1)]
    records, captures = map(list, zip(*pairs))
    compare(records, captures)
    for filename, expected in manifest['hashes'].items():
        assert hashlib.sha256(Path(filename).read_bytes()).hexdigest() == expected, filename
    summary = {}
    for group in ['teacher', 'component']:
        values = [sum(item['elapsedMs'] for item in record['records'] if item['group'] == group)
                  for record in records]
        summary[group] = effects(values, manifest['order'])
    for boundary in ['startupMs', 'totalMs', 'wallMs']:
        summary[boundary] = effects([record[boundary] for record in records], manifest['order'])
    print(json.dumps(summary, indent=2))
    print('SHAM_AUDIT: PASS 96 complete results; identical executed scripts and inference counts')
    print('SHAM_EFFECTS: PASS four oriented pairs, two blocks and both arm spreads per boundary')
    print('SOURCE_HASHES: PASS frozen source, checkpoint and Node')
    return summary


if __name__ == '__main__':
    main(Path(sys.argv[1]))
