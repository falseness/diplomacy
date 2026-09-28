#!/usr/bin/env python3
"""Read-only validation of a completed passive diagnostic, never a full gate."""
import hashlib
import json
import pathlib
import sys


def audit(out):
    def read(name):
        return json.loads((out/name).read_text())

    receipt = read('process-exit.json')
    case = read('verification-plan.json')['case']
    assert all(case[k] == v for k,v in dict(id='coop-actions-1',mode='coop',
               actionSeed=1,mapSeed=1,fog=True,join='simultaneous',humans=2,actions=12).items())
    assert receipt['actualExit'] == 0 and not receipt['timedOut']
    assert receipt['elapsedMs'] < 900000 and receipt['fullInvocation'] is False
    log = (out/'verification.log').read_text()
    for marker in ['# fail 0', '# skipped 0', 'PASS coop:reconnect-exact',
                   'PASS coop:twelve-legal-actions', 'ACTUAL_EXIT ']:
        assert marker in log, marker
    checks = read('checkpoints.json')['checkpoints']
    assert checks and all(c['pass'] and c['expected'] == c['observed'] for c in checks)
    actions = read('per-action-checkpoints.json')[0]['actions']
    assert len(actions) == 12
    controls = read('negative-controls.json')
    assert len(controls) == 5 and all(c['pass'] for c in controls)
    identities = read('source-identities.json')
    assert identities['stale'] == []
    source_count = 0
    for stage in ['before', 'after']:
        for role in ['client', 'server']:
            snapshot = identities[stage][role]
            for name, expected in snapshot['files'].items():
                assert hashlib.sha256((pathlib.Path(snapshot['repo'])/name).read_bytes()).hexdigest() == expected, name
                source_count += 1
    for name, expected in read('diagnostic-tool-identities.json').items():
        assert hashlib.sha256((pathlib.Path('/root/diplomacy')/name).read_bytes()).hexdigest() == expected, name
    prior = pathlib.Path('/root/diplomacy/artifacts/TASK-225/review-121')
    selection = json.loads((prior/'historical-selection.json').read_text())['sequenceSelection']
    baseline = selection['baseline']
    assert hashlib.sha256(pathlib.Path(baseline['file']).read_bytes()).hexdigest() == baseline['sha256']
    preserved = 0
    for directory, identities in [
        (pathlib.Path(selection['original']), selection['originalFiles']),
        (pathlib.Path(selection['selected']), json.loads((pathlib.Path(selection['selected'])/'evidence-hashes.json').read_text())),
        (pathlib.Path('/root/diplomacy/ops'), selection['toolHashes']),
    ]:
        for name, expected in identities.items():
            assert hashlib.sha256((directory/name).read_bytes()).hexdigest() == expected, name
            preserved += 1
    previous = json.loads((prior/'handoff-audit.json').read_text())
    assert [previous['requiredPriorAfter'],previous['retainedCurrentCriteria'],previous['selfOwners']] == [63,74,8]
    cleanup = read('cleanup.json')
    assert len(cleanup['processes']) == 2 and len(cleanup['directories']) == 2
    for row in cleanup['processes']:
        assert not row['aliveAfter'] and not pathlib.Path('/proc',str(row['pid'])).exists(), row
    for row in cleanup['directories']:
        assert not row['existsAfter'] and not pathlib.Path(row['path']).exists(), row
    pans = [json.loads(line) for line in (out/'pan-observations.jsonl').read_text().splitlines()]
    inputs = [json.loads(line) for line in (out/'input-traces.jsonl').read_text().splitlines()]
    holds = [r for r in inputs if r['action'] == 'key-hold']
    assert len(holds) == len(pans) == 2
    assert all(r['keys'] == ['ArrowDown'] and r['ms'] == 51 for r in holds)
    assert {p['player'] for p in pans} == {'host','peer'}
    summary = []
    for pan in pans:
        rows = pan['rows']
        assert rows[0]['kind'] == 'begin' and rows[-1]['kind'] == 'end'
        assert rows[0]['offset'] == pan['before'] and pan['failure'] is None
        assert all('observationError' not in r and r['round'] == 1 for r in rows)
        assert all(a['time'] <= b['time'] for a,b in zip(rows,rows[1:]))
        down, = [r for r in rows if r['kind'] == 'keydown']
        up, = [r for r in rows if r['kind'] == 'keyup']
        assert down['key'] == up['key'] == 'ArrowDown' and down['trusted'] and up['trusted']
        # Use callback observation order, not the nominal RAF timestamp: a
        # delayed callback may carry a timestamp older than the actual keydown.
        frames = [r for r in rows if r['kind'] == 'frame' and down['time'] < r['time'] < up['time']]
        assert frames and any(40 in r['vertical'] and r['speed']['y'] < 0 for r in frames)
        assert all(r['visibility'] == 'visible' and r['focus'] for r in rows)
        for r in rows:
            assert r['bounds']['top'] < r['offset']['y'] < r['bounds']['bottom']
        delta = rows[-1]['offset']['y']-rows[0]['offset']['y']
        assert delta > 0
        summary.append(dict(player=pan['player'],actualHoldMs=up['time']-down['time'],
                            observedFramesDuringHold=len(frames),deltaY=delta,
                            withinVerticalBounds=True,visibleAndFocused=True))
    return dict(diagnosticEvidencePass=True,fullInvocation=False,overallPass=False,
                failureReproduced=False,causeProven=False,newCurrentCriteria=0,
                requiredPrior=63,retainedCurrentCriteria=74,selfOwners=8,
                completedActions=len(actions),independentAssertions=len(checks),
                negativeControls=len(controls),sourceHashesValidated=source_count,
                historicalProofAndToolHashesPreserved=preserved,baseline=baseline,
                serviceProcessesAbsent=2,serviceDirectoriesAbsent=2,cleanup=True,
                receipt=receipt,pans=summary,
                nextExperiment='Predeclare a bounded timing diagnostic with game-frame entry/exit observations and an independently specified scheduling variable; retain unchanged 51 ms input and all assertions. No unchanged provider retry or inferred repair.')


if __name__ == '__main__':
    print(json.dumps(audit(pathlib.Path(sys.argv[1]).absolute()),indent=2))
