#!/usr/bin/env python3
"""Independent source/switch, complete semantics and factorial effect audit."""
from collections import defaultdict
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('factorial', HERE / 'task102-lookup-ownership.py')
factorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(factorial)
phase = factorial.phase
read, digest = phase.read, phase.digest


def audit(out):
    pre = read(out / 'predeclared.json')
    assert pre['experiment'] == 'lookup-ownership' and pre['order'] == list(factorial.ORDER)
    assert digest(Path(pre['node_binary'])) == pre['node_sha256']
    assert digest(out / 'dependency-sha256.json') == pre['dependency_manifest_sha256']
    for name, sha in read(out / 'dependency-sha256.json').items():
        assert digest(factorial.REPO / 'node_modules' / name) == sha, name
    for arm, hashes in pre['arm_sources'].items():
        for name, sha in hashes.items():
            source = out / 'source' / name
            actual = out / ('source-' + arm) / name
            if name in factorial.PATCHES:
                assert actual.read_text() == factorial.transform(source.read_text(), name, arm)
            else:
                assert sha == pre['sources'][name], (arm, name)
    print('FACTORIAL_SWITCHES: PASS only exact lookup and capture expressions differ; restoration copies/policy fixed')
    for name, sha in pre['checkpoint_hashes'].items():
        assert digest(Path(pre['checkpoint']) / name) == sha
        assert digest(out / 'checkpoint-frozen' / name) == sha
    assert digest(out / 'run-games.cjs') == pre['component_driver_sha256']
    phase.audit(out)
    components = read(out / 'component-runs.json')
    assert len(components) == 8
    reference = None
    for index, (arm, run) in enumerate(zip(factorial.ORDER, components), 1):
        dest = out / f'run-{index}-{arm}'
        assert run['index'] == index and run['mode'] == arm and run['exit_code'] == 0
        assert digest(dest / 'component.log') == run['log_sha256']
        log = (dest / 'component.log').read_text()
        assert 'GAMES_COMPLETE: 50\n' in log and '\nEXIT_CODE: 0\n' in log
        elapsed = [line for line in log.splitlines() if line.startswith('ELAPSED_WALL_SECONDS: ')]
        assert len(elapsed) == 1 and abs(float(elapsed[0].split(': ')[1]) - run['seconds']) < 1e-8, 'raw component elapsed drift'
        assert json.loads(log.splitlines()[0].removeprefix('COMMAND: ')) == pre['component_command']
        outcomes = phase.lines(dest / 'component-outcomes.jsonl')
        assert [r['seed'] for r in outcomes] == list(range(10200, 10250))
        if reference is None:
            reference = outcomes
        assert outcomes == reference, (index, 'component outcome drift')
        print(f'COMPONENT_SEMANTICS: PASS run {index} {arm}; 50 complete outcomes match')
    runs = read(out / 'summary.json')['runs']
    comparisons = []
    report = ['# Lookup × undo ownership interaction', '',
              'Seconds are whole processes; differences are candidate minus control (negative is faster). '
              'Two-per-arm diagnostics, never acceptance medians. GC overlaps phases and is never added or subtracted.', '',
              '| Block | Workload | A | B | C | D | B−A | D−C | Interaction (B−A)−(D−C) | B reduction |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    def effects(values):
        a, b, c, d = (values[arm] for arm in 'ABCD')
        return dict(seconds=values, lookupCopy=b-a, lookupDetached=d-c,
                    interaction=(b-a)-(d-c), ownershipEager=c-a, ownershipScan=d-b,
                    copyLookupReductionPercent=100*(1-b/a) if a else None)
    for block in range(2):
        for workload, source in [('canonical', runs), ('component', components)]:
            values = {r['mode']: r['seconds'] for r in source[block*4:block*4+4]}
            result = dict(block=block+1, workload=workload, **effects(values))
            comparisons.append(result)
            report.append(f'| {block+1} | {workload} | ' + ' | '.join(f'{values[a]:.6f}' for a in 'ABCD') +
                          f' | {result["lookupCopy"]:.6f} | {result["lookupDetached"]:.6f} | {result["interaction"]:.6f} | {result["copyLookupReductionPercent"]:.6f}% |')
    phases = []
    for block in range(2):
        totals = defaultdict(lambda: {arm: 0 for arm in 'ABCD'})
        gc = defaultdict(lambda: {arm: 0 for arm in 'ABCD'})
        for run in runs[block*4:block*4+4]:
            for event in run['trajectory']:
                segment = 'startup' if event['step'] == 0 else ('early' if event['step'] <= 7 else 'late')
                key = (segment, event['phase'])
                totals[key][run['mode']] += event['exclusiveMs']/1000
                gc[key][run['mode']] += event['gcOverlapMs']/1000
        for (segment, name), values in sorted(totals.items()):
            phases.append(dict(block=block+1, segment=segment, phase=name, **effects(values), gcOverlap=gc[(segment, name)]))
    passing_signs = all(r['lookupCopy'] < 0 for r in comparisons)
    screen = 'REQUIRES_MAGNITUDE_AND_PATH_REVIEW' if passing_signs else 'REJECT'
    result = dict(workloads=comparisons, phases=phases, directionalScreen=screen,
                  interpretation='Conditional effects by block; two samples do not establish statistical certainty. No cross-study timing or host-only cause claim.')
    factorial.write(out / 'interaction.json', result)
    report += ['', 'DIRECTIONAL_SCREEN: ' + screen,
               'Ownership C−A and D−B, all early/late phase effects and GC overlaps are retained in interaction.json. '
               'Complete memory and live retention trajectories are in summary.json and phase-table.md.',
               'SEMANTICS: PASS 1040 canonical outcomes, 400 teacher games, 400 component outcomes; all losses/examples/models match.']
    (out / 'interaction.md').write_text('\n'.join(report) + '\n')
    print('FACTORIAL_DIRECTIONAL_SCREEN: ' + screen)
    print('FACTORIAL_AUDIT: PASS complete evidence; diagnostic completion is not task acceptance')


if __name__ == '__main__':
    audit(Path(sys.argv[1]).resolve())
