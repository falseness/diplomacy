"""Negative evidence controls; copy logs to a temporary directory, never alter originals."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).resolve()
auditor = Path(__file__).with_name('task106-inter-op-audit.py').resolve()

def execute(dest):
    return subprocess.run([sys.executable, str(auditor), str(dest)], capture_output=True, text=True)

actual = execute(source)
assert actual.returncode in (0, 1)
assert 'INTER-OP PARITY:' in actual.stdout, actual.stderr
print('ACTUAL AUDIT: preserved exit=' + str(actual.returncode))
for kind in ['missing-result', 'duplicate-result', 'tensor-leak', 'wrong-pool', 'wrong-hash']:
    with tempfile.TemporaryDirectory() as directory:
        dest = Path(directory)
        (dest / 'plan.json').symlink_to(source / 'plan.json')
        for run in source.glob('bounded-inter-*'):
            target = dest / run.name; target.mkdir()
            for file in run.iterdir():
                if file.is_file(): (target / file.name).symlink_to(file)
        arm = dest / 'bounded-inter-2'
        def replace(name, value):
            f = arm / name; f.unlink(); f.write_text(value)
        if kind in ('missing-result', 'duplicate-result'):
            rows = [json.loads(s) for s in (arm / 'events.jsonl').read_text().splitlines()]
            result = next(i for i, row in enumerate(rows) if row['event'] == 'result')
            if kind == 'missing-result': rows.pop(result)
            else: rows.append(rows[result])
            replace('events.jsonl', ''.join(json.dumps(row) + '\n' for row in rows))
        elif kind in ('tensor-leak', 'wrong-hash'):
            report = json.loads((arm / 'report.json').read_text())
            if kind == 'tensor-leak': report['shutdown'][0]['tensors'] = 1
            else: report['boundaries'][0]['hash'] = 'corrupted'
            replace('report.json', json.dumps(report))
        else:
            rows = [json.loads(s) for s in (arm / 'affinity.jsonl').read_text().splitlines()]
            for row in rows:
                if row['event'] == 'before-node': row['inter'] = '99'
            replace('affinity.jsonl', ''.join(json.dumps(row) + '\n' for row in rows))
        result = execute(dest)
        assert result.returncode != 0 and 'AssertionError' in result.stderr, (kind, result.stdout, result.stderr)
        print('AUDITOR NEGATIVE CONTROL: PASS rejected ' + kind)
print('INTER-OP AUDITOR CONTROLS: PASS all five corruptions rejected')
