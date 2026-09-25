#!/usr/bin/env python3
"""TASK-225 independent three-match observation reader; never a whole G09 closure."""
import argparse
import json
from pathlib import Path
from review_concurrent_archive import board, entity, project, digest

LABELS = ['coop-browser', 'competitive-browser', 'coop-extra']
EVENTS = ['gameStarted', 'playYourTurn', 'waitYouTurn']


def interleaving(rows, labels):
    windows = {}
    for label in labels:
        events = [r for r in rows if r['id'] == label and r['event'] in EVENTS]
        if not events or not {0, 1, 2}.issubset({r['round'] for r in events}):
            raise ValueError('interleaving: missing game/round '+label)
        windows[label] = [min(r['at'] for r in events), max(r['at'] for r in events)]
    if max(w[0] for w in windows.values()) >= min(w[1] for w in windows.values()):
        raise ValueError('interleaving: sequential co-op lifetimes')
    # All three complete the first round before any completes the second.
    if max(min(r['at'] for r in rows if r['id'] == label and r['event'] in EVENTS and r['round'] == 1)
           for label in labels) >= min(r['at'] for r in rows if r['id'] in labels and r['event'] in EVENTS and r['round'] == 2):
        raise ValueError('interleaving: sequential round progress')
    return windows


def expected(label, round_number, moved, persisted=False, dense=False):
    v = board(label, round_number, moved, persisted)
    holes = ([(x, y) for x in range(8, 13) for y in range(6)] if dense
             else [(9, 3), (9, 5), (11, 3), (11, 5)])
    v['nature'] = [dict(name='mountain', coord=dict(x=x, y=y))
                   for x in (range(7, 14) if dense else range(8, 13))
                   for y in (range(7) if dense else range(2, 7)) if (x, y) not in holes]
    if label != 'competitive-browser':
        v['grid'][10][4] = 0
        for x, y in holes:
            v['grid'][x][y] = 3
        v['players'][3]['units'] = [entity('imp', x, y, 2, moves=2) for x, y in holes]
    if persisted and round_number == 2 and moved:
        v['players'][1]['units'][0]['moves'] = 2
    return v


def checkpoint_progress(rows, identities, require_overlap=True):
    """Strict monotonic driver intervals; count only other-match *writes*.

    A successful read or a timestamp inside synchronous AI is not evidence of
    another match committing work. No elapsed-time threshold is invented here.
    """
    operations = {}
    for row in rows:
        operations.setdefault(row['operation'], []).append(row)
    pairs = []
    for pair in operations.values():
        if len(pair) != 2 or [r['boundary'] for r in pair] != ['start', 'end']:
            raise ValueError('phase-progress: incomplete driver operation')
        a, b = pair
        if any(a.get(k) != b.get(k) for k in ['gameID', 'method', 'phase']):
            raise ValueError('phase-progress: changed operation identity')
        if int(a['ns']) >= int(b['ns']):
            raise ValueError('phase-progress: nonmonotonic operation')
        pairs.append(pair)
    changed = lambda r: r.get('succeeded') is True and r.get('writeResult') == dict(acknowledged=True, matchedCount=1, modifiedCount=1)
    windows = []
    for label in ['coop-browser', 'coop-extra']:
        own = identities[label]
        other = identities['coop-extra' if label == 'coop-browser' else 'coop-browser']
        for round_number in [0, 1]:
            phases = [p for p in pairs if p[0]['gameID'] == own and
                      p[0].get('phase') and p[0]['phase']['round'] == round_number]
            if [p[0]['phase']['stage'] for p in phases] != ['wave', 'demon', 'complete']:
                raise ValueError('phase-progress: missing or reordered checkpoints')
            if any(not changed(p[1]) for p in phases):
                raise ValueError('phase-progress: checkpoint write not acknowledged as changed')
            if any(p[0]['method'] != 'updateOne' for p in phases):
                raise ValueError('phase-progress: checkpoint is not a write')
            if any(int(phases[i][1]['ns']) >= int(phases[i+1][0]['ns']) for i in [0, 1]):
                raise ValueError('phase-progress: overlapping same-match checkpoints')
            start, end = int(phases[0][0]['ns']), int(phases[-1][1]['ns'])
            commits = [p[1] for p in pairs if p[0]['gameID'] == other and
                       p[0]['method'] == 'updateOne' and changed(p[1]) and start < int(p[1]['ns']) < end]
            # Stronger than any arbitrary overlapping read: another co-op write
            # completes while an actual checkpoint database await is outstanding.
            awaited = [r for r in commits if any(int(a['ns']) < int(r['ns']) < int(b['ns'])
                                                for a, b in phases)]
            windows.append(dict(label=label, round=round_number, startNs=str(start), endNs=str(end),
                                elapsedMs=(end-start)/1e6,
                                otherCoopCommittedOperations=[r['operation'] for r in commits],
                                otherCoopCommitsDuringAwait=[r['operation'] for r in awaited]))
    if require_overlap and not any(w['otherCoopCommitsDuringAwait'] for w in windows):
        raise ValueError('phase-progress: no other co-op commit during checkpoint await')
    return windows


