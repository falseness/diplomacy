#!/usr/bin/env python3
"""Check archived checkpoint dispatch without running or selecting gameplay."""
import copy
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    'evidence', Path(__file__).with_name('task103-evidence.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
manifest = json.loads(Path(sys.argv[1]).read_text())
name = 'test-task063-all-gamestart-benchmark'
entry, env = driver.regression_entry(name, manifest)
assert env['AI_GAMESTART_SMOKE_CHECKPOINT'].endswith(
    entry['environment']['AI_GAMESTART_SMOKE_CHECKPOINT'])
print('ARCHIVED_CHECKPOINT: PASS original model/weights/metadata and provenance hashes')


def rejects(label, mutate):
    changed = copy.deepcopy(manifest)
    mutate(changed['commands'][name])
    try:
        driver.regression_entry(name, changed)
    except AssertionError:
        print('ARCHIVE_CONTROL: PASS rejected ' + label)
    else:
        raise AssertionError('accepted ' + label)


rejects('development overlap', lambda e:
        e['archive']['known_seeds'].append(e['evaluation_seeds'][0]))
rejects('wrong native shape', lambda e: e.update(input_shapes=[[None, 9, 9, 78]]))
rejects('unbound archive provenance', lambda e:
        e['hashes'].pop(e['archive']['provenance']))
rejects('wrong original checkpoint', lambda e:
        e['archive'].update(original_checkpoint='/invalid/checkpoint'))
rejects('changed archived weights', lambda e: e['hashes'].update({
    next(p for p in e['hashes'] if p.endswith('/weights.bin')): '0' * 64}))
rejects('omitted validation seed', lambda e:
        e['archive']['known_seeds'].remove(e['provenance']['validationSeed']))
print('ARCHIVE_CONTROLS: PASS six negative controls; no gameplay outcomes asserted')
