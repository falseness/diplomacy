#!/usr/bin/env python3
"""Audit a completed scoped camera invocation; never promote it to a full audit."""
import hashlib, json, pathlib, subprocess, sys, time
root = pathlib.Path(sys.argv[1]).resolve()
def read(p):
    return json.loads(pathlib.Path(p).read_text())
def digest(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def save(name, value):
    p = root/name
    with p.open('x') as f:
        f.write(json.dumps(value, indent=2)+'\n')
lines = []
def passed(message):
    lines.append('PASS '+message)
    print(lines[-1])
budget = read(root/'verification-budget.json')
process = read(root/'process-exit.json')
assert budget['passScoped'] and budget['cleanup'] and not budget['fullInvocation']
assert process['actualRunnerExit'] == 0 and not process['timedOut']
assert all(c['actualExit'] == 0 and c['signal'] is None for c in budget['commands'])
passed('scoped-runner-and-command-actual-exits=0 cleanup=true')
selection = read(root/'reviewed-crosswalk.json')['cameraSelection']
original, selected = pathlib.Path(selection['original']), pathlib.Path(selection['selected'])
for label, base, hashes in [('original', original, selection['originalFiles']), ('selected', selected, read(selected/'evidence-hashes.json'))]:
    for name, sha in hashes.items():
        f = (base/name).resolve()
        assert f.is_relative_to(base.resolve()) and f.is_file() and digest(f) == sha, name
    passed(label+'-proof-hashes='+str(len(hashes)))
source = read(original/'source-identities.json')
count = 0
for moment in ['before', 'after']:
    for record in source[moment].values():
        for name, sha in record['files'].items():
            assert digest(pathlib.Path(record['repo'])/name) == sha, name
            count += 1
passed('current-source-hashes='+str(count))
for name, sha in read(root/'frozen-tools.json').items():
    assert digest(pathlib.Path('/root/diplomacy')/name) == sha, name
passed('frozen-camera-tools='+str(len(read(root/'frozen-tools.json'))))
checks = read(root/'checkpoints.json')['checks']
assert checks and len({c['id'] for c in checks}) == len(checks)
assert all(c['pass'] and c['expected'] == c['observed'] for c in checks)
passed('independent-camera-checkpoints='+str(len(checks)))
controls = read(root/'negative-control-results.json')['controls']
assert len(controls) == 8 and all(c['pass'] and c['reason'] for c in controls)
passed('actual-consumer-rejections=8')
old = read(root/'historical-projected-inspection.json')
assert old['historicalValid'] and not old['currentSourceValid'] and len(old['sourceDifferences']) == 17
if (root/'historical-reference.json').is_file():
    reference = read(root/'historical-reference.json')
    assert reference['freshHistoricalReaderIdentical']
    for key in ['inventory', 'reader', 'independent']:
        assert digest(reference[key]['file']) == reference[key]['sha256']
    historical = read(reference['inventory']['file'])
else:
    historical = read(root/'historical-inventory.json')
assert len(historical['unresolvedPriorArchives']) == 121
passed('historical-projection valid=true stale-sources=17 requiredPrior=121')
report = read(root/'current-inventory.json')
assert len(report['unresolvedPriorArchives']) == 113
assert len(report['selfChecks']) == 8 and not report['inputIssues'] and not report['unexplainedGaps']
for row in read(root/'current-transitions.json'):
    assert row['status'] == 'covered-current' and row['after'] == row['before'] - 1
    passed(row['id']+' requiredPrior='+str(row['before'])+'->'+str(row['after']))
for repo in ['/root/diplomacy', '/root/diplomacy_server']:
    for argv in [['git', 'diff', '--check'], ['git', 'diff', '--cached', '--name-only']]:
        p = subprocess.run(argv, cwd=repo, capture_output=True, text=True)
        with (root/'handoff-commands.log').open('a') as f:
            f.write('COMMAND '+json.dumps(argv)+' CWD='+repo+'\nSTDOUT_BEGIN\n'+p.stdout+'STDOUT_END\nSTDERR_BEGIN\n'+p.stderr+'STDERR_END\nACTUAL_EXIT='+str(p.returncode)+'\n')
        assert p.returncode == 0
        if '--name-only' in argv:
            assert not any(n.startswith('artifacts/') for n in p.stdout.splitlines())
    passed('diff-check-and-artifacts-unstaged:'+repo)
required = []
for name in ['coverage-audit.json', 'negative-control-results.json', 'verification.log', 'checkpoints.json', 'source-identities.json', 'verification-budget.json', 'verification-plan.json', 'coverage-results.json']:
    p = root/name
    entry = dict(path=str(p), exists=p.is_file(), fullInvocationPass=False,
                 condition='Missing full invocation report' if not p.is_file() else 'Scoped evidence only; does not establish complete TASK-225')
    required.append(entry)
    lines.append('INCOMPLETE required-full-report '+name+(' exists-scoped-only' if entry['exists'] else ' MISSING'))
    print(lines[-1])
save('required-artifact-audit.json', required)
elapsed = round(time.time()*1000-budget['startedMs'])
assert elapsed < 3600000
passed('handoff-inclusive-under-hour elapsedMs='+str(elapsed))
save('handoff-budget.json', dict(fullInvocation=False, passScoped=True, elapsedMs=elapsed, cleanup=True))
(root/'handoff-audit.log').write_text('\n'.join(lines)+'\n')
