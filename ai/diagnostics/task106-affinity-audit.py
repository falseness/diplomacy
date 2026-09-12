#!/usr/bin/python3
"""Audit all predeclared placement samples; fail closed on work or affinity drift."""
import hashlib
import json
from pathlib import Path
import statistics
import sys


def read(path):
    return json.loads(path.read_text())


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cpu_set(mask):
    result = set()
    for part in mask.split(","):
        bounds = [int(x) for x in part.split("-")]
        assert len(bounds) in (1, 2)
        result.update(range(bounds[0], bounds[-1] + 1))
    return result


def main():
    root = Path(sys.argv[1]).resolve()
    plan = read(root / 'plan.json')
    samples = read(root / 'samples.json')
    assert [(s['arm'], s['mapping']) for s in samples] == [(a, m) for a, m in plan['order'][:len(samples)]]
    assert 1 <= len(samples) <= 4 and plan['threshold'] == 10
    prefix = '--prefix' in sys.argv
    for arg in sys.argv[2:]:
        if arg.startswith('--limit='):
            assert prefix, 'partial prefixes are never a final screen'
            limit = int(arg.split('=', 1)[1])
            assert 1 <= limit <= len(samples)
            samples = samples[:limit]
    parity_errors = []
    incomplete = []
    previous = read(root.parent / 'iteration-25/screen-audit.json')['summaries'][0]
    summaries = []
    native_threads = []
    for sample in samples:
        directory = Path(sample['directory'])
        assert sample['seconds'] > 0
        if sample['exit'] != 0:
            incomplete.append(sample)
            print(f'INCOMPLETE SAMPLE: {directory.name} exit={sample["exit"]}; never a timing sample')
            continue
        events = lines(directory / 'events.jsonl')
        key = lambda e: (e['pid'], e['id'])
        starts = {key(e): e for e in events if e['event'] == 'start'}
        results = [e for e in events if e['event'] == 'result']
        assert len(starts) == len(results) == len({key(e) for e in results}) == 39
        assert not any(e['event'] in ['crash', 'fit-crash'] for e in events)
        ordered = [{'scenario': starts[key(e)]['scenario'], 'result': e['game']} for e in results]
        # JSON canonicalization avoids relying on JavaScript's localeCompare sort.
        sort = lambda xs: sorted(xs, key=lambda x: json.dumps(x['scenario'], sort_keys=True))
        fits = [{'shapes': e['shapes'], 'options': e['options']} for e in events if e['event'] == 'fit-start']
        epochs = [e['epochs'] for e in events if e['event'] == 'fit-result']
        assert len(fits) == len(epochs) == 10
        state = read(directory / 'runs/task106-cli/state.json')
        manifest = read(directory / 'runs/task106-cli/manifest.json')
        assert state['status'] == manifest['status'] == 'complete' and state['completedGames'] == 4
        assert manifest['configuration']['reusableBaselineEvaluation'] is True
        summary = dict(ordered=sort(ordered), fits=fits, fitEpochs=epochs,
            weightHash=sha(directory / 'final/task106-cli/weights.bin'), curriculum=state['curriculum'])
        for field in summary:
            expected = sort(previous[field]) if field == 'ordered' else previous[field]
            if summary[field] != expected:
                parity_errors.append(dict(sample=directory.name, field=field))
        failed_fields = [e['field'] for e in parity_errors if e['sample'] == directory.name]
        print(f'WORK PARITY: {"FAIL" if failed_fields else "PASS"} {directory.name} games=39 fits=10 differingFields={failed_fields}')
        pools = lines(directory / 'pool.jsonl')
        evaluations = [e['result'] for e in pools if e['event'] == 'evaluate']
        closed = [e['result'] for e in pools if e['event'] == 'close']
        assert len(evaluations) == 2 and len(closed) == 1 and len(closed[0]) == 2
        assert len({e['hash'] for e in evaluations}) == 2
        pids = [e['pid'] for e in evaluations[0]['refreshes']]
        assert len(set(pids)) == 2
        tensors = {}
        for evaluation in evaluations:
            assert [e['pid'] for e in evaluation['refreshes']] == pids
            assert len(evaluation['results']) == len(evaluation['messages']) == 2
            for message in evaluation['refreshes'] + evaluation['messages']:
                assert message['hash'] == evaluation['hash']
                assert message['tensors'] == tensors.setdefault(message['pid'], message['tensors']) > 0
        for message in closed[0]:
            assert message['pid'] in pids and message['tensors'] == 0 and message['exit']['code'] == 0
            assert not Path(f"/proc/{message['pid']}").exists()
        print(f'LIFECYCLE: PASS {directory.name} freshHashes=2 stableTensors={list(tensors.values())} zeroFinalTensors reaped=2')
        placement = lines(directory / 'affinity.jsonl')
        launch = [e for e in placement if e['event'] == 'before-node']
        tf = [e for e in placement if e['event'] == 'before-tensorflow']
        assert len(launch) == 2 and {e['pid'] for e in launch} == set(pids)
        expected = {}
        initialized_counts = [max(len(e['threads']) for e in tf if e['pid'] == pid) for pid in pids]
        if 'evaluatorThreads' in plan:
            initialized = [e for e in placement if e['event'] == 'after-tensorflow']
            assert {e['pid'] for e in initialized} == set(pids)
            for event in initialized:
                assert event['intra'] == event['inter'] == '2'
                assert '--v8-pool-size=4' in event['execArgv']
                mask = sample['mapping'][int(event['index'])]
                for thread in event['threads']:
                    status = dict(line.split(':', 1) for line in thread['status'].splitlines())
                    assert cpu_set(status['Cpus_allowed_list'].strip()) == cpu_set(mask)
            initialized_counts = [max(len(e['threads']) for e in initialized if e['pid'] == pid) for pid in pids]
            assert initialized_counts == [plan['evaluatorThreads']['expectedInitialized']] * 2
            print(f'FIXED THREAD CONFIG: PASS {directory.name} intra=2 inter=2 v8=4 initialized={initialized_counts}')
        native_threads.append(initialized_counts)
        for event in launch:
            mask = sample['mapping'][int(event['index'])]
            expected[event['pid']] = mask
            assert event['affinity'] == [int(x) for x in mask.split(',')]
            loads = [e for e in tf if e['pid'] == event['pid']]
            assert loads and all(int(e['ns']) > int(event['ns']) for e in loads)
            for load in loads:
                for thread in load['threads']:
                    status = dict(line.split(':', 1) for line in thread['status'].splitlines())
                    assert cpu_set(status['Cpus_allowed_list'].strip()) == cpu_set(mask)
        resource_summary = {}
        for observation in lines(directory / 'resources.jsonl'):
            for process in observation['processes']:
                pid = process['pid']
                mask = expected.get(pid, '0,1')
                record = resource_summary.setdefault(pid, dict(role='evaluator' if pid in expected else 'parent-or-teacher',
                    affinity=mask, snapshots=0, threads={}, maxRssKiB=0))
                record['snapshots'] += 1
                status = dict(line.split(':', 1) for line in process['status'].splitlines())
                record['maxRssKiB'] = max(record['maxRssKiB'], int(status.get('VmRSS', '0 kB').split()[0]))
                for thread in process['threads']:
                    assert cpu_set(thread['affinity']) == cpu_set(mask), (pid, thread, mask)
                    tid = str(thread['tid'])
                    row = record['threads'].setdefault(tid, dict(first=thread, last=thread))
                    row['last'] = thread
        for pid in pids:
            assert resource_summary[pid]['snapshots'] > 2
        print(f'AFFINITY CONTROL: PASS {directory.name} beforeNode beforeTensorflow everyObservedThread mapping={sample["mapping"]} parent/teacher=0,1')
        durations = [dict(scenario=starts[key(e)]['scenario'], result=e['game'],
            seconds=(int(e['monotonicNs'])-int(starts[key(e)]['monotonicNs']))/1e9) for e in results]
        summary.update(resources=resource_summary, games=durations, pools=pools)
        summaries.append(summary)
    complete = len(summaries) == 4 and not incomplete
    means = ({arm: statistics.mean(s['seconds'] for s in samples if s['arm'] == arm)
              for arm in ['shared', 'disjoint']} if complete else None)
    reduction = 100 * (means['shared'] - means['disjoint']) / means['shared'] if complete else None
    numeric_passed = complete and reduction >= plan['threshold']
    native_threads_equal = all(counts == native_threads[0] for counts in native_threads)
    valid = not parity_errors and native_threads_equal and not incomplete
    passed = valid and (prefix or numeric_passed)
    print(f'NATIVE THREAD CONTROL: {"PASS" if native_threads_equal else "FAIL"} initializedThreadCounts={native_threads}')
    output = dict(plan=plan, samples=samples, summaries=summaries, means=means,
        reductionPercent=reduction, numericThresholdPassed=numeric_passed, nativeThreadsEqual=native_threads_equal,
        initializedThreadCounts=native_threads, parityErrors=parity_errors, incomplete=incomplete,
        passed=passed, canonical=False, prefix=prefix,
        resourceLimit='One-second /proc snapshots: per-thread first/last counters are observed bounds, not exact lifetime totals; short-lived threads can be missed.')
    (root / (f'prefix-{len(samples)}-audit.json' if prefix else 'audit.json')).write_text(json.dumps(output, indent=2)+'\n')
    print(f'PLACEMENT CONTROL: {"PASS" if valid else "FAIL"} semanticDrift={len(parity_errors)} nativeThreadsEqual={native_threads_equal}')
    if not prefix:
        print(f'PLACEMENT SCREEN: {"PASS" if passed else "NOT ESTABLISHED"} completeSamples={len(summaries)}/4 means={means} reductionPercent={reduction} required=10')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
