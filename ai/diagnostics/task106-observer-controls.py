"""Offline adversarial evidence controls; never executes a game."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

spec = importlib.util.spec_from_file_location('calibration', Path(__file__).with_name('task106-observer-calibration.py'))
calibration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calibration)
root = Path(sys.argv[1]).resolve()
assert len(calibration.audit(root, 1)) == 1
mutations = {
    'missing-game': lambda r: r['games'].pop(),
    'changed-inference': lambda r: r['games'][0]['inference'].update(positions=17270),
    'stale-snapshot': lambda r: r['snapshots'].__setitem__(1, r['snapshots'][0]),
    'tensor-leak': lambda r: r.update(finalTensors=1),
    'erased-nonresult': lambda r: r['games'][0].update(nonResult=False, winner='model'),
    'missing-attempt': lambda r: r['attempted'].pop(),
    'incomplete-count': lambda r: r.update(calls=1935),
}
for label, mutate in mutations.items():
    with tempfile.TemporaryDirectory(prefix='task106-observer-control-') as temporary:
        copy = Path(temporary)
        for name in ['plan.json', 'frozen-hashes.json', 'historical-calls.json', 'source', 'sample-1.log', 'sample-1.json']:
            (copy / name).symlink_to(root / name)
        shutil.copytree(root / 'sample-1-A', copy / 'sample-1-A')
        file = copy / 'sample-1-A/report.json'
        report = json.loads(file.read_text())
        mutate(report)
        file.write_text(json.dumps(report))
        try:
            calibration.audit(copy, 1)
        except AssertionError:
            print('OBSERVER NEGATIVE CONTROL: PASS rejected=' + label)
        else:
            raise AssertionError('accepted corrupted evidence: ' + label)
print('OBSERVER AUDITOR CONTROLS: PASS rejected=7')
