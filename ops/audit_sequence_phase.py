#!/usr/bin/env python3
"""Independently classify measured native-frame phases; labels never imply coverage."""
import hashlib
import json
import pathlib
import sys


def audit(out):
    read = lambda name: json.loads((out/name).read_text())
    plan = read('verification-plan.json')
    assert plan['phase'] in ['after-frame', 'after-frame-plus-50ms']
    assert plan['cpuThrottleRate'] == 1 and plan['maximumPanSamples'] == 2
    assert plan['requestedHoldMs'] == 51 and plan['retries'] == 0
    assert plan['case'] == dict(id='coop-actions-1', mode='coop', actionSeed=1, mapSeed=1,
        fog=True, join='simultaneous', humans=2, actions=12,
        tier='shipped browser UI + real HTTPS/Socket.IO/MongoDB')
    receipt = read('process-exit.json')
    assert receipt['actualExit'] in [0,1] and not receipt['timedOut']
    assert receipt['elapsedMs'] < 900000 and receipt['fullInvocation'] is False
    hashes = 0
    identities = read('source-identities.json')
    assert identities['stale'] == []
    for stage in ['before','after']:
        for snapshot in identities[stage].values():
            for name, expected in snapshot['files'].items():
                assert hashlib.sha256((pathlib.Path(snapshot['repo'])/name).read_bytes()).hexdigest() == expected, name
                hashes += 1
    for name,expected in read('diagnostic-tool-identities.json').items():
        assert hashlib.sha256(pathlib.Path('/root/diplomacy',name).read_bytes()).hexdigest() == expected, name
    cleanup = read('cleanup.json')
    assert len(cleanup['processes']) == len(cleanup['directories']) == 2
    assert all(not r['aliveAfter'] and not pathlib.Path('/proc',str(r['pid'])).exists() for r in cleanup['processes'])
    assert all(not r['existsAfter'] and not pathlib.Path(r['path']).exists() for r in cleanup['directories'])
    pans = [json.loads(l) for l in (out/'production-frame-observations.jsonl').read_text().splitlines()]
    inputs = [json.loads(l) for l in (out/'input-traces.jsonl').read_text().splitlines()]
    holds = [r for r in inputs if r['action']=='key-hold']
    assert len(pans) == len(holds) and 1 <= len(pans) <= 2
    assert all(h['keys']==['ArrowDown'] and h['ms']==51 for h in holds)
    summaries=[]
    for pan in pans:
        assert pan['cpuThrottleRate']==1 and pan['phase']==plan['phase']
        assert pan['delayMs'] == (0 if plan['phase']=='after-frame' else 50)
        rows=pan['rows']
        assert rows[0]['kind']=='begin' and rows[-1]['kind']=='end'
        assert rows[0]['offset']==pan['before']
        anchor, = [r for r in rows if r['kind']=='phase-anchor']
        ready, = [r for r in rows if r['kind']=='phase-ready']
        assert ready['time'] >= anchor['time'] and ready['delayMs']==pan['delayMs']
        assert all(a['time']<=b['time'] for a,b in zip(rows,rows[1:]))
        assert all(r['focus'] and r['visibility']=='visible' for r in rows)
        down,=[r for r in rows if r['kind']=='keydown']
        up,=[r for r in rows if r['kind']=='keyup']
        assert down['trusted'] and up['trusted'] and down['key']==up['key']=='ArrowDown'
        assert ready['time'] <= down['time'] < up['time']
        entries=[r for r in rows if r['kind']=='game-frame-enter']
        exits=[r for r in rows if r['kind']=='game-frame-exit']
        assert entries and len(entries)==len(exits)
        for a,b in zip(entries,exits):
            assert a['id']==b['id'] and a['timestamp']==b['timestamp'] and a['time']<=b['time']
            assert b['lastGameFrameTime']==a['timestamp']
            duration=min(100,a['timestamp']-a['lastGameFrameTime']) if 'lastGameFrameTime' in a else 1000/60
            for axis,low,high in [('x','left','right'),('y','top','bottom')]:
                expected=max(a['bounds'][low],min(a['bounds'][high],a['offset'][axis]-a['speed'][axis]*duration/(1000/60)))
                assert abs(b['offset'][axis]-expected)<1e-7, (pan['player'],a['id'],axis,expected,b['offset'][axis])
        during=[r for r in entries if down['time']<r['time']<up['time']]
        delta=rows[-1]['offset']['y']-rows[0]['offset']['y']
        failed=pan['failure'] is not None
        if failed:
            assert pan['failure']==f"{pan['player']}: pan input did not move the camera (frames stalled or at border)"
            assert delta==0 and receipt['actualExit']==1
        else:
            assert delta>0
        summaries.append(dict(player=pan['player'],actualHoldMs=up['time']-down['time'],
            phase=pan['phase'],anchorToDownMs=down['time']-anchor['time'],productionFrames=len(entries),productionFramesDuringHold=len(during),deltaY=delta,
            failure=pan['failure'],betweenFrames=not during,
            withinVerticalBounds=all(r['bounds']['top']<r['offset']['y']<r['bounds']['bottom'] for r in rows)))
    checks=read('checkpoints.json')['checkpoints']
    assert checks and all(c['pass'] and c['expected']==c['observed'] for c in checks)
    actions=read('per-action-checkpoints.json')[0]['actions']
    log=(out/'verification.log').read_text()
    assert 'ACTUAL_EXIT ' in log and 'PASS coop:reconnect-exact' in log
    if receipt['actualExit']==0:
        assert len(actions)==12 and len(pans)==2
        assert '# fail 0' in log and '# skipped 0' in log and 'PASS coop:twelve-legal-actions' in log
        controls=read('negative-controls.json')
        assert len(controls)==5 and all(c['pass'] for c in controls)
        assert read('browser-errors.json')==[]
    return dict(diagnosticEvidencePass=True, fullInvocation=False,overallPass=False,
        failureReproduced=any(p['failure'] for p in summaries),causeProven=False,
        newCurrentCriteria=0,requiredPrior=63,retainedCurrentCriteria=74,selfOwners=8,
        completedActions=len(actions),independentAssertions=len(checks),sourceHashesValidated=hashes,
        serviceProcessesAbsent=2,serviceDirectoriesAbsent=2,cleanup=True,receipt=receipt,pans=summaries)


if __name__=='__main__':
    print(json.dumps(audit(pathlib.Path(sys.argv[1]).absolute()),indent=2))
