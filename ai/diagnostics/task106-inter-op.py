#!/usr/bin/python3
"""One-factor evaluator inter-op prerequisite (intra-op remains two). Rejected arms are never retried."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('affinity', Path(__file__).with_name('task106-affinity.py'))
affinity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(affinity)


def child():
    assert os.environ['TASK106_CHILD_CPUS'] == '0,1'
    os.sched_setaffinity(0, {0, 1})
    assert os.sched_getaffinity(0) == {0, 1}
    inter = os.environ['TASK106_EVALUATOR_INTER']
    assert inter in ('1', '2')
    os.environ['TF_NUM_INTRAOP_THREADS'] = '2'
    os.environ['TF_NUM_INTEROP_THREADS'] = inter
    with open(os.environ['TASK106_AFFINITY_EVENTS'], 'a') as log:
        log.write(json.dumps(dict(event='before-node', pid=os.getpid(),
            index=os.environ['TASK106_CHILD_INDEX'], affinity=[0, 1], intra='2',
            inter=inter, v8=4, ns=str(time.monotonic_ns()))) + '\n')
    os.execv(os.environ['TASK106_CHILD_NODE'],
        [os.environ['TASK106_CHILD_NODE'], '--v8-pool-size=4', *sys.argv[1:]])


def main():
    root = Path(__file__).resolve().parents[2]
    dest = Path(sys.argv[1]).resolve()
    dest.mkdir()  # Never overwrite a previous run, including failures.
    old = root / 'artifacts/TASK-106/iteration-25'
    prior = json.loads((old / 'plan.json').read_text())
    for file, digest in prior['checkpoints'].items():
        assert affinity.sha(root / file) == digest, file
    node = Path('/root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node')
    assert subprocess.check_output([node, '--version'], text=True).strip() == 'v20.20.2'
    assert json.loads((root / 'node_modules/@tensorflow/tfjs-node/package.json').read_text())['version'] == '4.22.0'
    assert os.sched_getaffinity(0) == {0, 1}
    changed = subprocess.check_output(['git', 'diff', '--name-only', '47edf04'], text=True).splitlines()
    assert all(p.startswith('ai/diagnostics/') for p in changed), 'production runtime changed'
    sample = old / 'sample-2-after'
    evaluations = [json.loads(line)['result'] for line in (sample / 'pool.jsonl').read_text().splitlines()
        if json.loads(line)['event'] == 'evaluate']
    assert len(evaluations) == 2
    boundaries = []
    inputs = dict(prior['checkpoints'])
    for step, evaluation in zip([3, 4], evaluations):
        checkpoint = sample / f'checkpoints/task106-cli/step-{step:08}'
        metadata = json.loads((checkpoint / 'metadata.json').read_text())
        state = dict(metadata['state'], seed=metadata['seed'], runId=metadata['runId'])
        assert state['completedGames'] == step and state['seed'] == 106
        boundaries.append(dict(checkpoint=str(checkpoint), state=state,
            hash=evaluation['hash'], results=evaluation['results']))
        for file in checkpoint.iterdir():
            if file.is_file(): inputs[str(file)] = affinity.sha(file)
    consumed = [old / 'plan.json', sample / 'pool.jsonl', root / 'artifacts/prevent_cheating.md',
        root / 'artifacts/TASK-106/diagnosis.md']
    for iteration, names in [(25, ['decision.md', 'quality-semantic-audit.json', 'quality-audit.log']),
        (26, ['decision.md', 'plan.json']), (27, ['decision.md', 'plan.json', 'audit.json']),
        (28, ['decision.md', 'audit.log']), (29, ['decision.md', 'audit.log']), (30, ['decision.md', 'audit.log']), (22, ['worker-invariants.log']), (23, ['cli-final.log'])]:
        consumed += [root / f'artifacts/TASK-106/iteration-{iteration}' / name for name in names]
    for directory in [old, root / 'artifacts/TASK-106/iteration-26', root / 'artifacts/TASK-106/iteration-27']:
        consumed += list(directory.glob('sample-*/events.jsonl'))
    for file in consumed: inputs[str(file)] = affinity.sha(file)
    sources = {str(p.relative_to(root)): affinity.sha(p) for folder in ['ai', 'tests']
        for p in (root / folder).rglob('*') if p.is_file() and p.suffix in ('.js', '.cjs', '.py')}
    plan = dict(head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        sourceHashes=sources, inputHashes=inputs, boundaries=boundaries,
        baseline=metadata['trainingConfiguration']['curriculumBaselineAiModelPath'],
        boundedOrder=[2, 1], conditionalColdOrder=[2, 1, 1, 2],
        intra=2, inter='only treatment: evaluator 2 versus 1', v8=4, cpus=[0, 1], heapMiB=6144,
        parentEnvironment=dict(os.environ), retries=0,
        scope='saved boundary correctness prerequisite; no canonical or production speed claim',
        hypothesis='Reduce inter-op scheduling overhead with intra-op2, shared CPUs0,1, V8=4 unchanged; graph has policy/value outputs. No claimed speedup until actual-production full-cost gates pass.')
    # Store relevant runtime environment, not unrelated credentials.
    plan['parentEnvironment'] = {k:v for k,v in os.environ.items()
        if k.startswith(('NODE', 'TF_', 'OMP_', 'MKL_', 'OPENBLAS_', 'DIPLOMACY'))}
    affinity.save(dest / 'plan.json', plan)
    (dest / 'tasks-before.json').write_bytes((root / 'artifacts/tasks.json').read_bytes())
    (dest / 'git-status.log').write_bytes(subprocess.check_output(['git', 'status', '--short']))
    (dest / 'source.diff').write_bytes(subprocess.check_output(['git', 'diff', '47edf04', '--', 'ai/diagnostics']))
    overlay = dest / 'diagnostics'
    overlay.mkdir()
    for file in (root / 'ai/diagnostics').iterdir():
        if file.is_file(): (overlay / file.name).write_bytes(file.read_bytes())
    for inter in plan['boundedOrder']:
        run = dest / f'bounded-inter-{inter}'
        run.mkdir()
        cmd = [str(node), str(root / 'ai/diagnostics/task106-native-pool-boundaries.cjs'),
            str(dest / 'plan.json'), str(run / 'report.json')]
        env = dict(os.environ, NODE_PATH='/usr/share/nodejs',
            NODE_OPTIONS='--max-old-space-size=6144 --require='+str(root / 'ai/diagnostics/task106-affinity-preload.cjs'),
            DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT='1', TASK106_EVALUATOR_INTER=str(inter),
            TASK106_TRAINING_EVENTS=str(run / 'events.jsonl'), TASK106_POOL_EVENTS=str(run / 'pool.jsonl'),
            TASK106_AFFINITY_EVENTS=str(run / 'affinity.jsonl'), TASK106_AFFINITY_MAPPING='["0,1","0,1"]',
            TASK106_AFFINITY_LAUNCHER=str(Path(__file__).resolve()))
        print('COMMAND:', json.dumps(cmd), 'INTER:', inter, flush=True)
        with (run / 'command.log').open('w') as log, (run / 'resources.jsonl').open('w') as resources:
            log.write('COMMAND: '+json.dumps(cmd)+'\nENV: '+json.dumps({k:v for k,v in env.items()
                if k.startswith(('NODE', 'TASK106', 'DIPLOMACY', 'TF_', 'OMP_', 'MKL_', 'OPENBLAS_'))})+'\n')
            log.flush()
            start = time.monotonic()
            process = subprocess.Popen(cmd, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
            while process.poll() is None:
                pids = {process.pid}
                if (run / 'affinity.jsonl').exists():
                    for line in (run / 'affinity.jsonl').read_text().splitlines():
                        try: pids.add(json.loads(line)['pid'])
                        except json.JSONDecodeError: pass
                resources.write(json.dumps(affinity.observe(pids))+'\n')
                resources.flush()
                time.sleep(1)
            elapsed = time.monotonic() - start
            log.write(f'EXIT_CODE: {process.returncode}\nELAPSED_SECONDS: {elapsed}\n')
        print(f'BOUNDED EXIT: inter={inter} exit={process.returncode} seconds={elapsed}', flush=True)
        if process.returncode:
            print('INTER-OP PREREQUISITE: FAIL; stop without CLI timing or retries', flush=True)
            return 1
    print('INTER-OP PREREQUISITE: PASS; audit effective settings before cold screen', flush=True)
    return 0


if __name__ == '__main__':
    if 'TASK106_CHILD_NODE' in os.environ: child()
    else: sys.exit(main())
