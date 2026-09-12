#!/usr/bin/python3
"""Fail-closed audit of the saved-boundary inter-op prerequisite, including non-results."""
import hashlib
import json
from pathlib import Path
import sys


def read(path):
    return json.loads(path.read_text())


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    dest = Path(sys.argv[1]).resolve()
    root = Path(__file__).resolve().parents[2]
    plan = read(dest / 'plan.json')
    for name, digest in {**plan['sourceHashes'], **plan['inputHashes']}.items():
        assert sha(root / name) == digest, name
    print('SOURCE/INPUT BINDING: PASS all frozen hashes unchanged')
    arms = []
    drift = []
    for inter in plan['boundedOrder']:
        run = dest / f'bounded-inter-{inter}'
        if not run.exists():
            print(f'UNRUN ARM: inter={inter}; prerequisite not passed')
            continue
        report = read(run / 'report.json')
        events = lines(run / 'events.jsonl')
        results = [e for e in events if e['event'] == 'result']
        starts = {(e['pid'], e['id']): e['scenario'] for e in events if e['event'] == 'start'}
        assert len(starts) == len(results) == len({(e['pid'], e['id']) for e in results})
        assert not any(e['event'] in ('crash', 'fit-start', 'fit-crash') for e in events)
        assert len(results) == 2 * len(report['boundaries'])
        pids = [e['pid'] for e in report['shutdown']]
        assert len(set(pids)) == 2
        for child in report['shutdown']:
            assert child['tensors'] == 0 and child['exit']['code'] == 0
            assert not Path(f'/proc/{child["pid"]}').exists()
        assert report['finalTensors'] == 0
        tensors = report['boundaries'][0]['refreshes'][0]['tensors']
        assert tensors > 0
        for b, expected in zip(report['boundaries'], plan['boundaries']):
            assert b['hash'] == expected['hash'] and len(b['results']) == 2
            assert [e['pid'] for e in b['refreshes']] == pids
            for message in b['refreshes'] + b['messages']:
                assert message['tensors'] == tensors and message['hash'] == b['hash']
            for actual, old in zip(b['results'], expected['results']):
                differences = {k: dict(expected=old[k], actual=actual[k])
                    for k in old.keys() | actual.keys() if old.get(k) != actual.get(k)}
                if differences: drift.append(dict(inter=inter, seed=actual['seed'], differences=differences))
        placement = lines(run / 'affinity.jsonl')
        launch = [e for e in placement if e['event'] == 'before-node']
        assert len(launch) == 2 and {e['pid'] for e in launch} == set(pids)
        for e in launch:
            assert e['intra'] == '2' and e['inter'] == str(inter) and e['v8'] == 4 and e['affinity'] == [0, 1]
        initialized = [e for e in placement if e['event'] == 'after-tensorflow']
        assert {e['pid'] for e in initialized} == set(pids)
        counts = {pid: max(len(e['threads']) for e in initialized if e['pid'] == pid) for pid in pids}
        for e in initialized:
            assert e['intra'] == '2' and e['inter'] == str(inter)
            assert '--v8-pool-size=4' in e['execArgv']
            for thread in e['threads']:
                status = dict(line.split(':', 1) for line in thread['status'].splitlines())
                assert status['Cpus_allowed_list'].strip() in ('0-1', '0,1')
        resources = {}
        for observation in lines(run / 'resources.jsonl'):
            for process in observation['processes']:
                record = resources.setdefault(str(process['pid']), dict(snapshots=0, maxRssKiB=0, threads={}))
                record['snapshots'] += 1
                status = dict(line.split(':', 1) for line in process['status'].splitlines())
                record['maxRssKiB'] = max(record['maxRssKiB'], int(status.get('VmRSS', '0 kB').split()[0]))
                for t in process['threads']:
                    assert t['affinity'] in ('0-1', '0,1')
                    row = record['threads'].setdefault(str(t['tid']), dict(first=t, last=t))
                    row['last'] = t
        for pid in pids: assert resources[str(pid)]['snapshots'] > 2
        raw = [dict(scenario=starts[(e['pid'], e['id'])], result=e['game']) for e in results]
        for b in report['boundaries']:
            for result in b['results']:
                match = [r for r in raw if r['scenario']['seed'] == result['seed']]
                assert len(match) == 1
                for key in ['inference', 'winnerSide', 'roundCount', 'nonResult', 'timeout', 'suddenDeath']:
                    assert match[0]['result'].get(key, False) == result[key], key
        arm = dict(inter=inter, boundaries=len(report['boundaries']), attempted=len(starts), completed=len(results),
            nonResults=sum(r['result']['nonResult'] for r in raw), raw=raw, initializedThreads=counts,
            resources=resources, finalTensors=0, reaped=2)
        arms.append(arm)
        print(f'NATIVE CONFIG: PASS intra=2 inter={inter} v8=4 shared=0,1 initializedThreads={list(counts.values())}')
        print(f'LIFECYCLE: PASS inter={inter} boundaries={arm["boundaries"]} stableTensors={tensors} ownedTensors=0 reaped=2')
        print(f'OUTCOMES: inter={inter} attempted={arm["attempted"]} completed={arm["completed"]} nonResults={arm["nonResults"]}')
    for d in drift: print('SEMANTIC DRIFT: '+json.dumps(d, sort_keys=True))
    passed = len(arms) == 2 and all(a['boundaries'] == 2 for a in arms) and not drift
    output = dict(arms=arms, drift=drift, passed=passed, canonical=False,
        resourceUncertainty='One-second receipt samples, not exact lifetime counters; overlapping costs cannot be added.')
    (dest / 'audit.json').write_text(json.dumps(output, indent=2)+'\n')
    print('INTER-OP PARITY: '+('PASS boundariesPerArm=2 gamesPerArm=4' if passed else 'FAIL; no CLI screen authorized'))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
