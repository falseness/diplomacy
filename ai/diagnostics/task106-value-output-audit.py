"""Audit saved value-output controls; never launch training or select samples."""
import copy
import hashlib
import json
from pathlib import Path
import sys


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def records(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def load(root):
    samples = read(root / 'screen-samples.json')
    bundle = []
    for sample in samples:
        directory = Path(sample['directory'])
        bundle.append(dict(sample=sample, events=records(directory / 'events.jsonl'),
            pools=records(directory / 'pool.jsonl'),
            state=read(directory / 'runs/task106-cli/state.json'),
            manifest=read(directory / 'runs/task106-cli/manifest.json'),
            weights=sha(directory / 'final/task106-cli/weights.bin')))
    return bundle


def audit(bundle):
    assert [b['sample']['arm'] for b in bundle] == ['before', 'after', 'after', 'before']
    summaries = []
    for b in bundle:
        assert b['sample']['exit'] == 0 and b['sample']['seconds'] > 0
        events = b['events']
        starts = {(e['pid'], e['id']): e['scenario'] for e in events if e['event'] == 'start'}
        results = [e for e in events if e['event'] == 'result']
        assert len(starts) == len(results) == 39
        assert len({(e['pid'], e['id']) for e in results}) == 39
        assert not any(e['event'] in ('crash', 'fit-crash') for e in events)
        ordered = sorted([dict(scenario=starts[(e['pid'], e['id'])], result=e['game'])
            for e in results], key=lambda x: json.dumps(x['scenario'], sort_keys=True))
        fits = [dict(shapes=e['shapes'], options=e['options']) for e in events if e['event'] == 'fit-start']
        epochs = [e['epochs'] for e in events if e['event'] == 'fit-result']
        assert len(fits) == len(epochs) == 10
        assert b['state']['status'] == b['manifest']['status'] == 'complete'
        assert b['state']['completedGames'] == 4
        configuration = b['manifest']['configuration']
        assert configuration['workers'] == 2 and configuration['epochs'] == 1
        assert configuration['games'] == 4 and configuration['seed'] == 106
        assert configuration['reusableBaselineEvaluation'] is True
        evaluations = [e['result'] for e in b['pools'] if e['event'] == 'evaluate']
        shutdown = [e['result'] for e in b['pools'] if e['event'] == 'close']
        assert len(evaluations) == 2 and len(shutdown) == 1
        hashes = [e['hash'] for e in evaluations]
        assert len(set(hashes)) == 2
        pids = [r['pid'] for r in evaluations[0]['refreshes']]
        tensors = {r['pid']: r['tensors'] for r in evaluations[0]['refreshes']}
        assert len(set(pids)) == 2 and all(v > 0 for v in tensors.values())
        rss = []
        for evaluation in evaluations:
            assert [r['pid'] for r in evaluation['refreshes']] == pids
            assert len(evaluation['results']) == len(evaluation['messages']) == 2
            for r in evaluation['refreshes'] + evaluation['messages']:
                assert r['hash'] == evaluation['hash'] and r['tensors'] == tensors[r['pid']]
                assert r['memory']['rss'] > 0
                rss.append(r['memory']['rss'])
        assert len(shutdown[0]) == 2
        for child in shutdown[0]:
            assert child['pid'] in pids and child['tensors'] == 0 and child['exit']['code'] == 0
        summary = dict(ordered=ordered, fits=fits, epochs=epochs, configuration=configuration,
            hashes=hashes, weights=b['weights'], curriculum=b['state']['curriculum'])
        if summaries:
            assert summary == summaries[0], 'complete work/configuration/checkpoint drift'
        summaries.append(summary)
    return summaries


def main():
    root = Path(sys.argv[1]).resolve()
    bundle = load(root)
    summaries = audit(bundle)
    if '--self-test' in sys.argv:
        for name in ['missing-result', 'changed-epochs', 'changed-weights']:
            modified = copy.deepcopy(bundle)
            if name == 'missing-result':
                event = next(e for e in modified[1]['events'] if e['event'] == 'result')
                modified[1]['events'].remove(event)
            elif name == 'changed-epochs':
                modified[1]['manifest']['configuration']['epochs'] = 2
            else:
                modified[1]['weights'] = '0' * 64
            try:
                audit(modified)
            except AssertionError:
                print('AUDITOR NEGATIVE CONTROL: PASS', name)
            else:
                raise AssertionError('invalid evidence accepted: ' + name)
        print('AUDITOR CONTROLS: PASS positive=1 negative=3; fixtures are not measurements')
        return
    plan = read(root / 'plan.json')
    assert plan['conditionalScreenOrder'] == ['before', 'after', 'after', 'before']
    assert plan['screenThreshold'] == 10 and plan['canonicalSamplesPerArm'] == 3
    for arm, files in read(root / 'screen-sources.json').items():
        for file, digest in files.items():
            assert sha(root / (arm + '-source') / file) == digest, file
    for file, digest in read(root / 'paired/provenance.json')['inputs'].items():
        assert sha(Path(file)) == digest, file
    print('SOURCE/INPUT BINDING: PASS both frozen source arms and all paired checkpoints unchanged')
    paired = read(root / 'paired/report.json')
    assert paired['passed'] and paired['finalTensors'] == 0
    assert paired['games'] == [result for b in plan['boundaries'] for result in b['results']]
    assert len(paired['attempted']) == len(paired['games']) == 4
    assert all(c['mismatch'] == -1 for c in paired['calls'])
    calls = len(paired['calls'])
    positions = sum(c['positions'] for c in paired['calls'])
    assert calls == sum(g['inference']['calls'] for g in paired['games'])
    assert positions == sum(g['inference']['positions'] for g in paired['games'])
    print(f'PAIRED PARITY: PASS games=4 calls={calls} positions={positions} nonResults=4 finalTensors=0')
    for index, (b, summary) in enumerate(zip(bundle, summaries), 1):
        non_results = sum(e['result'].get('nonResult', False) for e in summary['ordered'])
        print(f'FULL WORK PARITY: PASS sample={index} games=39 fits=10 nonResults={non_results} weights/configuration/curriculum/snapshotHashes identical')
        print(f'LIFECYCLE: PASS sample={index} freshHashes=2 stableTensors zeroFinalTensors exited=2; reaping checked by launch audit')
    before = sum(b['sample']['seconds'] for b in bundle if b['sample']['arm'] == 'before') / 2
    after = sum(b['sample']['seconds'] for b in bundle if b['sample']['arm'] == 'after') / 2
    reduction = 100 * (before - after) / before
    result = dict(beforeMean=before, afterMean=after, reductionPercent=reduction,
        passed=reduction >= 10, canonical=False)
    assert result == read(root / 'screen-result.json')
    print(f'PERFORMANCE SCREEN: {"PASS" if result["passed"] else "FAIL"} beforeMean={before} afterMean={after} reductionPercent={reduction} required=10')
    print('Canonical medians: NOT MEASURED; screening means are not canonical evidence')
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
