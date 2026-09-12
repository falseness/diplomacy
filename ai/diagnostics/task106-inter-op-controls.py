"""Launcher controls: mock exec only; never replace a gameplay model or result."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

file = Path(__file__).with_name('task106-inter-op.py')
spec = importlib.util.spec_from_file_location('inter_op', file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    for inter in ('2', '1'):
        events = Path(directory) / f'{inter}.jsonl'
        env = dict(TASK106_CHILD_CPUS='0,1', TASK106_EVALUATOR_INTER=inter,
            TASK106_AFFINITY_EVENTS=str(events), TASK106_CHILD_INDEX='0',
            TASK106_CHILD_NODE='/fixture/node', TF_NUM_INTRAOP_THREADS='99',
            TF_NUM_INTEROP_THREADS='99', UNRELATED_SETTING='retained')
        with patch.dict(os.environ, env, clear=True), patch.object(module.os, 'sched_setaffinity') as affinity, \
                patch.object(module.os, 'sched_getaffinity', return_value={0, 1}), \
                patch.object(module.os, 'execv') as execute, patch.object(module.sys, 'argv', ['launcher', 'child.js']):
            module.child()
            affinity.assert_called_once_with(0, {0, 1})
            execute.assert_called_once_with('/fixture/node', ['/fixture/node', '--v8-pool-size=4', 'child.js'])
            assert os.environ['TF_NUM_INTRAOP_THREADS'] == '2'
            assert os.environ['TF_NUM_INTEROP_THREADS'] == inter
            assert os.environ['UNRELATED_SETTING'] == 'retained'
        record = json.loads(events.read_text())
        assert record['intra'] == '2' and record['inter'] == inter and record['affinity'] == [0, 1]
        print(f'LAUNCHER CONTROL: PASS inter={inter} intra=2 shared=0,1 v8=4 before-exec settings')
    for overrides in [dict(TASK106_CHILD_CPUS='0'), dict(TASK106_EVALUATOR_INTER='0')]:
        with patch.dict(os.environ, dict(env, **overrides), clear=True), \
                patch.object(module.os, 'sched_setaffinity'), \
                patch.object(module.os, 'sched_getaffinity', return_value={0, 1}), \
                patch.object(module.os, 'execv') as execute:
            try:
                module.child()
            except AssertionError:
                execute.assert_not_called()
            else:
                raise AssertionError('invalid configuration was accepted')
        print('INVALID CONFIGURATION: PASS rejected ' + json.dumps(overrides))
print('INTER-OP LAUNCHER CONTROLS: PASS synthetic launch contracts only')
