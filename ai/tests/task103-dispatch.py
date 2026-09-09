#!/usr/bin/env python3
"""Exercise dispatch validation against real frozen native checkpoint artifacts."""
import copy
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('driver', Path(__file__).with_name('task103-evidence.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
manifest = json.loads(Path(sys.argv[1]).read_text())
names = ['test-economy-stage-1-map-generation', 'test-economy-stage-2-map-generation']
if manifest['commands']['test-task156-all-gamestart-benchmark']['environment']:
    names.append('test-task156-all-gamestart-benchmark')
original = {key: os.environ.get(key) for key in driver.SMOKE_KEYS}
try:
    for key in driver.SMOKE_KEYS:
        os.environ[key] = '/invalid/inherited/' + key
    for name in names:
        entry, env = driver.regression_entry(name, manifest)
        assert len(entry['environment']) == 1
        for key in driver.SMOKE_KEYS:
            expected = str((driver.REPO / entry['environment'][key]).resolve()) if key in entry['environment'] else None
            assert env.get(key) == expected
            assert os.environ[key] == '/invalid/inherited/' + key
        print('ENVIRONMENT_ISOLATION: PASS ' + name)
    # No native checkpoint setting may leak into a subsequent ordinary command.
    _, env = driver.regression_entry('test-model-predict-batching', manifest)
    assert all(key not in env for key in driver.SMOKE_KEYS)
    print('ENVIRONMENT_ISOLATION: PASS subsequent ordinary command clears all checkpoint keys')
    name = names[0]
    def rejected(label, mutate):
        changed = copy.deepcopy(manifest)
        mutate(changed['commands'][name])
        try:
            driver.regression_entry(name, changed)
        except AssertionError as error:
            print('REJECTED_CONTROL: PASS ' + label + ' ' + str(error))
        else:
            raise AssertionError('accepted invalid entry: ' + label)
    rejected('modified checkpoint hash', lambda entry: entry['hashes'].update({
        next(path for path in entry['hashes'] if path.endswith('weights.bin')): '0' * 64}))
    rejected('training evaluation overlap', lambda entry: entry['evaluation_seeds'].extend(entry['training_seeds']))
    rejected('wrong signature', lambda entry: entry.update(input_shapes=[[None, 1, 1, 1]]))
    rejected('altered npm command', lambda entry: entry.update(script='node invalid.js'))
    rejected('insufficient process budget', lambda entry: entry.update(timeout_seconds=1))
    rejected('unapproved child setting', lambda entry: entry['environment'].update({'GAMEPLAY_LIMIT': '0'}))
finally:
    for key, value in original.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
print('DISPATCH_CONTRACT: PASS')
