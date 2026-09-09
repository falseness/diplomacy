#!/usr/bin/env python3
"""Build immutable command inputs from the retained TASK-103 integration captures.

Writes a new file only. This validates saved evidence; it does not run suites or
claim that historical successes establish current aggregate readiness.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('task103-evidence.py'))
EVIDENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVIDENCE)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bindings', type=Path, help='Additional frozen native checkpoint bindings')
    args = parser.parse_args()
    root = args.evidence.resolve()
    scripts = json.loads((REPO / 'package.json').read_text())['scripts']
    names = ['init-model', 'train'] + [name for name in scripts if name.startswith('test-')]
    entries = {name: dict(script=scripts[name], environment={}, hashes={},
               timeout_seconds=EVIDENCE.REGRESSION_BUDGETS.get(name, EVIDENCE.REGRESSION_TIMEOUT))
               for name in names}
    for group in ('map-integration', 'advanced-integration/final'):
        base = root / group
        runs_path = base / 'runs.json'
        runs = json.loads(runs_path.read_text())
        hashes_path = base / 'training-files-sha256.json'
        training_hashes = json.loads(hashes_path.read_text())
        for filename, digest in training_hashes.items():
            assert sha(base / filename) == digest, filename
        for run in runs:
            assert sha(Path(run['log'])) == run['sha256'], run['log']
            command = run['command']
            if (command[:2] != ['npm', 'run'] or run['exit_code'] != 0
                    or not set(run['extra']) & set(EVIDENCE.SMOKE_KEYS)):
                continue
            name = command[2]
            assert name in entries
            assert not entries[name]['environment'], 'duplicate positive checkpoint assignment'
            checkpoint = Path(next(iter(run['extra'].values())))
            fit = checkpoint.parent
            plan = json.loads((fit / 'plan.json').read_text())
            report = json.loads((fit / 'fit-report.json').read_text())
            assert report['trainingEffect'] > 0 and report['zeroEffect'] > 0
            assert report['afterHash'] == sha(checkpoint / 'weights.bin')
            assert report['reloadedSignature']['inputs'] == plan['inputShapes']
            entry = entries[name]
            entry.update(environment={k: str(Path(v).relative_to(REPO)) for k, v in run['extra'].items()},
                         input_shapes=plan['inputShapes'], training_seeds=plan['trainingSeeds'],
                         evaluation_seeds=plan['structuralSeeds'] + plan['gameplaySeeds'],
                         provenance=plan, saved_run=run)
            files = [base / filename for filename in training_hashes
                     if (base / filename).is_relative_to(fit)]
            files += [runs_path, hashes_path, Path(run['log']), base / 'provenance.json',
                      base / 'source-sha256.json', base / 'implementation.diff']
            entry['hashes'] = {str(p.relative_to(REPO)): sha(p) for p in files}
            EVIDENCE.regression_entry(name, {'commands': entries})
    if args.bindings:
        for name, binding in json.loads(args.bindings.read_text()).items():
            assert name in entries and not entries[name]['environment']
            checkpoint = (REPO / binding['checkpoint']).resolve()
            fit = checkpoint.parent
            metadata = json.loads((checkpoint / 'metadata.json').read_text())
            report = json.loads((fit / 'fit-report.json').read_text())
            assert report['trainingEffect'] > 0 and report['zeroEffect'] > 0
            assert report['afterHash'] == sha(checkpoint / 'weights.bin')
            assert metadata['dataSha256'] == sha(fit / 'batch.json')
            entry = entries[name]
            entry.update(environment={'AI_MAP_SMOKE_CHECKPOINT': str(checkpoint.relative_to(REPO))},
                         input_shapes=metadata['inputShapes'], training_seeds=metadata['trainingSeeds'],
                         evaluation_seeds=binding['evaluation_seeds'], provenance=metadata)
            entry['hashes'] = {str(p.relative_to(REPO)): sha(p) for p in fit.rglob('*') if p.is_file()}
            entry['hashes'][str(args.bindings.resolve().relative_to(REPO))] = sha(args.bindings)
            EVIDENCE.regression_entry(name, {'commands': entries})
    result = dict(commands=entries, scope='frozen prerequisites, not aggregate readiness',
                  budgets='outer process only: worker 600s vs observed 331s; cadence 1800s vs 1085s; '
                          'unfinished combat 3600s diagnostic bound; gameplay unchanged')
    with args.output.open('x') as out:
        json.dump(result, out, indent=2)
        out.write('\n')
    print('MANIFEST: PASS commands=' + str(len(entries)) + ' checkpoint_commands=' +
          str(sum(bool(entry['environment']) for entry in entries.values())))


if __name__ == '__main__':
    main()
