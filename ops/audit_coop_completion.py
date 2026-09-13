#!/usr/bin/env python3
"""Validate a local-only PRD coverage index without rerunning games or deployment.

The reviewed coverage.json is evidence, not product configuration. This auditor
checks its complete PRD text, literal proof lines, immutable file identities,
source identities, and repository hygiene. Semantic clause-to-proof selection
still requires human review; finding a generic PASS is never such a review.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def clauses(text):
    result = []
    for block in re.split(r'\n\s*\n', text.strip()):
        if re.match(r'^\d+\.', block) or block.startswith('COOPERATIVE MODE:'):
            continue
        result.extend(' '.join(c.split()) for c in re.split(r'\n(?=- )', block))
    return result


def audit(directory):
    directory = pathlib.Path(directory).resolve()
    assert 'artifacts' in directory.parts, 'output must be local-only artifacts'
    spec = json.loads((directory / 'coverage.json').read_text())
    errors = []

    def check(condition, label):
        print(('PASS ' if condition else 'INCOMPLETE ') + label)
        if not condition:
            errors.append(label)

    prd = pathlib.Path(spec['prd']['path'])
    check(digest(prd) == spec['prd']['sha256'], 'PRD identity')
    check([c['text'] for c in spec['clauses']] == clauses(prd.read_text()),
          'PRD clauses expected=49 observed=' + str(len(spec['clauses'])))
    check(set(spec['tasks']) == {f'TASK-{i:03}' for i in range(1, 70)},
          'prerequisite tasks expected=69 observed=' + str(len(spec['tasks'])))
    cache = {}
    for key, task in spec['tasks'].items():
        log = pathlib.Path(task['log'])
        check(log.is_file(), key + ' verification exists')
        if not log.is_file():
            continue
        lines = log.read_text().splitlines()
        cache[str(log)] = lines
        outcome = pathlib.Path(task.get('outcome_log', str(log)))
        outcome_lines = outcome.read_text().splitlines()
        exits = re.findall(r'^exit_status=(\d+)', '\n'.join(outcome_lines), re.M)
        check(bool(exits) and set(exits) == {'0'}, key + ' process exits expected=0 observed=' + str(exits))
        failures = [l for l in outcome_lines if re.match(
            r'^(?:# )?not ok |^# (?:fail|cancelled|skipped) [1-9]', l)]
        # Exempt a nested negative subprocess only with its exact exit assertion
        # and the enclosing passing test. Other failures remain incomplete.
        probe = task.get('expected_failure_probe')
        if probe:
            assertion = json.loads(probe['assertion'].removeprefix('# '))
            valid = (assertion['expected'] == assertion['observed'] == 1
                     and probe['assertion'] in outcome_lines
                     and probe['pass'] in outcome_lines
                     and probe['parent_pass'] in outcome_lines
                     and failures == [probe['failure']])
            check(valid, key + ' intentional unreachable-endpoint probe expected=1 observed=1')
            if valid:
                failures = []
        check(not failures, key + ' required failures/cancellations/skips expected=0 observed=' + str(len(failures)))
        check(bool(task['commands']), key + ' exact commands retained')
        for proof in task['proofs']:
            p = pathlib.Path(proof['path'])
            if str(p) not in cache:
                cache[str(p)] = p.read_text().splitlines() if p.is_file() else []
            content = cache[str(p)]
            check(0 < proof['line'] <= len(content) and content[proof['line'] - 1] == proof['text'],
                  key + ' literal proof ' + str(p) + ':' + str(proof['line']))
    for clause in spec['clauses']:
        refs = clause['tasks']
        check(bool(refs) and all(t in spec['tasks'] and spec['tasks'][t]['proofs'] for t in refs),
              f'clause={clause["id"]} mapped proofs=' + ','.join(refs))
        check(bool(clause['review']), f'clause={clause["id"]} semantic review retained')
    for demon in spec['demons']:
        check(all(t in spec['tasks'] for t in demon['tasks']) and len(demon['tasks']) >= 3,
              'demon=' + demon['name'] + ' config/combat/render/deployed proofs')
        check(demon['role_proof'] in spec['tasks']['TASK-007']['proofs'],
              'demon=' + demon['name'] + ' exact required role proof')
    check({d['name'] for d in spec['demons']} == {
        'imp', 'clawling', 'hound', 'brute', 'bulwark', 'spitter',
        'emberArcher', 'hexcaster', 'ravager', 'demonLord'}, 'all ten demon identities')
    inventory = json.loads((directory / 'evidence-files.json').read_text())
    for row in inventory:
        p = pathlib.Path(row['path'])
        if not p.is_file() or p.stat().st_size != row['bytes'] or digest(p) != row['sha256']:
            check(False, 'evidence identity ' + str(p))
    check(not any(e.startswith('evidence identity') for e in errors),
          'evidence files expected=' + str(len(inventory)) + ' observed=' + str(len(inventory)) + ' identities checked')
    sources = spec['sources']
    for row in sources:
        p = pathlib.Path(row['path'])
        check(p.is_file() and digest(p) == row['sha256'], 'current tested source ' + str(p))
    for root in spec['repositories']:
        for args in [['status', '--short'], ['diff', '--cached', '--name-only'], ['ls-files']]:
            result = subprocess.run(['git', '-C', root, *args], capture_output=True, text=True, check=True)
            if args[0] != 'ls-files':
                print('$ git -C ' + root + ' ' + ' '.join(args) + '\n' + result.stdout, end='')
            if args[0] in ['diff', 'ls-files']:
                check(not any('artifacts' in pathlib.PurePosixPath(p).parts for p in result.stdout.splitlines()),
                      root + ' no artifacts ' + ('staged' if args[0] == 'diff' else 'tracked'))
        subprocess.run(['git', '-C', root, 'diff', '--check'], check=True)
    check(not spec['gaps'], 'required evidence gaps expected=0 observed=' + str(len(spec['gaps'])))
    report = {'status': 'INCOMPLETE' if errors else 'PASS', 'errors': errors,
              'clauses': len(spec['clauses']), 'tasks': len(spec['tasks']),
              'evidence_files': len(inventory), 'tested_sources': len(sources)}
    (directory / 'audit-result.json').write_text(json.dumps(report, indent=2) + '\n')
    if errors:
        raise AssertionError(f'{len(errors)} incomplete checks; see audit-result.json')
    render(spec, directory)
    print('PASS completion index clauses=49 tasks=69 demons=10 gaps=0')


def render(spec, directory):
    lines = ['# Co-op completion evidence index', '',
             'PASS — 49 PRD paragraphs/bullets (including all ten role subclauses), 69 prerequisite tasks.', '',
             'This is an audit of retained runs, not a new live-service health claim. '
             'Commands below reproduce the recorded runs; do not repeat expensive games unless evidence is missing or invalidated.', '',
             'Re-audit: `python3 ops/audit_coop_completion.py artifacts/TASK-070` from `/root/diplomacy`.', '',
             '## Provenance and limitations', '']
    lines += [p + '\n' for p in spec['notes']]
    lines += ['## Count and seed matrices', '', json.dumps(spec['matrices'], indent=2), '',
              '## Deployment identity', '', '```json', json.dumps(spec['deployment'], indent=2), '```', '',
              '## PRD coverage', '']
    for clause in spec['clauses']:
        lines += [f'### Clause {clause["id"]}', '', clause['text'], '', clause['review'], '',
                  'Evidence: ' + ', '.join(f'[{t}](#{t.lower()})' for t in clause['tasks']) + '.', '']
    lines += ['## Demon matrix', '', '| Type | Evidence |', '|---|---|']
    lines += ['| ' + d['name'] + ' | ' + ', '.join(f'[{t}](#{t.lower()})' for t in d['tasks']) + ' |' for d in spec['demons']]
    lines += ['', '## Task evidence', '']
    for name, task in spec['tasks'].items():
        lines += ['### ' + name, '', task['description'], '',
                  '[Full verification log](' + task['log'] + ')',
                  '[Required process outcome](' + task.get('outcome_log', task['log']) + ')', '',
                  'Recorded commands and runtime/revision context:', '', '```text',
                  '\n'.join(task['commands']), '```', '', 'Literal passing proof:', '', '```text']
        lines += [f'{p["path"]}:{p["line"]}:{p["text"]}' for p in task['proofs']]
        lines += ['```', '', 'Related evidence (including screenshots, states, manifests and source revisions):', '']
        lines += [f'- [{pathlib.Path(p).name}]({p})' for p in task['attachments']]
        lines += ['']
    lines += ['## Machine-readable evidence', '',
              '- [Coverage, exact task criteria and source identities](coverage.json)',
              '- [Every retained evidence file with size and SHA256](evidence-files.json)',
              '- [All passing marker lines from final task logs](proof-markers.jsonl)',
              '- [Source history and supersession review](source-review.md)',
              '- [Audit result](audit-result.json)', '']
    (directory / 'completion-index.md').write_text('\n'.join(lines))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=pathlib.Path)
    args = parser.parse_args()
    try:
        audit(args.directory)
    except (AssertionError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print('INCOMPLETE ' + str(error), file=sys.stderr)
        sys.exit(1)
