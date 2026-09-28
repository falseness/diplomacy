#!/usr/bin/env python3
"""Read-only TASK-225-8 analysis of the terminal-map-168 reconnect-slot failure.

Aligns the 168 input trace, server connection activity, Engine.IO request
timestamps and process receipts, and compares every reconnect-slot tap with
the measured probe waits of reconnect-170 and reconnect-171/run-03.
Nothing is re-run; every value is read from archived artifacts.

usage: reconnect_168_timeline.py OUT_DIR
"""
import datetime, hashlib, json, os, re, statistics, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T225 = os.path.join(ROOT, 'artifacts', 'TASK-225')
RUNS = {
    'terminal-map-167': 'terminal-map-167/run-01',
    'terminal-map-168': 'terminal-map-168/run-01',
    'reconnect-170': 'reconnect-170/run-01',
    'reconnect-171': 'reconnect-171/run-03',
}
JOURNEYS = ['terminal-victory', 'terminal-draw', 'terminal-to-coop', 'terminal-to-competitive']
YEAST = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
WAIT_MS = 8000


def ms(iso):
    return datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000


def iso(value):
    return datetime.datetime.fromtimestamp(value / 1000, datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def yeast(token):
    n = 0
    for c in token.split('.')[0]:
        n = n * 64 + YEAST.index(c)
    return n


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def rows(path):
    with open(path) as f:
        return [(i, json.loads(l)) for i, l in enumerate(f, 1) if l.strip()]


def rel(path):
    return os.path.relpath(path, ROOT)


def reconnects(run):
    """Every reconnect-slot tap with its probe wait (if any) and next server connection."""
    out = []
    for j in JOURNEYS:
        base = os.path.join(T225, RUNS[run], 'provider', j)
        trace = os.path.join(base, 'input-trace.jsonl')
        if not os.path.exists(trace):
            continue
        inputs = rows(trace)
        conns = [(i, r) for i, r in rows(os.path.join(base, 'services', 'activity.jsonl'))
                 if r.get('message') == 'A user connected']
        for i, r in inputs:
            if r.get('label') != 'reconnect slot':
                continue
            tap = ms(r['at'])
            before = next(((k, w) for k, w in inputs if k > i and w.get('action') == 'reconnect-wait'
                           and w.get('boundary') == 'before' and w['player'] == r['player']), None)
            end = next(((k, w) for k, w in inputs if before and k > before[0] and w.get('action') == 'reconnect-wait'
                        and w.get('boundary') in ('success', 'failure') and w['player'] == r['player']), None)
            conn = next(((k, c) for k, c in conns if ms(c['at']) >= tap), None)
            out.append({
                'run': run, 'journey': j, 'player': r['player'], 'traceLine': i, 'tapAt': r['at'],
                'waitBefore': before and {'line': before[0], 'at': before[1]['at'], 'tapToWaitStartMs': round(ms(before[1]['at']) - tap)},
                'waitEnd': end and {'line': end[0], 'at': end[1]['at'], 'boundary': end[1]['boundary'],
                                    'elapsedMs': end[1].get('elapsedMs'), 'causeName': end[1].get('causeName'),
                                    'causeMessage': end[1].get('causeMessage')},
                'nextServerConnection': conn and {'activityLine': conn[0], 'at': conn[1]['at'],
                                                  'tapToConnectionMs': round(ms(conn[1]['at']) - tap)},
            })
    return out


def summary(values):
    return values and {'n': len(values), 'min': min(values), 'median': statistics.median(values), 'max': max(values)}


def main(out):
    os.makedirs(out, exist_ok=True)
    all_rows = {run: reconnects(run) for run in RUNS}
    probe = [r for run in ('reconnect-170', 'reconnect-171') for r in all_rows[run]]
    dist = {
        'waitElapsedMs': {run: summary([r['waitEnd']['elapsedMs'] for r in all_rows[run] if r['waitEnd']])
                          for run in ('reconnect-170', 'reconnect-171')},
        'waitBoundaries': {run: sorted({r['waitEnd']['boundary'] for r in all_rows[run] if r['waitEnd']})
                           for run in ('reconnect-170', 'reconnect-171')},
        'tapToConnectionMs': {run: summary([r['nextServerConnection']['tapToConnectionMs'] for r in all_rows[run]
                                            if r['nextServerConnection']]) for run in RUNS},
    }
    # Success waits end no later than the server-side connection in every probe row?
    ordering = [{'run': r['run'], 'journey': r['journey'], 'player': r['player'], 'traceLine': r['traceLine'],
                 'waitEndMinusConnectionMs': round(ms(r['waitEnd']['at']) - ms(r['nextServerConnection']['at']))}
                for r in probe if r['waitEnd'] and r['nextServerConnection']]

    base = os.path.join(T225, RUNS['terminal-map-168'])
    coop = os.path.join(base, 'provider', 'terminal-to-coop')
    stdout = os.path.join(base, 'provider', 'children', '001-reliability_terminal-flow', 'stdout.log')
    net = rows(os.path.join(coop, 'network-traces.jsonl'))
    errs = json.load(open(os.path.join(coop, 'browser-errors.json')))
    polls = []
    for e in errs:
        m = re.search(r'[?&]t=([^&]+)', e.get('url', ''))
        if m:
            polls.append({'player': e['player'], 'yeast': m.group(1), 'requestCreatedAt': iso(yeast(m.group(1))),
                          'sessionBound': '&sid=' in e['url'], 'error': e['text']})
    p1 = next(r for r in all_rows['terminal-map-168'] if r['player'] == 'p1' and r['journey'] == 'terminal-to-coop'
              and r['tapAt'] == '2026-09-28T15:02:38.802Z')
    tap = ms(p1['tapAt'])
    activity = rows(os.path.join(coop, 'services', 'activity.jsonl'))
    cleanup = json.load(open(os.path.join(coop, 'cleanup.json')))
    provider_exit = json.load(open(os.path.join(base, 'provider-exit.json')))
    process_exit = json.load(open(os.path.join(base, 'process-exit.json')))
    diag = {r['boundary']: {'networkTraceLine': i, 'state': r['state']} for i, r in net if r.get('stage') == 'ac2-reconnect-diagnostic'}

    events = []
    def ev(at, source, what, kind, note=None):
        events.append({'at': at, 'offsetFromTapMs': None if at is None else round(ms(at) - tap), 'source': source,
                       'event': what, 'timing': kind, **({'note': note} if note else {})})
    for i, r in activity:
        if '15:02:1' <= r['at'][11:19] <= '15:03:02' and r['message'] in ('A user connected', 'User disconnected') or \
                r['at'] >= '2026-09-28T15:02:51' and r.get('source') in ('server:stdout', 'server', 'cleanup', 'mongod'):
            ev(r['at'], f'{rel(coop)}/services/activity.jsonl:{i}', r['source'] + ': ' + r['message'], 'measured',
               'server-side stdout receipt time; bounds, does not measure, the browser-side event')
    for i, r in rows(os.path.join(coop, 'input-trace.jsonl')):
        if i >= 36:
            ev(r['at'], f'{rel(coop)}/input-trace.jsonl:{i}', f"{r['player']} {r['action']} {r['label']}", 'bound',
               'trace row written BEFORE the awaited mouse.click/reload; lower bound of the input, not wait start')
    for p in polls:
        ev(p['requestCreatedAt'], f'{rel(coop)}/browser-errors.json yeast t={p["yeast"]}',
           f"{p['player']} Engine.IO polling request created ({'with' if p['sessionBound'] else 'no'} sid) -> {p['error']}",
           'measured', 'browser-side request creation time decoded from yeast; failure report time is not recorded')
    ev(None, f'{rel(coop)}/network-traces.jsonl:{diag["before"]["networkTraceLine"]}', 'p1 ac2-reconnect-diagnostic before (menuVisible=false, connected=true, in-game pre-reload)',
       'unmeasured', 'no timestamp; ordered before the 15:02:16.557Z reload row by code order')
    ev(None, f'{rel(coop)}/network-traces.jsonl:{diag["failure"]["networkTraceLine"]}', 'p1 ac2-reconnect-diagnostic failure (menuVisible=false, connected=false, no gameId, whooseTurn=0)',
       'unmeasured', 'no timestamp; taken in the catch after settle() threw, i.e. after tap + mouse.click + 8000 ms, before services teardown at 15:03:00.163Z')
    ev(iso(tap + WAIT_MS), 'derived', 'earliest possible settle() deadline (tap row + 8000 ms)', 'bound',
       'true wait start = after mouse.click resolved, unrecorded in 168; actual deadline is at or after this')
    ev(cleanup['startedAt'], f'{rel(coop)}/cleanup.json', 'services cleanup started', 'measured')
    ev(iso(provider_exit['startedMs']), f'{rel(base)}/provider-exit.json', 'provider child started', 'measured')
    ev(iso(provider_exit['finishedMs']), f'{rel(base)}/provider-exit.json',
       f"provider child exit={provider_exit['actualExit']} signal={provider_exit['signal']}", 'measured')
    events.sort(key=lambda e: (e['at'] is None, e['at'] or ''))

    stdout_lines = open(stdout).read().splitlines()
    fail_line = next(i for i, l in enumerate(stdout_lines, 1) if 'had no observed effect' in l)
    timeline = {
        'task': 'TASK-225-8', 'readOnly': True, 'tool': rel(os.path.abspath(__file__)), 'toolSha256': sha(os.path.abspath(__file__)),
        'inputs': {rel(p): sha(p) for p in [stdout, os.path.join(coop, 'input-trace.jsonl'), os.path.join(coop, 'network-traces.jsonl'),
                                            os.path.join(coop, 'services', 'activity.jsonl'), os.path.join(coop, 'browser-errors.json'),
                                            os.path.join(coop, 'cleanup.json'), os.path.join(base, 'provider-exit.json'),
                                            os.path.join(base, 'process-exit.json'), os.path.join(T225, 'terminal-map-168', 'failure-diagnosis.json')]},
        'timingKinds': {
            'measured': 'timestamp recorded at the event itself by the recording process',
            'bound': 'timestamp brackets the event from one side only; it does NOT measure the wait',
            'unmeasured': 'event known to occur, ordered by code, but carries no timestamp',
        },
        'failure': {'stdoutLine': fail_line, 'message': stdout_lines[fail_line - 1].strip(),
                    'stackTop': stdout_lines[fail_line + 2].strip(),
                    'originalCause': None, 'originalCauseNote': '168 ran the pre-TASK-225-1 driver: settle() discarded the Playwright error; no cause retained',
                    'receivedSignals': process_exit['supervisorSignals'], 'deadlineExpired': process_exit['timedOut'],
                    'escalated': process_exit['escalated'], 'providerExit': provider_exit['actualExit'], 'providerSignal': provider_exit['signal']},
        'p1PreparedReconnect': p1,
        'events': events,
        'waitMeasurement': {
            'measuredWaitDuration': None,
            'why': 'no reconnect-wait before/success/failure rows exist in 168 (probe not loaded); tap row precedes the awaited click',
            'boundedBy': {'waitStartNoEarlierThan': p1['tapAt'], 'waitEndNoEarlierThan': iso(tap + WAIT_MS),
                          'failureDiagnosticNoLaterThan': cleanup['startedAt']},
            'tapToServerConnectionMs': p1['nextServerConnection']['tapToConnectionMs'],
            'tapToServerConnectionIsWait': False,
        },
    }
    comparison = {'task': 'TASK-225-8', 'reconnects': all_rows, 'distribution': dist, 'probeWaitEndVsConnection': ordering}
    json.dump(timeline, open(os.path.join(out, 'timeline.json'), 'w'), indent=1)
    json.dump(comparison, open(os.path.join(out, 'wait-comparison.json'), 'w'), indent=1)
    print(json.dumps({'failure': timeline['failure'], 'p1': p1, 'distribution': dist,
                      'waitEndMinusConnectionMs': summary([o['waitEndMinusConnectionMs'] for o in ordering])}, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
