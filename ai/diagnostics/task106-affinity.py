#!/usr/bin/python3
"""Cold, balanced placement control; never changes production/model behavior."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import time
import threading


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def child():
    cpus = {int(x) for x in os.environ['TASK106_CHILD_CPUS'].split(',')}
    os.sched_setaffinity(0, cpus)
    assert os.sched_getaffinity(0) == cpus
    with open(os.environ['TASK106_AFFINITY_EVENTS'], 'a') as log:
        log.write(json.dumps(dict(event='before-node', pid=os.getpid(),
            index=os.environ['TASK106_CHILD_INDEX'], affinity=sorted(cpus),
            ns=str(time.monotonic_ns()))) + '\n')
    os.execv(os.environ['TASK106_CHILD_NODE'], [os.environ['TASK106_CHILD_NODE'], *sys.argv[1:]])


def observe(pids):
    records = []
    for pid in sorted(pids):
        try:
            p = Path('/proc') / str(pid)
            threads = []
            for task in (p / 'task').iterdir():
                try:
                    status = dict(line.split(':', 1) for line in (task / 'status').read_text().splitlines())
                    stat = (task / 'stat').read_text().rsplit(')', 1)[1].split()
                    threads.append(dict(tid=int(task.name), affinity=status['Cpus_allowed_list'].strip(),
                        userTicks=int(stat[11]), systemTicks=int(stat[12]), minorFaults=int(stat[7]),
                        majorFaults=int(stat[9]), voluntary=int(status['voluntary_ctxt_switches']),
                        involuntary=int(status['nonvoluntary_ctxt_switches'])))
                except FileNotFoundError:
                    pass
            records.append(dict(pid=pid, status=(p / 'status').read_text(),
                stat=(p / 'stat').read_text(), threads=threads))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return dict(ns=time.monotonic_ns(), processes=records,
                load=Path('/proc/loadavg').read_text(), memory=Path('/proc/meminfo').read_text())


def main():
    root = Path(__file__).resolve().parents[2]
    dest = Path(sys.argv[1]).resolve()
    dest.mkdir(exist_ok=True)
    assert not (dest / 'plan.json').exists(), 'immutable experiment already started'
    node = Path('/root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert revision == '47edf0406fc5f3a016ee948ba3b729646682a86c'
    old = json.loads((root / 'artifacts/TASK-106/iteration-25/plan.json').read_text())
    for file, digest in old['checkpoints'].items():
        assert sha(root / file) == digest, file
    assert subprocess.check_output([node, '--version'], text=True).strip() == 'v20.20.2'
    assert json.loads((root / 'node_modules/@tensorflow/tfjs-node/package.json').read_text())['version'] == '4.22.0'
    assert os.sched_getaffinity(0) == {0, 1}
    order = [('shared', ['0,1', '0,1']), ('disjoint', ['0', '1']),
             ('disjoint', ['1', '0']), ('shared', ['0,1', '0,1'])]
    save(dest / 'plan.json', dict(revision=revision, order=order, inputs=old,
        threshold=10, metric='complete cold subprocess wall time through exit; means of two samples per arm',
        node=str(node), cpus=[0, 1], heapMiB=6144, retries=0,
        nativeThreadEnvironment={k:v for k,v in os.environ.items() if k.startswith(('TF_', 'OMP_', 'MKL_', 'OPENBLAS_'))}))
    (dest / 'tasks-before.json').write_bytes((root / 'artifacts/tasks.json').read_bytes())
    (dest / 'git-status.log').write_bytes(subprocess.check_output(['git', 'status', '--short'], cwd=root))
    archive = subprocess.check_output(['git', 'archive', revision], cwd=root)
    (dest / 'source.tar').write_bytes(archive)
    source = dest / 'source'
    source.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source)
    (source / 'node_modules').symlink_to(root / 'node_modules')
    (source / 'artifacts').symlink_to(root / 'artifacts')
    for file in (root / 'models').rglob('*'):
        target = source / file.relative_to(root)
        if file.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(file)
    save(dest / 'source-hashes.json', {str(p.relative_to(source)):sha(p)
         for p in source.rglob('*') if p.is_file() and not p.is_symlink()})
    for name in ['task106-affinity.py', 'task106-affinity-preload.cjs', 'task106-affinity-audit.py']:
        target = source / 'ai/diagnostics' / name
        target.write_bytes((root / 'ai/diagnostics' / name).read_bytes())
        target.chmod(0o755 if name.endswith('.py') else 0o644)
    save(dest / 'harness-hashes.json', {name:sha(source / 'ai/diagnostics' / name)
         for name in ['task106-affinity.py', 'task106-affinity-preload.cjs', 'task106-affinity-audit.py']})
    consumed = [root / 'artifacts/TASK-106' / p for p in [
        'diagnosis.md', 'iteration-25/plan.json', 'iteration-25/screen-audit.json',
        'iteration-25/quality-semantic-audit.json', 'iteration-25/quality-audit.log',
        'iteration-25/phases.json', 'iteration-25/anti-cheating-audit.md',
        'iteration-22/worker-invariants.log', 'iteration-23/cli-final.log']]
    save(dest / 'consumed-hashes.json', {str(p):sha(p) for p in consumed})
    samples = []
    for i, (arm, mapping) in enumerate(order):
        sample = dest / f'sample-{i+1}-{arm}'
        sample.mkdir()
        cmd = ['taskset', '-c', '0,1', 'bash', 'train.sh', '--storage-dir', str(sample),
            '--run-id', 'task106-cli', '--games', '4', '--epochs', '1', '--seed', '106',
            '--workers', '2', '--old-vs-new-games', '1', '--curriculum-gate-games', '2',
            '--evaluation-cadence', '1', '--plateau-window', '2', '--plateau-min-delta', '2',
            '--curriculum-lr-reduction-attempted', '--reusable-baseline-evaluation']
        env = dict(os.environ, NODE_PATH='/usr/share/nodejs',
            PATH=str(node.parent)+':'+os.environ['PATH'],
            NODE_OPTIONS='--max-old-space-size=6144 --require='+str(source / 'ai/diagnostics/task106-affinity-preload.cjs'),
            DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT='1',
            TASK106_TRAINING_EVENTS=str(sample / 'events.jsonl'), TASK106_POOL_EVENTS=str(sample / 'pool.jsonl'),
            TASK106_AFFINITY_EVENTS=str(sample / 'affinity.jsonl'), TASK106_AFFINITY_MAPPING=json.dumps(mapping),
            TASK106_AFFINITY_LAUNCHER=str(source / 'ai/diagnostics/task106-affinity.py'))
        print('SAMPLE START', i+1, arm, mapping, flush=True)
        with (sample / 'command.log').open('w') as log, (sample / 'resources.jsonl').open('w') as resources:
            log.write('COMMAND: '+json.dumps(cmd)+'\nENV: '+json.dumps({k:v for k,v in env.items()
                if k.startswith(('NODE', 'TASK106', 'DIPLOMACY', 'TF_', 'OMP_', 'MKL_', 'OPENBLAS_'))})+'\n')
            log.flush()
            start = time.monotonic()
            process = subprocess.Popen(cmd, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
            completed = {}
            def wait_for_exit():
                completed["exit"] = process.wait()
                completed["seconds"] = time.monotonic() - start
            waiter = threading.Thread(target=wait_for_exit)
            waiter.start()
            pids = {process.pid}
            while process.poll() is None:
                for name in ['events.jsonl', 'affinity.jsonl', 'pool.jsonl']:
                    file = sample / name
                    if file.exists():
                        for line in file.read_text().splitlines():
                            try:
                                pids.add(json.loads(line)['pid'])
                            except (json.JSONDecodeError, KeyError):
                                pass
                resources.write(json.dumps(observe(pids))+'\n')
                resources.flush()
                time.sleep(1)
            waiter.join()
            seconds = completed["seconds"]
            log.write(f'EXIT_CODE: {process.returncode}\nELAPSED_SECONDS: {seconds}\n')
        result = dict(arm=arm, mapping=mapping, directory=str(sample), command=cmd,
                      exit=process.returncode, seconds=seconds)
        samples.append(result)
        save(dest / 'samples.json', samples)
        print('SAMPLE COMPLETE', json.dumps(result), flush=True)
        assert process.returncode == 0, 'failed sample; stop without retry'
        # Validate each completed prefix before launching any further expensive work.
        with (sample / 'prefix-audit.log').open('w') as log:
            audit = subprocess.run([sys.executable, str(source / 'ai/diagnostics/task106-affinity-audit.py'),
                str(dest), '--prefix'], stdout=log, stderr=subprocess.STDOUT)
        assert audit.returncode == 0, 'invalid control or semantic drift; stop without retry'
    print('PLACEMENT CONTROL SAMPLES: COMPLETE', flush=True)


if __name__ == '__main__':
    if 'TASK106_CHILD_NODE' in os.environ:
        child()
    else:
        main()
