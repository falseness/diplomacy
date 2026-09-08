#!/usr/bin/env python3
"""Predeclare and execute the bounded TASK-102 attribution matrix, never speed gates."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time

REVISIONS = {'before': 'd1af5854278dd3c58798bf670d7f20deb02a41c8',
             'after': '6f280fc095c3b688d0cda7be4148e061e2539ef5'}
COUNT = 6

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--node', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    dest = args.artifacts.resolve()
    dest.mkdir()  # An attempt is immutable; never overwrite a previous run.
    checkpoint = args.checkpoint.resolve()
    saved = repo / 'artifacts/TASK-102/native-intrinsics/measurements/canonical-training-before-1-outcomes.jsonl'
    starts = [r['scenario'] for r in map(json.loads, saved.read_text().splitlines()) if r['event'] == 'start'][:COUNT]
    component = [dict(mapName='tiny-duel', playerA='AIPlayer', playerB='SimpleAiPlayer',
                      seed=10200+i, roundLimit=1, actionLimit=3, commandLimit=60) for i in range(COUNT)]
    for name, fixtures in [('canonical', starts), ('component', component)]:
        (dest / (name + '.json')).write_text(json.dumps(fixtures, indent=2) + '\n')
    manifests = {}
    for name, revision in REVISIONS.items():
        source = dest / (name + '-source')
        source.mkdir()
        with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['git', 'archive', revision], cwd=repo))) as archive:
            archive.extractall(source)
        manifests[name] = {str(p.relative_to(source)): digest(p) for p in source.rglob('*') if p.is_file()}
        (source / 'node_modules').symlink_to(repo / 'node_modules', target_is_directory=True)
    driver = dest / 'profile.cjs'
    driver.write_bytes(Path(__file__).with_suffix('.cjs').read_bytes())
    env = dict(os.environ, NODE_PATH='/usr/share/nodejs', NODE_OPTIONS='--max-old-space-size=6144')
    # Alternate actual revisions, then calibrate hooks on/off on the after revision.
    matrix = [(fixture, revision, mode, hooks)
              for fixture in ('canonical', 'component')
              for revision, mode, hooks in [('before','retain','on'), ('after','retain','on'),
                  ('after','discard','on'), ('before','discard','on'),
                  ('after','retain','off'), ('after','discard','off')]]
    predeclared = dict(revisions=REVISIONS, actual_predecessor=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
        status=subprocess.check_output(['git','status','--short'],cwd=repo,text=True),
        source_hashes=manifests, checkpoint_hashes={str(p):digest(p) for p in checkpoint.rglob('*') if p.is_file()},
        fixture_hashes={name:digest(dest/(name+'.json')) for name in ('canonical','component')},
        saved_starts_hash=digest(saved), driver_hash=digest(driver), matrix=matrix,
        node=subprocess.check_output([str(args.node),'--version'],text=True).strip(),
        environment={k:v for k,v in env.items() if k.startswith(('NODE_', 'TF_', 'OMP_'))},
        explanation='First six saved starts; same parameters but original expert predictor explicitly replaced by one frozen real checkpoint for diagnostic only. No training/holdout strength claim. Native delta isolated; no candidate chosen.',
        seeds={'canonical':[s['seed'] for s in starts], 'component':[s['seed'] for s in component]},
        training_split='Inherited fixture training/validation split unknown; no holdout claim.')
    (dest/'predeclared.json').write_text(json.dumps(predeclared,indent=2)+'\n')
    (dest/'revision.diff').write_bytes(subprocess.check_output(['git','diff',*REVISIONS.values()],cwd=repo))
    runs=[]
    for fixture, revision, mode, hooks in matrix:
        label='-'.join((fixture,revision,mode,hooks))
        source=dest/(revision+'-source')
        command=[str(args.node.resolve()),str(driver),str(source),str(dest/(fixture+'.json')),str(checkpoint),mode,hooks,str(dest/(label+'.json'))]
        start=time.monotonic()
        with (dest/(label+'.log')).open('x') as log:
            log.write('COMMAND: '+json.dumps(command)+'\nCWD: '+str(source)+'\n'); log.flush()
            result=subprocess.run(command,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT)
            log.write('\nEXIT_CODE: '+str(result.returncode)+'\n')
        runs.append(dict(label=label,command=command,cwd=str(source),exit=result.returncode,elapsedSeconds=time.monotonic()-start))
        (dest/'runs.json').write_text(json.dumps(runs,indent=2)+'\n')
        print(json.dumps(runs[-1]),flush=True)
        assert result.returncode == 0, label
    assert all(digest(Path(p))==h for p,h in predeclared['checkpoint_hashes'].items())
    print('BOUNDED_MATRIX_COMPLETE: '+str(len(runs)),flush=True)

if __name__ == '__main__':
    main()