def review(directory):
    root = Path(directory)
    read = lambda name: json.loads((root/name).read_text())
    rows = [json.loads(line) for line in (root/'game-isolation.jsonl').read_text().splitlines()]
    windows = interleaving(rows, LABELS)
    purposes = [read(label+'-fixture.json')['spec'].get('generation', {}).get('testFixture', {}).get('purpose') for label in LABELS]
    dense = purposes == ['TASK-225 dense-30 genuine AI workload'] * 3
    if not dense and purposes != [None] * 3:
        raise ValueError('independent-observation: mixed or unknown fixture workload')
    oracle = lambda *args: expected(*args, dense=dense)
    checks = []

    def check(name, want, got):
        if want != got:
            raise ValueError('independent-observation: '+name)
        checks.append(name)

    identities = {g['id']: g['gameID'] for g in read('game-identities.json')}
    check('three-distinct-games', 3, len(set(identities.values())))
    for label in LABELS:
        fixture = read(label+'-fixture.json')
        check(label+'/fixture-seed', 1, fixture['spec']['seed'])
        check(label+'/fixture-label', label, fixture['spec']['label'])
        check(label+'/fixture-humans', 2, fixture['spec']['humans'])
        fixture_expected = oracle(label, 0, False, True)
        check(label+'/authored-board', fixture_expected, project(fixture['board']))
        events = [r for r in rows if r['id'] == label and r['event'] in EVENTS]
        for number, row in enumerate(events):
            check(label+'/recipient/'+str(number), row['slot'], row['recipient'])
            check(label+'/raw-board/'+str(number), row['board'], project(row['fullBoard']))
            if label != 'competitive-browser':
                check(label+'/game-id/'+str(number), identities[label], row['gameID'])
                check(label+'/fixture-attribution/'+str(number), label,
                      row['fullBoard']['gameSettings']['coop']['generation']['testFixture']['label'])
            moved = label != 'coop-extra' and row['board']['players'][1]['units'][0]['coord']['y'] == 5
            check(label+'/state/'+str(number), oracle(label, row['round'], moved), row['board'])
        for r in [0, 1, 2]:
            check(label+'/round-slots/'+str(r), [1, 2], sorted({e['slot'] for e in events if e['round'] == r}))
        for r in [1, 2]:
            doc = read(label+'-persisted-'+str(r)+'.json')
            check(label+'/persisted-game/'+str(r), identities[label], doc['gameID'])
            check(label+'/persisted-round-count/'+str(r), r+1, len(doc['rounds']))
            check(label+'/persisted-revision/'+str(r), 2*r if label != 'competitive-browser' else 0, doc.get('coopRevision', 0))
            check(label+'/persisted-board/'+str(r), oracle(label, r, label != 'coop-extra', True), project(doc['rounds'][-1][0]['parallelTurnResult']))
    index = {r['id']: r for r in read('checkpoints.json')['checkpoints']}
    check('contexts-and-participants', dict(contexts=4, counts=[2, 2, 2], distinctGames=3), index['three-match/participants']['observed'])
    for label in LABELS[:2]:
        for r in [1, 2]:
            for slot in [0, 1]:
                row = index[f'three-match/round-{r}/{label}/p{slot}']
                for field in ['expected', 'observed']:
                    check(f'browser/{label}/{r}/{slot}/{field}', oracle(label, r, True), row[field])
    for row in read('checkpoints.json')['checkpoints']:
        check('saved/'+row['id'], row['expected'], row['observed'])
        check('pass/'+row['id'], True, row['pass'])
    db = read('database-awaits.json')
    operations = {}
    for row in db:
        operations.setdefault(row['operation'], []).append(row)
    for op, pair in operations.items():
        check('db-boundaries/'+str(op), ['start', 'end'], [r['boundary'] for r in pair])
        check('db-clock/'+str(op), True, int(pair[0]['ns']) < int(pair[1]['ns']))
    overlaps = []
    for op, pair in operations.items():
        first, last = pair
        if first['gameID'] not in identities.values():
            continue
        inside = [r for r in db if r['gameID'] in identities.values() and r['gameID'] != first['gameID']
                  and int(first['ns']) < int(r['ns']) < int(last['ns'])]
        if inside:
            overlaps.append(dict(operation=op, gameID=first['gameID'], otherOperations=sorted({r['operation'] for r in inside})))
    ai = read('ai-boundaries.json')
    durations = []
    for label in ['coop-browser', 'coop-extra']:
        selected = [r for r in ai if r['label'] == label]
        check(label+'/ai-boundaries', [(r, b, 30 if dense else 4) for r in [0, 1] for b in ['start', 'end']],
              [(r['round'], r['boundary'], r['units']) for r in selected])
        for r in [0, 1]:
            start, end = [v for v in selected if v['round'] == r]
            durations.append(dict(label=label, round=r, elapsedMs=end['at']-start['at']))
    phase_progress = checkpoint_progress(db, identities, require_overlap=dense) if dense else []
    if dense:
        triggers = [r for r in rows if r['event'] == 'wire-trigger']
        check('outbound-wire-triggers', [(r, identities['coop-extra'], 'coop-browser/p2/nextTurn') for r in [0, 1]],
              [(r['round'], r['gameID'], r['source']) for r in triggers])
    for t in read('progress-timings.json'):
        check('response-bound/'+t['phase'], True, 0 <= t['elapsedMs'] < t['boundMs'])
    cleanup = read('cleanup.json')
    check('owned-processes-cleaned', [False, False], [r['aliveAfter'] for r in cleanup['processes']])
    check('owned-directories-cleaned', [False, False], [r['existsAfter'] for r in cleanup['directories']])
    check('browser-errors', [], read('browser-errors.json'))
    # Activity during a short fixture proves scheduling, not a long busy phase.
    # There is intentionally no invented millisecond threshold that closes G09.
    return dict(semanticChecksPassed=True, checkCount=len(checks), checks=checks,
                windows=windows, databaseInterleavings=overlaps, aiDurations=durations,
                phaseProgress=phase_progress, workload="dense-30" if dense else "enclosed-4",
                claims=dict(threeMatchRoundInterleaving=True, realDatabaseInterleaving=bool(overlaps),
                            longBusyPhase=False), criterionClosures=[], fullAuditReady=False,
                unresolved=['G09 long busy demon phase with cross-match progress during its actual await window',
                            'TASK-209 all-eight-criteria consumer review and current-source validity'],
                proofs={str(p.relative_to(root)): digest(p) for p in root.rglob('*') if p.is_file()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive'); parser.add_argument('output')
    args = parser.parse_args()
    result = review(args.archive)
    with open(args.output, 'x') as f:
        json.dump(result, f, indent=2); f.write('\n')
    print(f"PASS three-match observations={result['checkCount']} closures=0 fullAuditReady=false")
